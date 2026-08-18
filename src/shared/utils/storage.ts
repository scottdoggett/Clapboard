/**
 * Storage Utilities
 *
 * Typed wrappers around chrome.storage.local for settings and the movie data
 * cache. The MV3 service worker is ephemeral, so anything that needs to
 * survive a worker restart lives here rather than in module scope.
 */

import { STORAGE_KEYS, CACHE_CONFIG } from "@shared/constants";
import type { AiScoreOutcome, MovieData } from "@shared/types/movie";

/**
 * User-configurable extension settings
 */
export interface ClapboardSettings {
  /** Master on/off switch for the overlay */
  enabled: boolean;
  /** Convex deployment URL — overrides the build-time default when set */
  convexUrl: string;
}

/**
 * Defaults applied on install and whenever a field is missing
 */
export const DEFAULT_SETTINGS: ClapboardSettings = {
  enabled: true,
  convexUrl: "",
};

/**
 * A cached lookup result plus the time it was stored
 */
interface CacheEntry {
  data: MovieData | null;
  fetchedAt: number;
}

/**
 * Read settings, filling in defaults for anything unset
 *
 * @returns The current settings
 */
export async function getSettings(): Promise<ClapboardSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = stored[STORAGE_KEYS.SETTINGS] as
    | Partial<ClapboardSettings>
    | undefined;

  return { ...DEFAULT_SETTINGS, ...settings };
}

/**
 * Merge a partial update into the stored settings
 *
 * @param updates - Fields to change
 * @returns The settings after the update
 */
export async function updateSettings(
  updates: Partial<ClapboardSettings>
): Promise<ClapboardSettings> {
  const current = await getSettings();
  const next = { ...current, ...updates };

  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });

  return next;
}

/**
 * Get this installation's anonymous id, creating one on first use.
 *
 * It exists for one purpose: the backend's scoring budget needs to tell one
 * installation's requests from another's, so a single heavy user can't spend
 * the whole deployment's allowance and lock everyone else out.
 *
 * It's a random UUID with nothing derived from the user or the machine, it
 * lives in this extension's own storage, and it goes nowhere except the Convex
 * deployment the user configured.
 *
 * @returns The stable installation id
 */
export async function getClientId(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CLIENT_ID);
  const existing = stored[STORAGE_KEYS.CLIENT_ID] as string | undefined;

  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }

  const clientId = crypto.randomUUID();
  await chrome.storage.local.set({ [STORAGE_KEYS.CLIENT_ID]: clientId });

  return clientId;
}

/**
 * Read a cached movie lookup.
 *
 * Returns `undefined` on a miss and `{ data: null }` for a cached negative
 * result — the caller needs to tell "we never asked" apart from "we asked and
 * there was nothing", so that unmatched titles don't re-hit the backend on
 * every SPA navigation.
 *
 * @param key - Cache key for the lookup
 * @returns The cached entry, or undefined if absent or stale
 */
export async function getCachedMovieData(
  key: string
): Promise<CacheEntry | undefined> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  const cache = (stored[STORAGE_KEYS.CACHE] ?? {}) as Record<string, CacheEntry>;

  const entry = cache[key];
  if (!entry) return undefined;

  const ttl = entry.data ? CACHE_CONFIG.MOVIE_TTL_MS : CACHE_CONFIG.RATINGS_TTL_MS;
  if (Date.now() - entry.fetchedAt > ttl) {
    return undefined;
  }

  return entry;
}

/**
 * Write a movie lookup into the cache, pruning the oldest entries when the
 * cache grows past its configured maximum.
 *
 * @param key - Cache key for the lookup
 * @param data - The lookup result, or null for a negative result
 */
export async function setCachedMovieData(
  key: string,
  data: MovieData | null
): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  const cache = (stored[STORAGE_KEYS.CACHE] ?? {}) as Record<string, CacheEntry>;

  cache[key] = { data, fetchedAt: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > CACHE_CONFIG.MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => cache[a].fetchedAt - cache[b].fetchedAt);
    for (const stale of sorted.slice(0, keys.length - CACHE_CONFIG.MAX_ENTRIES)) {
      delete cache[stale];
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.CACHE]: cache });
}

/**
 * A cached AI scoring outcome.
 *
 * Only settled outcomes land here — scores, or a confirmed lack of reviews.
 * "Pending" and "rate limited" are about this moment, not this title, and
 * caching them would keep the overlay stuck on a state that has since passed.
 */
interface AiScoreCacheEntry {
  outcome: Extract<AiScoreOutcome, { status: "scored" | "unavailable" }>;
  fetchedAt: number;
}

/**
 * Read cached AI scores for a movie.
 *
 * @param movieId - Convex document ID for the movie
 * @returns The cached entry, or undefined if absent or stale
 */
export async function getCachedAiScores(
  movieId: string
): Promise<AiScoreCacheEntry | undefined> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.AI_SCORES);
  const cache = (stored[STORAGE_KEYS.AI_SCORES] ?? {}) as Record<
    string,
    AiScoreCacheEntry
  >;

  const entry = cache[movieId];
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > CACHE_CONFIG.AI_SCORES_TTL_MS) {
    return undefined;
  }

  return entry;
}

/**
 * Cache a settled AI scoring outcome, including a confirmed lack of reviews —
 * that result cost a full run to establish and must not be re-paid for.
 *
 * @param movieId - Convex document ID for the movie
 * @param outcome - A scored or unavailable outcome; transient ones aren't cached
 */
export async function setCachedAiScores(
  movieId: string,
  outcome: AiScoreCacheEntry["outcome"]
): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.AI_SCORES);
  const cache = (stored[STORAGE_KEYS.AI_SCORES] ?? {}) as Record<
    string,
    AiScoreCacheEntry
  >;

  cache[movieId] = { outcome, fetchedAt: Date.now() };

  const keys = Object.keys(cache);
  if (keys.length > CACHE_CONFIG.MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => cache[a].fetchedAt - cache[b].fetchedAt);
    for (const stale of sorted.slice(0, keys.length - CACHE_CONFIG.MAX_ENTRIES)) {
      delete cache[stale];
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.AI_SCORES]: cache });
}

/**
 * Drop every cached lookup and scoring result (used by the popup's "clear
 * cache" action, and whenever the deployment URL changes)
 */
export async function clearCache(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEYS.CACHE, STORAGE_KEYS.AI_SCORES]);
}

/**
 * Count the entries currently in the cache
 *
 * @returns Number of cached lookups
 */
export async function getCacheSize(): Promise<number> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.CACHE);
  const cache = (stored[STORAGE_KEYS.CACHE] ?? {}) as Record<string, CacheEntry>;

  return Object.keys(cache).length;
}
