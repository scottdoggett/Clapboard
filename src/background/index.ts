/**
 * Clapboard Background Service Worker
 *
 * This is the Manifest V3 background script (service worker) that handles:
 * - Extension lifecycle events (install, update, startup)
 * - Message routing between content scripts, popup, and external APIs
 * - API orchestration for fetching movie data and ratings
 * - Caching and storage management
 *
 * Note: Service workers are ephemeral in MV3 — avoid storing state in memory.
 * Use chrome.storage for persistence.
 */

import type { Message, MessageResponse } from "@shared/types/messages";

/**
 * Extension installation handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Clapboard] Extension installed:", details.reason);

  if (details.reason === "install") {
    // First-time installation setup
    // TODO: Initialize default settings in chrome.storage
    // TODO: Open onboarding page or popup
  } else if (details.reason === "update") {
    // Extension updated
    // TODO: Handle migrations if needed
  }
});

/**
 * Extension startup handler (runs when browser starts with extension enabled)
 */
chrome.runtime.onStartup.addListener(() => {
  console.log("[Clapboard] Extension started");
  // TODO: Initialize any necessary state
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
        sendResponse({ success: false, error: error.message });
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

    case "FETCH_RATINGS":
      return handleFetchRatings(message.payload);

    case "AI_SCORE_REQUEST":
      return handleAiScoreRequest(message.payload);

    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = message;
      return { success: false, error: `Unknown message type: ${(_exhaustive as Message).type}` };
  }
}

/**
 * Fetch movie data from Convex backend
 */
async function handleGetMovieData(
  payload: { title: string; year?: number }
): Promise<MessageResponse> {
  // TODO: Implement Convex query for movie data
  console.log("[Clapboard] Getting movie data for:", payload.title);

  return {
    success: true,
    data: null, // TODO: Return actual movie data
  };
}

/**
 * Fetch ratings from all sources
 */
async function handleFetchRatings(
  payload: { movieId: string }
): Promise<MessageResponse> {
  // TODO: Implement ratings fetch from Convex
  console.log("[Clapboard] Fetching ratings for movie:", payload.movieId);

  return {
    success: true,
    data: [], // TODO: Return actual ratings
  };
}

/**
 * Request AI-generated scores for a movie's reviews
 */
async function handleAiScoreRequest(
  payload: { movieId: string }
): Promise<MessageResponse> {
  // TODO: Implement AI score processing (Phase 3)
  console.log("[Clapboard] AI score request for movie:", payload.movieId);

  return {
    success: false,
    error: "AI scoring not yet implemented",
  };
}

// Export for testing purposes
export { handleMessage, handleGetMovieData, handleFetchRatings, handleAiScoreRequest };
