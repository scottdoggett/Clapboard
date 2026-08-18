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
  awards?: Award[];
}

/**
 * User profile (Phase 4)
 */
export interface User {
  id: string;
  clerkId: string;
  email: string;
  name?: string;
  createdAt: number;
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
