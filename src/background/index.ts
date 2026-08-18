/**
 * Clapboard Background Service Worker
 *
 * This is the Manifest V3 background script (service worker) that handles:
 * - Extension lifecycle events (install, update, startup)
 * - Message routing between content scripts, popup, and the Convex backend
 * - A local cache layer in front of the backend
 *
 * Note: Service workers are ephemeral in MV3 — avoid storing state in memory.
 * Use chrome.storage for persistence.
 */

import type {
  Message,
  MessageResponse,
  ExtensionStatus,
} from "@shared/types/messages";
import type { AiScoreOutcome, MovieData } from "@shared/types/movie";
import type { ClapboardSettings } from "@shared/utils/storage";
import {
  getSettings,
  updateSettings,
  getCachedMovieData,
  setCachedMovieData,
  getCachedAiScores,
  setCachedAiScores,
  getClientId,
  clearCache,
  getCacheSize,
  DEFAULT_SETTINGS,
} from "@shared/utils/storage";
import { lookupMovie, requestAiScores, closeClient } from "@shared/api/convex";
import { calculateAverageScore } from "@shared/utils/scoring";
import { buildLookupKey } from "@shared/utils/text";
import { EXTENSION_INFO, FEATURES, STORAGE_KEYS } from "@shared/constants";

/**
 * Convex URL baked in at build time from the CONVEX_URL environment variable.
 * A URL stored in settings takes precedence, so a user can point the extension
 * at their own deployment without rebuilding.
 */
const BUILD_TIME_CONVEX_URL = process.env.CONVEX_URL || "";

/**
 * Extension installation handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Clapboard] Extension installed:", details.reason);

  if (details.reason === "install") {
    // Seed defaults so the popup has something coherent to render on first open
    void chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  } else if (details.reason === "update") {
    // Cached payload shapes are tied to the extension version — drop the cache
    // on update rather than trying to migrate entries between shapes.
    void clearCache();
  }
});

/**
 * Message handler for communication with content scripts and popup
 */
chrome.runtime.onMessage.addListener(
  (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    console.log("[Clapboard] Received message:", message.type, "from:", sender.tab?.url);

    // Handle messages asynchronously
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        console.error("[Clapboard] Message handling error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    // Return true to indicate async response
    return true;
  }
);

/**
 * Process incoming messages and route to appropriate handlers
 */
async function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender
): Promise<MessageResponse> {
  switch (message.type) {
    case "GET_MOVIE_DATA":
      return handleGetMovieData(message.payload);

    case "AI_SCORE_REQUEST":
      return handleAiScoreRequest(message.payload);

    case "GET_STATUS":
      return handleGetStatus();

    case "SET_ENABLED":
      return handleSetEnabled(message.payload);

    case "UPDATE_SETTINGS":
      return handleUpdateSettings(message.payload);

    case "CLEAR_CACHE":
      return handleClearCache();

    default: {
      // TypeScript exhaustiveness check
      const exhaustive: never = message;
      return {
        success: false,
        error: `Unknown message type: ${(exhaustive as Message).type}`,
      };
    }
  }
}

/**
 * Resolve the Convex deployment URL, preferring the user's override
 *
 * @param settings - Current settings
 * @returns The URL to use, or an empty string when unconfigured
 */
function resolveConvexUrl(settings: ClapboardSettings): string {
  return settings.convexUrl || BUILD_TIME_CONVEX_URL;
}

/**
 * Build the cache key for a title lookup.
 *
 * Uses the same normalization as the backend so the two caches agree on what
 * counts as the same title.
 */
function cacheKey(title: string, year?: number, type?: string): string {
  return buildLookupKey(title, year, type);
}

/**
 * Fetch movie data — metadata, ratings, and awards — for a detected title.
 *
 * Served from the local cache when possible; otherwise from Convex, which has
 * its own shared cache in front of the ratings provider.
 */
