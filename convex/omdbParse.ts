/**
 * OMDb Response Parsing
 *
 * Pure functions for turning OMDb's loosely-typed JSON into the shapes our
 * schema stores. Kept free of Convex imports so they can be exercised without
 * a deployment — `convex/omdb.ts` holds everything that touches the database.
 */

/**
 * Rating source, matching the schema's union
 */
export type RatingSource = "IMDb" | "RottenTomatoes" | "Metacritic" | "Letterboxd";

/**
 * A rating parsed out of an OMDb response, before it has a movieId
 */
export interface ParsedRating {
  source: RatingSource;
  score: number;
  maxScore: number;
}

/**
 * An award parsed out of OMDb's free-text awards summary
 */
export interface ParsedAward {
  name: string;
  category?: string;
  year: number;
  isWin: boolean;
  count: number;
  /**
   * Who received it. Present only for awards Wikidata attributes to people —
   * an acting or directing award names its recipient, while "Best Picture"
   * names its producers and a festival's top-ten list names nobody.
   */
  people?: string[];
  /** Article explaining the award, where the provider has one */
  url?: string;
}

/**
 * Movie metadata parsed out of an OMDb response
 */
export interface ParsedMovie {
  /** Set by the TMDB provider when configured, not by OMDb */
  tmdbId?: string;
  /** Synopsis, cast and certification — shown in the overlay's info panel */
  plot?: string;
  actors?: string[];
  writer?: string[];
  rated?: string;
  title: string;
  year?: number;
  imdbId?: string;
  genre?: string[];
  posterUrl?: string;
  runtime?: number;
  director?: string;
}

/**
 * The shape returned to the extension
 */
export interface LookupResult {
  movie: {
    id: string;
    title: string;
    year?: number;
    imdbId?: string;
    tmdbId?: string;
    genre?: string[];
    plot?: string;
    actors?: string[];
    writer?: string[];
    rated?: string;
    posterUrl?: string;
    runtime?: number;
    director?: string;
    awards: Array<{
      id: string;
      name: string;
      category?: string;
      year: number;
      isWin: boolean;
      count?: number;
      people?: string[];
      url?: string;
    }>;
  };
  ratings: Array<{
    id: string;
    movieId: string;
    source: RatingSource;
    score: number;
    maxScore: number;
    fetchedAt: number;
  }>;
}


/**
 * Normalize a title into a stable cache key component.
 *
 * Streaming sites vary punctuation and casing ("Spider-Man: No Way Home" vs
 * "Spider-Man - No Way Home"), so we strip everything that isn't a letter or
 * digit down to single spaces.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build the cache key for a lookup
 */
export function lookupKey(
  title: string,
  year?: number,
  type?: "movie" | "series"
): string {
  return `${normalizeTitle(title)}|${year ?? ""}|${type ?? ""}`;
}

/**
 * OMDb uses "N/A" as its null. Treat it as absent.
 */
function present(value: string | undefined): string | undefined {
  if (!value || value === "N/A") return undefined;
  return value;
}

/**
 * Parse a numeric value out of one of OMDb's rating formats:
 * "8.8/10", "87%", "74/100"
 *
 * @returns The score, or null if it couldn't be parsed
 */
export function parseRatingValue(value: string): number | null {
  const match = value.match(/^([\d.]+)/);
  if (!match) return null;

  const score = parseFloat(match[1]);
  return Number.isFinite(score) ? score : null;
}

/**
 * Parse a year out of OMDb's Year field, which may be a range
 * ("2010", "2019–2023", "2019–")
 */
export function parseYear(value: string | undefined): number | undefined {
  const raw = present(value);
  if (!raw) return undefined;

  const match = raw.match(/(\d{4})/);
  if (!match) return undefined;

  return parseInt(match[1], 10);
}

/**
 * Parse OMDb's runtime string ("148 min") into minutes
 */
export function parseRuntime(value: string | undefined): number | undefined {
  const raw = present(value);
  if (!raw) return undefined;

  const match = raw.match(/(\d+)/);
  if (!match) return undefined;

  return parseInt(match[1], 10);
}

