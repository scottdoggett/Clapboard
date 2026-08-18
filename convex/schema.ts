/**
 * Convex Database Schema
 *
 * Defines the structure of all tables in the Clapboard backend.
 * This schema is used by Convex to generate type-safe database queries.
 *
 * Tables:
 * - movies: Core movie/show metadata
 * - ratings: Aggregated ratings from various sources
 * - users: User accounts (Phase 4)
 * - reviews: Review data for AI processing (Phase 3)
 * - aiScores: Category scores derived from published reviews (Phase 3)
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Movies table
   *
   * Stores core metadata about movies and TV shows.
   * Linked to external databases via tmdbId and imdbId.
   */
  movies: defineTable({
    // Core fields
    title: v.string(),
    year: v.optional(v.number()),

    // External IDs for cross-referencing
    tmdbId: v.optional(v.string()),
    imdbId: v.optional(v.string()),

    // Metadata
    genre: v.optional(v.array(v.string())),
    posterUrl: v.optional(v.string()),
    runtime: v.optional(v.number()), // in minutes
    director: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_title", ["title"])
    .index("by_imdb_id", ["imdbId"])
    .index("by_tmdb_id", ["tmdbId"]),

  /**
   * Ratings table
   *
   * Stores ratings from different sources for each movie.
   * Multiple ratings per movie (one per source).
   */
  ratings: defineTable({
    // Reference to the movie
    movieId: v.id("movies"),

    // Rating source
    source: v.union(
      v.literal("IMDb"),
      v.literal("RottenTomatoes"),
      v.literal("Metacritic"),
      v.literal("Letterboxd")
    ),

    // Score (raw value from source)
    score: v.number(),
    maxScore: v.number(), // 10 for IMDb, 100 for RT/MC, 5 for LB

    // When this rating was fetched
    fetchedAt: v.number(),
  })
    .index("by_movie", ["movieId"])
    .index("by_movie_and_source", ["movieId", "source"]),

  /**
   * Users table (Phase 4)
   *
   * User accounts synced from Clerk authentication.
   */
  users: defineTable({
    // Clerk user ID
    clerkId: v.string(),

    // User info
    email: v.string(),
    name: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  /**
   * Reviews table (Phase 3)
   *
   * Stores review text and AI-generated scores.
   * Reviews are fetched from external sources and processed by AI.
   */
  reviews: defineTable({
    // Reference to the movie
    movieId: v.id("movies"),

    // Source of the review
    sourceUrl: v.string(),

    // Raw review text (for AI processing)
    rawText: v.string(),

    // AI-generated category scores (0-10 scale)
    aiScores: v.optional(
      v.object({
        cinematography: v.optional(v.number()),
        plot: v.optional(v.number()),
        writing: v.optional(v.number()),
        characters: v.optional(v.number()),
        soundtrack: v.optional(v.number()),
        overall: v.optional(v.number()),
      })
    ),

    // Processing status
    processedAt: v.optional(v.number()),
  })
    .index("by_movie", ["movieId"])
    .index("by_source_url", ["sourceUrl"]),

  /**
   * Awards table
   *
   * Stores award wins and nominations for movies.
   */
  awards: defineTable({
    // Reference to the movie
    movieId: v.id("movies"),

    // Award info
    name: v.string(), // e.g., "Oscar", "Golden Globe"
    category: v.optional(v.string()), // e.g., "Best Picture"
    year: v.number(),
    isWin: v.boolean(), // true = won, false = nominated

    // How many of this award (OMDb reports counts, not individual categories —
    // e.g. "Won 4 Oscars" becomes one record with count: 4)
    count: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
  }).index("by_movie", ["movieId"]),

  /**
   * AI scores table
   *
   * Phase 3. One row per movie holding the category scores derived from
   * published reviews, plus the reviews they came from so a score can be
   * traced back rather than taken on faith.
   *
   * Rows are also written when scoring *fails* (`status: "insufficient"`) —
   * generating these costs an API call and a web search, so a title with too
   * few reviews must not be retried on every page view.
   */
  aiScores: defineTable({
    // Reference to the movie
    movieId: v.id("movies"),

    // Whether this run produced usable scores
    status: v.union(v.literal("scored"), v.literal("insufficient")),

    // Category scores on a 0-10 scale. Each is optional: reviews that never
    // mention the soundtrack should leave it empty rather than guess.
    scores: v.optional(
      v.object({
        cinematography: v.optional(v.number()),
        plot: v.optional(v.number()),
        writing: v.optional(v.number()),
        characters: v.optional(v.number()),
        soundtrack: v.optional(v.number()),
        overall: v.optional(v.number()),
      })
    ),

    // One or two sentences on the critical consensus
    summary: v.optional(v.string()),

    // The reviews the scores were drawn from
    sources: v.array(
      v.object({
        url: v.string(),
        publication: v.optional(v.string()),
      })
    ),

    // Which model produced this, so a re-scoring pass can find stale rows
    model: v.string(),

    generatedAt: v.number(),
  }).index("by_movie", ["movieId"]),

  /**
   * Lookups table
   *
   * Caches title -> movie resolutions, including negative results.
   * Streaming sites display titles that don't always match the canonical
   * title returned by OMDb, so we key the cache on the query we were given
   * rather than on the resolved title. A row with no movieId means "we asked
   * and there was no match" — this stops repeat misses from hammering OMDb.
   */
  lookups: defineTable({
    // Normalized "title|year|type" query key
    key: v.string(),

    // Resolved movie, or undefined when the lookup found nothing
    movieId: v.optional(v.id("movies")),

    // When this resolution was performed
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),
});
