/**
 * Convex Ratings Queries & Mutations
 *
 * Functions for managing aggregated ratings from multiple sources.
 * Each movie can have multiple ratings (one per source).
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Rating source type
 */
const ratingSource = v.union(
  v.literal("IMDb"),
  v.literal("RottenTomatoes"),
  v.literal("Metacritic"),
  v.literal("Letterboxd")
);

/**
 * Get all ratings for a movie
 */
export const getForMovie = query({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    return await ctx.db
      .query("ratings")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();
  },
});

/**
 * Get a specific rating (by movie and source)
 */
export const getByMovieAndSource = query({
  args: {
    movieId: v.id("movies"),
    source: ratingSource,
  },
  handler: async (ctx, { movieId, source }) => {
    return await ctx.db
      .query("ratings")
      .withIndex("by_movie_and_source", (q) =>
        q.eq("movieId", movieId).eq("source", source)
      )
      .first();
  },
});

/**
 * Upsert a rating (create or update)
 */
export const upsert = mutation({
  args: {
    movieId: v.id("movies"),
    source: ratingSource,
    score: v.number(),
    maxScore: v.number(),
  },
  handler: async (ctx, { movieId, source, score, maxScore }) => {
    // Validate movie exists
    const movie = await ctx.db.get(movieId);
    if (!movie) {
      throw new Error(`Movie not found: ${movieId}`);
    }

    // Check for existing rating
    const existing = await ctx.db
      .query("ratings")
      .withIndex("by_movie_and_source", (q) =>
        q.eq("movieId", movieId).eq("source", source)
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing rating
      await ctx.db.patch(existing._id, {
        score,
        maxScore,
        fetchedAt: now,
      });
      return existing._id;
    }

    // Create new rating
    return await ctx.db.insert("ratings", {
      movieId,
      source,
      score,
      maxScore,
      fetchedAt: now,
    });
  },
});

/**
 * Batch upsert ratings for a movie
 */
export const batchUpsert = mutation({
  args: {
    movieId: v.id("movies"),
    ratings: v.array(
      v.object({
        source: ratingSource,
        score: v.number(),
        maxScore: v.number(),
      })
    ),
  },
  handler: async (ctx, { movieId, ratings }) => {
    // Validate movie exists
    const movie = await ctx.db.get(movieId);
    if (!movie) {
      throw new Error(`Movie not found: ${movieId}`);
    }

    const now = Date.now();
    const results: string[] = [];

    for (const rating of ratings) {
      // Check for existing
      const existing = await ctx.db
        .query("ratings")
        .withIndex("by_movie_and_source", (q) =>
          q.eq("movieId", movieId).eq("source", rating.source)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          score: rating.score,
          maxScore: rating.maxScore,
          fetchedAt: now,
        });
        results.push(existing._id);
      } else {
        const id = await ctx.db.insert("ratings", {
          movieId,
          source: rating.source,
          score: rating.score,
          maxScore: rating.maxScore,
          fetchedAt: now,
        });
        results.push(id);
      }
    }

    return results;
  },
});

/**
 * Delete a rating
 */
export const remove = mutation({
  args: {
    id: v.id("ratings"),
  },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/**
 * Delete all ratings for a movie
 */
export const removeAllForMovie = mutation({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    for (const rating of ratings) {
      await ctx.db.delete(rating._id);
    }

    return ratings.length;
  },
});

/**
 * Get aggregated rating stats for a movie
 */
export const getStats = query({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    if (ratings.length === 0) {
      return null;
    }

    // Calculate normalized scores (0-100)
    const normalizedScores = ratings.map((r) => (r.score / r.maxScore) * 100);

    const average =
      normalizedScores.reduce((a, b) => a + b, 0) / normalizedScores.length;

    const min = Math.min(...normalizedScores);
    const max = Math.max(...normalizedScores);

    return {
      count: ratings.length,
      average: Math.round(average),
      min: Math.round(min),
      max: Math.round(max),
      sources: ratings.map((r) => r.source),
    };
  },
});

/**
 * Check if ratings need refresh (based on age)
 */
export const needsRefresh = query({
  args: {
    movieId: v.id("movies"),
    maxAgeMs: v.optional(v.number()), // Default: 6 hours
  },
  handler: async (ctx, { movieId, maxAgeMs = 6 * 60 * 60 * 1000 }) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    if (ratings.length === 0) {
      return true; // No ratings — definitely needs fetch
    }

    const now = Date.now();
    const oldestFetch = Math.min(...ratings.map((r) => r.fetchedAt));

    return now - oldestFetch > maxAgeMs;
  },
});
