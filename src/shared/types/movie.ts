/**
 * Movie Types
 *
 * TypeScript interfaces for movie data, ratings, awards, and AI scores.
 * These types mirror the Convex database schema and are used throughout
 * the extension for type safety.
 */

/**
 * Rating source identifiers
 */
export type RatingSource = "IMDb" | "RottenTomatoes" | "Metacritic" | "Letterboxd";

/**
 * AI score categories
 */
export type ScoreCategory =
  | "cinematography"
  | "plot"
  | "writing"
  | "characters"
  | "soundtrack"
  | "overall";

/**
 * AI-generated scores object
 */
export interface AiScores {
  cinematography?: number; // 0-10 scale
  plot?: number;
  writing?: number;
  characters?: number;
  soundtrack?: number;
  overall?: number;
}

/**
 * A review the AI scores were drawn from
 */
export interface AiScoreSource {
  url: string;
  publication?: string;
}

/**
 * A completed AI scoring run for a title.
 *
 * The sources are part of the result, not decoration: the claim being made is
 * "this is what reviewers said", which is only worth anything if the reader can
 * go and check.
 */
export interface AiScoreResult {
  scores: AiScores;
  /** One or two sentences on the critical consensus */
  summary?: string;
  sources: AiScoreSource[];
  /** Model that produced the scores */
  model: string;
  generatedAt: number;
}

/**
 * What a scoring request came back as.
 *
 * Four outcomes rather than "scores or nothing", because the overlay has to
 * say something different for each. "No reviews" is permanent and worth
 * saying plainly; a pending run and a spend ceiling are both "later", but only
 * one of them is about this title.
 */
export type AiScoreOutcome =
  | { status: "scored"; result: AiScoreResult }
  | { status: "unavailable" }
  | { status: "pending" }
  | { status: "rateLimited"; retryAfterMs: number };

/**
 * Movie rating from a single source
 */
export interface Rating {
  id: string;
  movieId: string;
  source: RatingSource;
  score: number;
  maxScore: number; // e.g., 10 for IMDb, 100 for RT/Metacritic
  fetchedAt: number; // Unix timestamp
}

/**
 * Award information
 */
export interface Award {
  id: string;
  name: string; // e.g., "Oscar", "Golden Globe"
  category?: string; // e.g., "Best Picture", "Best Actor"
  year: number;
  isWin: boolean; // true = won, false = nominated

  // How many of this award. Our upstream source reports counts rather than
  // individual categories ("Won 4 Oscars"), so one record can stand for
  // several awards. Treat a missing count as 1.
  count?: number;

  /**
   * Who received it. Present only where the awards data attributes the award
   * to people — an acting or writing award names its recipients, "Best
   * Picture" names its producers, a festival's top-ten list names nobody.
   */
  people?: string[];

  /** Article explaining the award, where the awards provider has one */
  url?: string;
}

/**
 * Movie metadata
 */
export interface Movie {
  id: string;
  title: string;
  year?: number;
  tmdbId?: string;
  imdbId?: string;
  genre?: string[];
  posterUrl?: string;
  runtime?: number; // in minutes
  director?: string;
  plot?: string;
  actors?: string[];
  writer?: string[];
  /** Certification, e.g. "R", "TV-MA" */
  rated?: string;
  awards?: Award[];
}

/**
 * Review data for AI processing (Phase 3)
 */
export interface Review {
  id: string;
  movieId: string;
  sourceUrl: string;
  rawText: string;
  aiScores?: AiScores;
  processedAt?: number;
}

/**
 * Aggregated movie data returned to content script
 */
export interface MovieData {
  movie: Movie;
  ratings: Rating[];
  averageScore?: number; // Normalized 0-100
}
