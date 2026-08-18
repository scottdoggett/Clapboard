/**
 * Wikidata Award Enrichment
 *
 * Fetches per-category awards for a film from the Wikidata Query Service.
 *
 * This is supplementary data on a path that already has an answer, so nothing
 * here is allowed to fail a lookup. Every error path returns an empty list:
 * a title with ratings and no award detail is a fine outcome; a title with no
 * ratings because a public SPARQL endpoint was slow is not.
 */

import {
  WIKIDATA_ENDPOINT,
  buildAwardsQuery,
  parseAwardsResponse,
} from "./wikidataParse";
import type { ParsedAward } from "./omdbParse";

/**
 * Wikimedia asks that clients identify themselves and provide a contact route,
 * and throttles those that don't. This is not optional politeness — an
 * anonymous client gets blocked.
 */
const USER_AGENT =
  "Clapboard/0.1 (https://github.com/scottdoggett/Clapboard) convex-action";

/**
 * The query service is a shared public resource and can be slow under load.
 * Awards are a nice-to-have on a request the user is waiting on, so the wait
 * is short and a timeout is simply "no award detail".
 */
const TIMEOUT_MS = 6000;

/**
 * The query service throttles aggressively and says when to come back via
 * `Retry-After`. One retry is worth it — a 429 says "you're early", not "no" —
 * but only a short one, because a user is waiting on this request.
 */
const MAX_RETRY_WAIT_MS = 2000;

/**
 * Look up a film's awards by IMDb ID.
 *
 * @param imdbId - IMDb ID from the ratings lookup
 * @param fallbackYear - Release year, for awards with no ceremony date
 * @returns Named awards, or an empty list if anything at all went wrong
 */
export async function fetchWikidataAwards(
  imdbId: string,
  fallbackYear: number
): Promise<ParsedAward[]> {
  const url = new URL(WIKIDATA_ENDPOINT);
  url.searchParams.set("query", buildAwardsQuery(imdbId));
  url.searchParams.set("format", "json");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        return parseAwardsResponse(await response.json(), fallbackYear);
      }

      // A 429 is "too early", not "no". Wait the interval the service asks
      // for, once, provided it's short enough to be worth the user's time.
      if (response.status === 429 && attempt === 0) {
        const wait = readRetryAfterMs(response.headers.get("Retry-After"));
        if (wait !== null && wait <= MAX_RETRY_WAIT_MS) {
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
      }

      console.warn(`[Clapboard] Wikidata awards lookup failed: ${response.status}`);
      return [];
    } catch (error) {
      console.warn(
        "[Clapboard] Wikidata awards lookup failed:",
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  return [];
}

/**
 * Read a `Retry-After` header, which is either a number of seconds or an HTTP
 * date.
 *
 * @param header - Raw header value
 * @returns Milliseconds to wait, or null if unreadable
 */
export function readRetryAfterMs(header: string | null): number | null {
  if (!header) return null;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}