/**
 * Map an OMDb rating source name onto our RatingSource union
 */
function mapRatingSource(omdbSource: string): RatingSource | null {
  switch (omdbSource) {
    case "Internet Movie Database":
      return "IMDb";
    case "Rotten Tomatoes":
      return "RottenTomatoes";
    case "Metacritic":
      return "Metacritic";
    default:
      return null;
  }
}

/**
 * Normalize an award name from OMDb's phrasing onto the names the overlay
 * has icons for ("Oscars" -> "Oscar", "Golden Globes" -> "Golden Globe").
 */
export function normalizeAwardName(phrase: string): string {
  const cleaned = phrase.trim().replace(/\s+/g, " ");

  const known: Array<[RegExp, string]> = [
    [/oscar/i, "Oscar"],
    [/golden globe/i, "Golden Globe"],
    [/bafta/i, "BAFTA"],
    [/primetime emmy/i, "Primetime Emmy"],
    [/emmy/i, "Emmy"],
    [/screen actors guild/i, "Screen Actors Guild"],
    [/cannes/i, "Cannes"],
    [/sundance/i, "Sundance"],
  ];

  for (const [pattern, name] of known) {
    if (pattern.test(cleaned)) return name;
  }

  // Unknown award — drop a trailing plural "s" so it reads as a singular label
  return cleaned.replace(/s$/, "");
}

/**
 * Parse OMDb's free-text awards summary into structured awards.
 *
 * OMDb does not expose per-category award data, only summary strings like:
 *   "Won 4 Oscars. 159 wins & 220 nominations total."
 *   "Nominated for 3 Oscars. 12 wins & 45 nominations total."
 *   "3 wins & 5 nominations."
 *
 * We emit the headline award as its own record (with a count), then fold the
 * remaining wins and nominations into aggregate records so the overlay can
 * show "4 Oscars" without claiming we know all 159 individual wins.
 *
 * @param summary - The raw OMDb Awards string
 * @param year - Release year, used as the award year (OMDb doesn't give one)
 */
/**
 * Pull the headline totals out of OMDb's awards sentence.
 *
 * "Won 4 Oscars. 159 wins & 220 nominations total." carries two numbers worth
 * keeping even once a richer source names the individual awards: OMDb counts
 * festivals and minor awards that Wikidata's coverage misses, so the totals
 * are the honest "and this many more".
 *
 * The headline count is included in OMDb's own totals, so it is not added on.
 *
 * @param summary - OMDb's `Awards` field
 * @returns Total wins and nominations, zero when unstated
 */
/**
 * Strip a trailing parenthetical qualifier from a title.
 *
 * Streaming services disambiguate regional versions in a way the databases
 * don't: Netflix lists "The Office (U.S.)", "Shameless (U.S.)", "The Bridge
 * (US)". OMDb has no record under those names, so the lookup fails outright on
 * a whole class of well-known shows.
 *
 * This is only ever used to build a *retry*. The original title is tried first
 * and the qualifier is often meaningful, so discarding it up front would be
 * worse than the problem — a few real titles end in parentheses ("Birdman or
 * (The Unexpected Virtue of Ignorance)").
 *
 * @param title - Title as detected on the page
 * @returns The title without its trailing parenthetical, or null if it has none
 */
export function stripTitleQualifier(title: string): string | null {
  const match = title.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
  if (!match) return null;

  const base = match[1].trim();

  // A one-word title reduced to nothing, or a qualifier that was the whole
  // name, leaves us with nothing worth querying
  if (base.length < 2) return null;

  return base;
}

/**
 * Split one of OMDb's comma-joined lists ("Bale, Carell, Gosling").
 *
 * Returns undefined rather than an empty array so an absent field and an
 * empty one are the same thing downstream.
 */
