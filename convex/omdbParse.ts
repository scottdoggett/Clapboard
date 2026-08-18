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
}

/**
 * Movie metadata parsed out of an OMDb response
 */
export interface ParsedMovie {
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
    genre?: string[];
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
