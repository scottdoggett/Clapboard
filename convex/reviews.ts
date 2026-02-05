/**
 * Convex Reviews Queries & Mutations
 *
 * Functions for managing review data and AI-generated scores.
 * Phase 3 feature — mostly stubs for now.
 *
 * Workflow:
 * 1. Fetch reviews from external sources (critics, Letterboxd, etc.)
 * 2. Store raw review text in this table
 * 3. Process reviews with AI to generate category scores
 * 4. Return aggregated AI scores to the extension
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * AI scores schema
 */
const aiScoresSchema = v.object({
  cinematography: v.optional(v.number()),
  plot: v.optional(v.number()),
  writing: v.optional(v.number()),
  characters: v.optional(v.number()),
  soundtrack: v.optional(v.number()),
  overall: v.optional(v.number()),
});

/**
 * Get all reviews for a movie
 */
export const getForMovie = query({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    return await ctx.db
      .query("reviews")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();
  },
});

/**
 * Get aggregated AI scores for a movie
 * Averages scores across all processed reviews
 */
export const getAiScores = query({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    // Filter to only processed reviews with AI scores
    const processedReviews = reviews.filter(
      (r) => r.processedAt && r.aiScores
    );

    if (processedReviews.length === 0) {
      return null;
    }

    // Aggregate scores across all reviews
    const categories = [
      "cinematography",
      "plot",
      "writing",
      "characters",
      "soundtrack",
      "overall",
    ] as const;

    const aggregated: Record<string, number> = {};

    for (const category of categories) {
      const scores = processedReviews
        .map((r) => r.aiScores?.[category])
        .filter((s): s is number => s !== undefined);

      if (scores.length > 0) {
        aggregated[category] =
          Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
          10;
      }
    }

    return {
      scores: aggregated,
      reviewCount: processedReviews.length,
    };
  },
});

/**
 * Add a review for processing
 */
export const add = mutation({
  args: {
    movieId: v.id("movies"),
    sourceUrl: v.string(),
    rawText: v.string(),
  },
  handler: async (ctx, { movieId, sourceUrl, rawText }) => {
    // Validate movie exists
    const movie = await ctx.db.get(movieId);
    if (!movie) {
      throw new Error(`Movie not found: ${movieId}`);
    }

    // Check if we already have this review
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_source_url", (q) => q.eq("sourceUrl", sourceUrl))
      .first();

    if (existing) {
      // Update existing review text
      await ctx.db.patch(existing._id, {
        rawText,
        // Clear AI scores if text changed — will need reprocessing
        aiScores: undefined,
        processedAt: undefined,
      });
      return existing._id;
    }

    // Create new review
    return await ctx.db.insert("reviews", {
      movieId,
      sourceUrl,
      rawText,
    });
  },
});

/**
 * Update AI scores for a review (called after AI processing)
 */
export const updateAiScores = mutation({
  args: {
    id: v.id("reviews"),
    aiScores: aiScoresSchema,
  },
  handler: async (ctx, { id, aiScores }) => {
    const review = await ctx.db.get(id);
    if (!review) {
      throw new Error(`Review not found: ${id}`);
    }

    await ctx.db.patch(id, {
      aiScores,
      processedAt: Date.now(),
    });

    return id;
  },
});

/**
 * Get reviews that need AI processing
 */
export const getUnprocessed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 10 }) => {
    // Get reviews without processedAt timestamp
    const allReviews = await ctx.db.query("reviews").collect();

    const unprocessed = allReviews.filter((r) => !r.processedAt);

    return unprocessed.slice(0, limit);
  },
});

/**
 * Request AI processing for a movie's reviews
 * This would typically trigger a background job
 */
export const requestProcessing = mutation({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    // TODO: Implement actual processing trigger
    // This could:
    // 1. Add to a processing queue
    // 2. Trigger a Convex action that calls an AI API
    // 3. Schedule a cron job

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    const unprocessed = reviews.filter((r) => !r.processedAt);

    console.log(
      `[Clapboard] Processing requested for ${unprocessed.length} reviews`
    );

    // Placeholder: Return count of reviews to process
    return {
      total: reviews.length,
      unprocessed: unprocessed.length,
    };
  },
});

/**
 * Delete a review
 */
export const remove = mutation({
  args: {
    id: v.id("reviews"),
  },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/**
 * Delete all reviews for a movie
 */
export const removeAllForMovie = mutation({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    for (const review of reviews) {
      await ctx.db.delete(review._id);
    }

    return reviews.length;
  },
});