function splitList(value: string | undefined): string[] | undefined {
  const raw = present(value);
  if (!raw) return undefined;

  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

export function parseAwardTotals(summary: string | undefined): {
  wins: number;
  nominations: number;
} {
  const raw = present(summary);
  if (!raw) return { wins: 0, nominations: 0 };

  const totalWins = raw.match(/(\d+)\s+wins?/i);
  const totalNominations = raw.match(/(\d+)\s+nominations?/i);

  let wins = totalWins ? parseInt(totalWins[1], 10) : 0;
  let nominations = totalNominations ? parseInt(totalNominations[1], 10) : 0;

  // Some summaries only carry the headline: "Won 4 Oscars." with no totals
  const headline = raw.match(/^(Won|Nominated for)\s+(\d+)/i);
  if (headline) {
    const count = parseInt(headline[2], 10);
    if (/^won$/i.test(headline[1])) {
      wins = Math.max(wins, count);
    } else {
      nominations = Math.max(nominations, count);
    }
  }

  return { wins, nominations };
}

export function parseAwards(
  summary: string | undefined,
  year: number
): ParsedAward[] {
  const raw = present(summary);
  if (!raw) return [];

  const awards: ParsedAward[] = [];

  // Headline clause: "Won 4 Oscars." / "Nominated for 3 Oscars."
  const headline = raw.match(/^(Won|Nominated for)\s+(\d+)\s+([^.]+)/i);

  let headlineWins = 0;
  let headlineNominations = 0;

  if (headline) {
    const isWin = /^won$/i.test(headline[1]);
    const count = parseInt(headline[2], 10);
    const name = normalizeAwardName(headline[3]);

    if (count > 0) {
      awards.push({ name, year, isWin, count });
      if (isWin) {
        headlineWins = count;
      } else {
        headlineNominations = count;
      }
    }
  }

  // Totals clause: "159 wins & 220 nominations total."
  const totalWins = raw.match(/(\d+)\s+wins?/i);
  const totalNominations = raw.match(/(\d+)\s+nominations?/i);

  const remainingWins = totalWins
    ? parseInt(totalWins[1], 10) - headlineWins
    : 0;
  const remainingNominations = totalNominations
    ? parseInt(totalNominations[1], 10) - headlineNominations
    : 0;

  if (remainingWins > 0) {
    awards.push({
      name: "Other awards",
      category: "wins",
      year,
      isWin: true,
      count: remainingWins,
    });
  }

  if (remainingNominations > 0) {
    awards.push({
      name: "Nominations",
      year,
      isWin: false,
      count: remainingNominations,
    });
  }

  return awards;
}

/**
 * Raw OMDb response shape (only the fields we consume)
 */
export interface OmdbResponse {
  Response: "True" | "False";
  Error?: string;
  Title?: string;
  Year?: string;
  Runtime?: string;
  Genre?: string;
  Plot?: string;
  Actors?: string;
  Writer?: string;
  Rated?: string;
  Director?: string;
  Poster?: string;
  Awards?: string;
  imdbID?: string;
  imdbRating?: string;
  Metascore?: string;
  Ratings?: Array<{ Source: string; Value: string }>;
}

/**
 * Extract movie metadata, ratings, and awards from an OMDb response
 */
export function parseOmdbResponse(data: OmdbResponse): {
  movie: ParsedMovie;
  ratings: ParsedRating[];
  awards: ParsedAward[];
} {
  const year = parseYear(data.Year);

  const movie: ParsedMovie = {
    title: present(data.Title) ?? "",
    year,
    imdbId: present(data.imdbID),
    genre: present(data.Genre)
      ?.split(",")
      .map((g) => g.trim())
      .filter(Boolean),
    posterUrl: present(data.Poster),
    runtime: parseRuntime(data.Runtime),
    director: present(data.Director),
    plot: present(data.Plot),
    actors: splitList(data.Actors),
    writer: splitList(data.Writer),
    rated: present(data.Rated),
  };

  const ratings: ParsedRating[] = [];
  const seen = new Set<RatingSource>();

  for (const entry of data.Ratings ?? []) {
    const source = mapRatingSource(entry.Source);
    if (!source || seen.has(source)) continue;

    const score = parseRatingValue(entry.Value);
    if (score === null) continue;

    const maxScore = source === "IMDb" ? 10 : 100;
    ratings.push({ source, score, maxScore });
    seen.add(source);
  }

  // The Ratings array is sometimes missing entries that the top-level fields
  // still carry, so backfill from those.
  if (!seen.has("IMDb")) {
    const imdbScore = parseRatingValue(present(data.imdbRating) ?? "");
    if (imdbScore !== null) {
      ratings.push({ source: "IMDb", score: imdbScore, maxScore: 10 });
    }
  }

  if (!seen.has("Metacritic")) {
    const metaScore = parseRatingValue(present(data.Metascore) ?? "");
    if (metaScore !== null) {
      ratings.push({ source: "Metacritic", score: metaScore, maxScore: 100 });
    }
  }

  return {
    movie,
    awards: parseAwards(data.Awards, year ?? 0),
    ratings,
  };
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

/**
 * Why an OMDb request didn't produce a title.
 *
 * Neither the status nor the body is sufficient alone. OMDb returns 401 for
 * *both* "Invalid API key!" and "Request limit reached!", so the status can't
 * tell a wrong key from an exhausted quota — only the body can. And the body
 * can't be trusted on its own either: a `{"Response":"False"}` whose `Error`
 * we don't recognise must not be read as "no such title", because that answer
 * gets cached and outlives whatever actually caused it.
 *
 * So: read both, and default anything unfamiliar to retryable rather than to a
 * cached miss.
 */
export type OmdbFailureKind =
  | "notFound"
  | "invalidKey"
  | "rateLimited"
  | "badRequest"
  | "transient";

export interface OmdbFailure {
  kind: OmdbFailureKind;
  /** Text worth showing a developer — OMDb's own wording where there is any */
  message: string;
}

/**
 * Work out what an unsuccessful OMDb response means.
 *
 * Verified against the live API: a missing key gives 401 "No API key
 * provided.", a wrong one 401 "Invalid API key!". A genuine miss comes back
 * as 200 with "Movie not found!".
 *
 * @param error - The `Error` field from the body, if there was one
 * @param httpStatus - HTTP status, when the failure was at that level
 * @returns The classified failure
 */
export function classifyOmdbFailure(
  error: string | undefined,
  httpStatus?: number
): OmdbFailure {
  const message = error?.trim() || `OMDb request failed (HTTP ${httpStatus ?? "?"})`;

  if (error) {
    // OMDb's error strings are a small, stable set
    if (/limit reached/i.test(error)) return { kind: "rateLimited", message };
    if (/api key/i.test(error)) return { kind: "invalidKey", message };
    if (/not found/i.test(error)) return { kind: "notFound", message };
    if (/incorrect imdb id/i.test(error)) return { kind: "badRequest", message };
  }

  if (httpStatus === 401) return { kind: "invalidKey", message };
  if (httpStatus === 429) return { kind: "rateLimited", message };
  if (httpStatus !== undefined && httpStatus >= 500) {
    return { kind: "transient", message };
  }

  // Anything unrecognised is treated as transient rather than as a miss.
  // Guessing "no such title" would cache a negative we can't justify; the cost
  // of guessing wrong the other way is one retried request.
  return { kind: "transient", message };
}

/**
 * Should this failure be retried?
 *
 * Only genuinely transient ones. Retrying an invalid key or an exhausted quota
 * just spends more of a 1,000-a-day allowance to get the same answer.
 */
export function isRetryable(failure: OmdbFailure): boolean {
  return failure.kind === "transient";
}

/**
 * Is this failure worth caching as "there is no such title"?
 *
 * Only a real miss. Caching anything else would outlast the problem that
 * caused it.
 */
export function isCacheableMiss(failure: OmdbFailure): boolean {
  return failure.kind === "notFound";
}

/**
 * Turn a failure into something actionable for whoever has to fix it.
 */
export function describeFailure(failure: OmdbFailure): string {
  switch (failure.kind) {
    case "invalidKey":
      return `OMDb rejected the API key (${failure.message}). Check it with: npx convex env set OMDB_API_KEY <key>`;
    case "rateLimited":
      return `OMDb quota exhausted (${failure.message}). The free tier allows 1,000 requests a day.`;
    case "badRequest":
      return `OMDb rejected the query (${failure.message}).`;
    case "notFound":
      return failure.message;
    case "transient":
      return `OMDb request failed (${failure.message}).`;
  }
}
