/**
 * Convex Movie Queries & Mutations
 *
 * Functions for querying and managing movie data.
 * Movies are the core entity that ratings, awards, and reviews attach to.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get a movie by its title (and optionally year for disambiguation)
 */
export const getByTitle = query({
  args: {
    title: v.string(),
    year: v.optional(v.number()),
  },
  handler: async (ctx, { title, year }) => {
    // Search by title
    const movies = await ctx.db
      .query("movies")
      .withIndex("by_title", (q) => q.eq("title", title))
      .collect();

    if (movies.length === 0) {
      return null;
    }

    // If year specified, filter to match
    if (year !== undefined) {
      const exactMatch = movies.find((m) => m.year === year);
      if (exactMatch) return exactMatch;
    }

    // Return the most recent if multiple matches
    return movies.sort((a, b) => (b.year || 0) - (a.year || 0))[0];
  },
});

/**
 * Get a movie by IMDb ID
 */
export const getByImdbId = query({
  args: {
    imdbId: v.string(),
  },
  handler: async (ctx, { imdbId }) => {
    return await ctx.db
      .query("movies")
      .withIndex("by_imdb_id", (q) => q.eq("imdbId", imdbId))
      .first();
  },
});

/**
 * Get a movie by TMDB ID
 */
export const getByTmdbId = query({
  args: {
    tmdbId: v.string(),
  },
  handler: async (ctx, { tmdbId }) => {
    return await ctx.db
      .query("movies")
      .withIndex("by_tmdb_id", (q) => q.eq("tmdbId", tmdbId))
      .first();
  },
});

/**
 * Get a movie by its Convex ID
 */
export const getById = query({
  args: {
    id: v.id("movies"),
  },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * Create a new movie record
 */
export const create = mutation({
  args: {
    title: v.string(),
    year: v.optional(v.number()),
    tmdbId: v.optional(v.string()),
    imdbId: v.optional(v.string()),
    genre: v.optional(v.array(v.string())),
    posterUrl: v.optional(v.string()),
    runtime: v.optional(v.number()),
    director: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert("movies", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update an existing movie record
 */
export const update = mutation({
  args: {
    id: v.id("movies"),
    title: v.optional(v.string()),
    year: v.optional(v.number()),
    tmdbId: v.optional(v.string()),
    imdbId: v.optional(v.string()),
    genre: v.optional(v.array(v.string())),
    posterUrl: v.optional(v.string()),
    runtime: v.optional(v.number()),
    director: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...updates }) => {
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error(`Movie not found: ${id}`);
    }

    // Filter out undefined values and add updatedAt
    const fieldsToUpdate = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    await ctx.db.patch(id, {
      ...fieldsToUpdate,
      updatedAt: Date.now(),
    });

    return id;
  },
});

/**
 * Search movies by partial title match
 * Note: For production, consider using a full-text search solution
 */
export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query: searchQuery, limit = 10 }) => {
    // Get all movies and filter (not efficient at scale — use search index in production)
    const allMovies = await ctx.db.query("movies").collect();

    const searchLower = searchQuery.toLowerCase();
    const matches = allMovies.filter((movie) =>
      movie.title.toLowerCase().includes(searchLower)
    );

    // Sort by relevance (exact match first, then by year)
    matches.sort((a, b) => {
      const aExact = a.title.toLowerCase() === searchLower;
      const bExact = b.title.toLowerCase() === searchLower;
      if (aExact && !bExact) return -1;
      if (bExact && !aExact) return 1;
      return (b.year || 0) - (a.year || 0);
    });

    return matches.slice(0, limit);
  },
});

/**
 * Get or create a movie (upsert by IMDb ID)
 */
export const getOrCreate = mutation({
  args: {
    title: v.string(),
    year: v.optional(v.number()),
    imdbId: v.optional(v.string()),
    tmdbId: v.optional(v.string()),
    genre: v.optional(v.array(v.string())),
    posterUrl: v.optional(v.string()),
    runtime: v.optional(v.number()),
    director: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Try to find by IMDb ID first (most unique)
    if (args.imdbId) {
      const existing = await ctx.db
        .query("movies")
        .withIndex("by_imdb_id", (q) => q.eq("imdbId", args.imdbId))
        .first();

      if (existing) {
        return existing._id;
      }
    }

    // Try to find by TMDB ID
    if (args.tmdbId) {
      const existing = await ctx.db
        .query("movies")
        .withIndex("by_tmdb_id", (q) => q.eq("tmdbId", args.tmdbId))
        .first();

      if (existing) {
        return existing._id;
      }
    }

    // Create new movie
    const now = Date.now();
    return await ctx.db.insert("movies", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