async function handleGetMovieData(payload: {
  title: string;
  year?: number;
  type?: "movie" | "series";
}): Promise<MessageResponse<MovieData | null>> {
  const settings = await getSettings();

  if (!settings.enabled) {
    return { success: true, data: null };
  }

  const key = cacheKey(payload.title, payload.year, payload.type);

  const cached = await getCachedMovieData(key);
  if (cached) {
    console.log("[Clapboard] Cache hit for:", payload.title);
    return { success: true, data: cached.data };
  }

  const url = resolveConvexUrl(settings);
  if (!url) {
    return {
      success: false,
      error:
        "No Convex deployment URL configured. Open the Clapboard popup to set one.",
    };
  }

  console.log("[Clapboard] Looking up:", payload.title, payload.year ?? "");

  const result = await lookupMovie(
    url,
    payload.title,
    payload.year,
    payload.type
  );

  const data: MovieData | null = result
    ? {
        ...result,
        averageScore: calculateAverageScore(result.ratings) ?? undefined,
      }
    : null;

  // Cache negative results too — an unmatched title would otherwise re-query
  // the backend on every SPA navigation back to the same page.
  await setCachedMovieData(key, data);

  return { success: true, data };
}

/**
 * Request AI-generated category scores for a title (Phase 3).
 *
 * Generating these costs a web search and a model call, so both this cache and
 * the backend's record failures as well as successes — a title with too few
 * reviews to score must not be retried every time the user opens the panel.
 */
async function handleAiScoreRequest(payload: {
  movieId: string;
  title: string;
  year?: number;
  type?: "movie" | "series";
}): Promise<MessageResponse<AiScoreOutcome>> {
  if (!FEATURES.AI_SCORES_ENABLED) {
    return { success: true, data: { status: "unavailable" } };
  }

  const settings = await getSettings();

  if (!settings.enabled) {
    return { success: true, data: { status: "unavailable" } };
  }

  const cached = await getCachedAiScores(payload.movieId);
  if (cached) {
    console.log("[Clapboard] AI score cache hit for:", payload.title);
    return { success: true, data: cached.outcome };
  }

  const url = resolveConvexUrl(settings);
  if (!url) {
    return { success: false, error: "No Convex deployment URL configured." };
  }

  console.log("[Clapboard] Requesting AI scores for:", payload.title);

  const outcome = await requestAiScores(
    url,
    payload.movieId,
    payload.title,
    payload.year,
    payload.type,
    await getClientId()
  );

  // Only settled outcomes are worth remembering. Caching "pending" or "rate
  // limited" would pin the overlay to a state that has already passed.
  if (outcome.status === "scored" || outcome.status === "unavailable") {
    await setCachedAiScores(payload.movieId, outcome);
  }

  return { success: true, data: outcome };
}

/**
 * Report extension status to the popup
 */
async function handleGetStatus(): Promise<MessageResponse<ExtensionStatus>> {
  const settings = await getSettings();
  const url = resolveConvexUrl(settings);

  return {
    success: true,
    data: {
      enabled: settings.enabled,
      configured: Boolean(url),
      convexUrl: url,
      cacheSize: await getCacheSize(),
      version: EXTENSION_INFO.VERSION,
    },
  };
}

/**
 * Toggle the overlay on or off
 */
async function handleSetEnabled(payload: {
  enabled: boolean;
}): Promise<MessageResponse<ClapboardSettings>> {
  const settings = await updateSettings({ enabled: payload.enabled });

  return { success: true, data: settings };
}

/**
 * Apply a settings update
 */
async function handleUpdateSettings(
  payload: Partial<ClapboardSettings>
): Promise<MessageResponse<ClapboardSettings>> {
  const settings = await updateSettings(payload);

  if (payload.convexUrl !== undefined) {
    // Point the client at the new deployment, and drop cached results that
    // came from the old one.
    closeClient();
    await clearCache();
  }

  return { success: true, data: settings };
}

/**
 * Clear the local lookup cache
 */
async function handleClearCache(): Promise<MessageResponse<{ cleared: true }>> {
  await clearCache();

  return { success: true, data: { cleared: true } };
}

// Export for testing purposes
export {
  handleMessage,
  handleGetMovieData,
  handleAiScoreRequest,
  handleGetStatus,
  cacheKey,
};
