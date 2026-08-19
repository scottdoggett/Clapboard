/**
 * MDBList Response Parsing
 *
 * MDBList republishes ratings from several sites in one call, keyed by IMDb ID
 * — including **Letterboxd**, which has been in `RatingSource` and the overlay
 * since the start with no provider behind it. OMDb doesn't carry it and
 * Letterboxd's own API is approval-only, so this is the realistic route.
 *
 * What is verified and what is not, because it matters when reading this:
 *
 * - The route (`/{provider}/{media_type}/{media_id}`), the top-level fields
 *   (`id, imdb_id, title, year, type, score, ratings, …`) and the rating source
 *   names come from MDBList's own OpenAPI spec at `api.mdblist.com/schema/`.
 * - The **shape of each entry inside `ratings`** does not. The spec declares it
 *   as a bare `type: object` with no properties, and the endpoint needs a key,
 *   so it could not be observed. The parser below therefore accepts several
 *   plausible field spellings rather than assuming one.
 *
 * That tolerance is deliberate, not sloppiness — but it does mean the first
 * real response should be checked against `npm run verify:mdblist`.
 */

import type { RatingSource } from "./omdbParse";

/** Rating sources MDBList can return, from its OpenAPI spec. */
export const MDBLIST_SOURCES = [
  "audience",
  "imdb",
  "letterboxd",
  "mal",
  "metacritic",
  "rogerebert",
  "score",
  "score_average",
  "tmdb",
  "tomatoes",
  "trakt",
] as const;

/**
 * Which MDBList sources map onto ours.
 *
 * The rest — Trakt, MAL, TMDB, Roger Ebert, the aggregate scores — are left
 * out rather than widening `RatingSource` and the overlay for sources nobody
 * asked for. Adding one later is a line here plus a badge.
 */
const SOURCE_MAP: Record<string, RatingSource> = {
  imdb: "IMDb",
  tomatoes: "RottenTomatoes",
  metacritic: "Metacritic",
  letterboxd: "Letterboxd",
};

/** Native scale of each source, matching RATING_SOURCES in the extension. */
const SOURCE_MAX: Record<RatingSource, number> = {
  IMDb: 10,
  RottenTomatoes: 100,
  Metacritic: 100,
  Letterboxd: 5,
};

export interface ParsedRating {
  source: RatingSource;
  score: number;
  maxScore: number;
}

/**
 * Pull the ratings out of an MDBList media response.
 *
 * @param data - Parsed JSON body
 * @returns One rating per recognised source, deduplicated
 */
export function parseMdblistRatings(data: unknown): ParsedRating[] {
  if (data === null || typeof data !== "object") return [];

  const ratings = (data as Record<string, unknown>)["ratings"];
  if (!Array.isArray(ratings)) return [];

  const bySource = new Map<RatingSource, ParsedRating>();

  for (const entry of ratings) {
    if (entry === null || typeof entry !== "object") continue;

    const row = entry as Record<string, unknown>;
    const sourceName = readString(row["source"]) ?? readString(row["name"]);
    if (!sourceName) continue;

    const source = SOURCE_MAP[sourceName.toLowerCase()];
    if (!source) continue;

    // The spec doesn't name the value field, so accept the plausible spellings
    const raw =
      readNumber(row["value"]) ?? readNumber(row["score"]) ?? readNumber(row["rating"]);
    if (raw === null) continue;

    const score = normalizeToScale(raw, source);
    if (score === null) continue;

    // First entry for a source wins — MDBList can list critic and audience
    // variants of the same site, and the first is the headline one
    if (!bySource.has(source)) {
      bySource.set(source, { source, score, maxScore: SOURCE_MAX[source] });
    }
  }

  return [...bySource.values()];
}

/**
 * Fit a reported value onto the source's native scale.
 *
 * MDBList normalizes some sources and not others, and the spec doesn't say
 * which. Rather than trust a single convention, each value is checked against
 * the scale it claims to be on and rejected if it can't be made sense of — a
 * wrong number on a ratings overlay is worse than a missing one.
 */
function normalizeToScale(value: number, source: RatingSource): number | null {
  if (!Number.isFinite(value) || value < 0) return null;

  const max = SOURCE_MAX[source];

  if (value <= max) {
    return round(value);
  }

  // Percent-shaped value for a source measured out of 10 or 5
  if (max < 100 && value <= 100) {
    return round((value / 100) * max);
  }

  return null;
}

/**
 * Metadata MDBList carries that's worth keeping when OMDb didn't supply it.
 */
export interface MdblistMetadata {
  title?: string;
  year?: number;
  imdbId?: string;
}

export function parseMdblistMetadata(data: unknown): MdblistMetadata {
  if (data === null || typeof data !== "object") return {};

  const row = data as Record<string, unknown>;
  const year = readNumber(row["year"]);

  return {
    title: readString(row["title"]) ?? undefined,
    year: year !== null && year >= 1888 ? Math.round(year) : undefined,
    imdbId: readString(row["imdb_id"]) ?? undefined,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Merge provider ratings, preferring the ones already in hand.
 *
 * OMDb's numbers arrive first and are the ones the cache was built around;
 * MDBList's job here is to fill gaps — most importantly Letterboxd — not to
 * relitigate a rating both sources carry.
 *
 * @param existing - Ratings already resolved (from OMDb)
 * @param incoming - Ratings from MDBList
 * @returns The combined list
 */
export function mergeRatings(
  existing: ParsedRating[],
  incoming: ParsedRating[]
): ParsedRating[] {
  const have = new Set(existing.map((rating) => rating.source));

  return [...existing, ...incoming.filter((rating) => !have.has(rating.source))];
}
