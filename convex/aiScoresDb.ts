/**
 * AI Score Storage
 *
 * The database half of Phase 3, split out from `aiScores.ts` because that file
 * runs in Convex's Node runtime (it uses the Anthropic SDK) and Node files can
 * only export actions.
 */

import { internalQuery, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * How long a scored result stays fresh.
 *
 * Long, because reviews are written in the weeks after release and barely
 * change afterwards — and because every regeneration costs an API call plus a
 * web search.
 */
const SCORE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * A title we couldn't score is retried sooner: an obscure or just-released
 * title may pick up reviews, but not by tomorrow.
 */
const INSUFFICIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const scoresValidator = v.object({
  cinematography: v.optional(v.number()),
  plot: v.optional(v.number()),
  writing: v.optional(v.number()),
  characters: v.optional(v.number()),
  soundtrack: v.optional(v.number()),
  overall: v.optional(v.number()),
});

const sourcesValidator = v.array(
  v.object({
    url: v.string(),
    publication: v.optional(v.string()),
  })
);

/**
 * Read the stored scores for a movie, if any are still fresh.
 *
 * Returns `{ status: "miss" }` when a generation run is warranted — which is
 * the expensive path, so a fresh "insufficient" row deliberately reports
 * `empty` rather than `miss`.
 */
export const getCachedScores = internalQuery({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const existing = await ctx.db
      .query("aiScores")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .first();

    if (!existing) {
      return { status: "miss" as const };
    }

    const age = Date.now() - existing.generatedAt;
    const ttl = existing.status === "scored" ? SCORE_TTL_MS : INSUFFICIENT_TTL_MS;

    if (age > ttl) {
      return { status: "miss" as const };
    }

    if (existing.status === "insufficient" || !existing.scores) {
      return { status: "empty" as const };
    }

    return {
      status: "hit" as const,
      result: {
        scores: existing.scores,
        summary: existing.summary,
        sources: existing.sources,
        model: existing.model,
        generatedAt: existing.generatedAt,
      },
    };
  },
});

/**
 * Store the outcome of a scoring run, replacing any previous one.
 *
 * There is one row per movie: an older set of scores has no value once a newer
 * one exists, and keeping history would mean deciding which to serve.
 */
export const persistScores = internalMutation({
  args: {
    movieId: v.id("movies"),
    status: v.union(v.literal("scored"), v.literal("insufficient")),
    scores: v.optional(scoresValidator),
    summary: v.optional(v.string()),
    sources: sourcesValidator,
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("aiScores")
      .withIndex("by_movie", (q) => q.eq("movieId", args.movieId))
      .first();

    const row = {
      movieId: args.movieId,
      status: args.status,
      scores: args.scores,
      summary: args.summary,
      sources: args.sources,
      model: args.model,
      generatedAt: now,
    };

    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("aiScores", row);
    }

    return now;
  },
});

/**
 * Read stored scores without triggering generation.
 *
 * The extension polls this after kicking off a run, and it's also what the
 * popup would use to show what's already known about a title. It never calls
 * the model, so it's safe to hit as often as the UI likes.
 */
export const getForMovie = query({
  args: {
    movieId: v.id("movies"),
  },
  handler: async (ctx, { movieId }) => {
    const existing = await ctx.db
      .query("aiScores")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .first();

    if (!existing || existing.status !== "scored" || !existing.scores) {
      return null;
    }

    return {
      scores: existing.scores,
      summary: existing.summary,
      sources: existing.sources,
      model: existing.model,
      generatedAt: existing.generatedAt,
    };
  },
});
