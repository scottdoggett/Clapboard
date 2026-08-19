/**
 * MDBList Ratings Provider
 *
 * Optional. Configured with `npx convex env set MDBLIST_API_KEY <key>`; with no
 * key set, nothing here runs and ratings come from OMDb alone.
 *
 * Its reason to exist is Letterboxd, which has been in `RatingSource` and the
 * overlay from the start with no provider behind it. MDBList also re-reports
 * IMDb, Rotten Tomatoes and Metacritic, but OMDb already has those, so this
 * runs as a supplement rather than a replacement.
 *
 * Like the Wikidata enrichment, it must never fail a lookup: every error path
 * returns an empty list and the card shows what OMDb gave.
 */

import { parseMdblistRatings, type ParsedRating } from "./mdblistParse";

const MDBLIST_ENDPOINT = "https://api.mdblist.com";

/**
 * Short, because this runs on a request a user is already waiting on and the
 * ratings it adds are a bonus rather than the point.
 */
const TIMEOUT_MS = 5000;

/**
 * Is the provider configured?
 *
 * Exported so the lookup can skip the call entirely rather than making one it
 * knows will fail.
 */
export function isMdblistConfigured(): boolean {
  return Boolean(process.env.MDBLIST_API_KEY);
}

/**
 * Fetch supplementary ratings for a title.
 *
 * @param imdbId - IMDb ID from the ratings lookup
 * @param type - Movie or series, selecting MDBList's media type
 * @returns Ratings, or an empty list if unconfigured or anything went wrong
 */
export async function fetchMdblistRatings(
  imdbId: string,
  type: "movie" | "series" | undefined
): Promise<ParsedRating[]> {
  const apiKey = process.env.MDBLIST_API_KEY;
  if (!apiKey) return [];

  // MDBList calls television "show"; the route is
  // /{media_provider}/{media_type}/{media_id}
  const mediaType = type === "series" ? "show" : "movie";
  const url = new URL(`${MDBLIST_ENDPOINT}/imdb/${mediaType}/${imdbId}`);
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // 401 means the key is wrong and every later call will fail the same
      // way, so it's worth saying so rather than logging a bare status
      console.warn(
        response.status === 401
          ? "[Clapboard] MDBList rejected the API key — check MDBLIST_API_KEY"
          : `[Clapboard] MDBList lookup failed: ${response.status}`
      );
      return [];
    }

    return parseMdblistRatings(await response.json());
  } catch (error) {
    console.warn(
      "[Clapboard] MDBList lookup failed:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}
