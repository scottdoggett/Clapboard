/**
 * TMDB Metadata Provider
 *
 * Optional. Configured with `npx convex env set TMDB_API_KEY <key>` (a free
 * key from themoviedb.org); with no key set, nothing here runs.
 *
 * Worth having because TMDB's rate limit is roughly 40 requests a second
 * against OMDb's 1,000 a day, and its artwork is better and more complete. It
 * carries no IMDb, Rotten Tomatoes or Metacritic ratings, so it enriches
 * metadata only.
 *
 * Two requests per cold title: `/find` to turn the IMDb ID into a TMDB one,
 * then `/movie` or `/tv` for the details. That's affordable at 40/second, and
 * the result is cached like everything else.
 */

import { parseFindResponse, parseTmdbDetails, type TmdbMetadata } from "./tmdbParse";

const TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 5000;

/**
 * Is the provider configured?
 */
export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

/**
 * Fetch metadata for a title by IMDb ID.
 *
 * @param imdbId - IMDb ID from the ratings lookup
 * @returns Metadata, or an empty object if unconfigured or anything failed
 */
export async function fetchTmdbMetadata(imdbId: string): Promise<TmdbMetadata> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return {};

  try {
    const found = parseFindResponse(
      await getJson(`${TMDB_ENDPOINT}/find/${imdbId}`, apiKey, {
        external_source: "imdb_id",
      })
    );

    if (!found) return {};

    return parseTmdbDetails(
      await getJson(`${TMDB_ENDPOINT}/${found.mediaType}/${found.id}`, apiKey, {
        // Saves a third request for the director
        append_to_response: "credits",
      })
    );
  } catch (error) {
    console.warn(
      "[Clapboard] TMDB lookup failed:",
      error instanceof Error ? error.message : String(error)
    );
    return {};
  }
}

/**
 * GET a TMDB endpoint as JSON.
 *
 * TMDB accepts the v3 key as a query parameter; a v4 token would go in an
 * Authorization header instead, but the free key issued on signup is v3.
 *
 * @throws On a non-OK response, so the caller's catch turns it into "no
 * metadata" rather than each call site handling it
 */
async function getJson(
  url: string,
  apiKey: string,
  params: Record<string, string>
): Promise<unknown> {
  const target = new URL(url);
  target.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  const response = await fetch(target.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "TMDB rejected the API key — check TMDB_API_KEY"
        : `TMDB request failed: ${response.status}`
    );
  }

  return await response.json();
}
