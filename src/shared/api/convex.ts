/**
 * Convex API Client
 *
 * Talks to the Convex backend from the background service worker.
 *
 * Two deliberate choices here:
 *
 * 1. `ConvexHttpClient` rather than `ConvexClient`. The WebSocket client keeps
 *    a live subscription open, which an ephemeral MV3 service worker can't
 *    hold onto — the worker is torn down between messages. Plain HTTP requests
 *    match the worker's lifecycle.
 *
 * 2. String function references via `makeFunctionReference` rather than the
 *    generated `api` object. `convex/_generated/` only exists after a
 *    deployment has been provisioned, and the extension bundle shouldn't fail
 *    to build just because codegen hasn't run. The tradeoff is that function
 *    names are checked at runtime, not compile time — if you rename a Convex
 *    function, update the reference strings below.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { AiScoreOutcome, Movie, Rating, MovieData } from "@shared/types/movie";

// Convex client instance, keyed by the URL it was created for
let client: ConvexHttpClient | null = null;
let clientUrl: string | null = null;

/**
 * The result shape returned by the `omdb:lookup` action
 */
interface LookupResult {
  movie: Movie & { awards: NonNullable<Movie["awards"]> };
  ratings: Rating[];
}

/**
 * Typed references to the backend functions we call
 */
const lookupRef = makeFunctionReference<
  "action",
  { title: string; year?: number; type?: "movie" | "series" },
  LookupResult | null
>("omdb:lookup");

const aiScoresRef = makeFunctionReference<
  "action",
  {
    movieId: string;
    title: string;
    year?: number;
    type?: "movie" | "series";
    clientId: string;
  },
  AiScoreOutcome
>("aiScores:generate");

/**
 * Get or create the Convex client
 *
 * @param url - Convex deployment URL
 * @returns Convex HTTP client instance
 * @throws If no deployment URL is configured
 */
export function getConvexClient(url: string): ConvexHttpClient {
  if (!url) {
    throw new Error(
      "No Convex deployment URL configured. Set CONVEX_URL at build time, or enter one in the Clapboard popup."
    );
  }

  if (!client || clientUrl !== url) {
    client = new ConvexHttpClient(url);
    clientUrl = url;
  }

  return client;
}

/**
 * Look up a title's metadata, ratings, and awards.
 *
 * The backend serves this from its own cache when it can and falls back to
 * OMDb otherwise, so callers can treat it as a single cheap request.
 *
 * @param url - Convex deployment URL
 * @param title - Movie or show title as displayed by the streaming site
 * @param year - Optional release year for disambiguation
 * @param type - Optional content type hint
 * @returns Movie data with ratings, or null when the title can't be matched
 */
export async function lookupMovie(
  url: string,
  title: string,
  year?: number,
  type?: "movie" | "series"
): Promise<MovieData | null> {
  const convex = getConvexClient(url);

  const result = await convex.action(lookupRef, { title, year, type });

  if (!result) {
    return null;
  }

  return {
    movie: result.movie,
    ratings: result.ratings,
  };
}

/**
 * Request AI-generated category scores for a title (Phase 3).
 *
 * The backend serves stored scores when it has them and generates them
 * otherwise, which means this call can take tens of seconds on a cold title —
 * it searches for reviews and reads them. Callers should treat it as a
 * user-initiated action, not something to fire on page load.
 *
 * @param url - Convex deployment URL
 * @param movieId - Convex document ID for the movie
 * @param title - Canonical title, as resolved by the ratings lookup
 * @param year - Release year, when known
 * @param type - Content type hint
 * @param clientId - Anonymous installation id, for the per-installation budget
 * @returns One of four outcomes — scored, unavailable, pending, or rate limited
 */
export async function requestAiScores(
  url: string,
  movieId: string,
  title: string,
  year: number | undefined,
  type: "movie" | "series" | undefined,
  clientId: string
): Promise<AiScoreOutcome> {
  const convex = getConvexClient(url);

  return await convex.action(aiScoresRef, {
    movieId,
    title,
    year,
    type,
    clientId,
  });
}

/**
 * Drop the cached client, forcing the next call to reconnect.
 * Called when the deployment URL changes.
 */
export function closeClient(): void {
  client = null;
  clientUrl = null;
}
