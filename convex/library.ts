/**
 * Personal Library (server)
 *
 * A signed-in user's watchlist, ratings and reviews.
 *
 * Every function here starts with `requireUserId` and every index starts with
 * `userId`. That is not defensive habit: this is the only table in the schema
 * holding data about a person rather than about a film, and a query that
 * forgets to scope would return someone else's viewing history.
 *
 * The extension keeps the same data locally and works signed out, so these
 * functions are a sync target rather than the source of truth. `push` merges
 * on `updatedAt` so the newer edit wins, because a server that always
 * overwrote would discard whatever was marked while signed out.
 */

import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUserId, currentUserId } from "./auth";

/** Shape shared by everything that reads or writes an entry. */
const entryFields = {
  key: v.string(),
  titleKey: v.string(),
  title: v.string(),
  year: v.optional(v.number()),
  type: v.optional(v.union(v.literal("movie"), v.literal("series"))),
  imdbId: v.optional(v.string()),
  posterUrl: v.optional(v.string()),
  watchedAt: v.optional(v.number()),
  watchlistedAt: v.optional(v.number()),
  sentiment: v.optional(v.union(v.literal("liked"), v.literal("disliked"))),
  rating: v.optional(v.number()),
  reviewText: v.optional(v.string()),
  reviewUpdatedAt: v.optional(v.number()),
  updatedAt: v.number(),
};

/**
 * Is anyone signed in, and who?
 *
 * Deliberately never throws: the popup asks this to decide what to render, and
 * signed out is a normal answer rather than an error.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await currentUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    return { id: userId, email: user.email ?? null, name: user.name ?? null };
  },
});

/**
 * Everything the signed-in user has saved, newest first.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);

    return await ctx.db
      .query("libraryEntries")
      .withIndex("by_user_and_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * Save or update one entry.
 *
 * An entry that records nothing is deleted rather than kept as a husk, which
 * mirrors the local library exactly — the two would otherwise disagree about
 * whether a cleared title still exists.
 */
export const put = mutation({
  args: entryFields,
  handler: async (ctx, entry) => {
    const userId = await requireUserId(ctx);
    const existing = await findEntry(ctx, userId, entry.key, entry.titleKey);

    if (isEmpty(entry)) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }

    if (existing) {
      await ctx.db.patch(existing._id, { ...entry, userId });
      return existing._id;
    }

    return await ctx.db.insert("libraryEntries", { ...entry, userId });
  },
});

/**
 * Merge a batch of local entries, keeping whichever side was edited last.
 *
 * Called when signing in, so that a library built up signed out is not thrown
 * away, and so a second device does not clobber the first.
 *
 * @returns The merged library, for the client to write back locally
 */
export const push = mutation({
  args: { entries: v.array(v.object(entryFields)) },
  handler: async (ctx, { entries }) => {
    const userId = await requireUserId(ctx);

    for (const entry of entries) {
      const existing = await findEntry(ctx, userId, entry.key, entry.titleKey);

      if (!existing) {
        if (!isEmpty(entry)) {
          await ctx.db.insert("libraryEntries", { ...entry, userId });
        }
        continue;
      }

      // Last edit wins. Equal timestamps keep the server's copy, so repeating
      // a push is a no-op rather than a coin toss.
      if (entry.updatedAt > existing.updatedAt) {
        if (isEmpty(entry)) {
          await ctx.db.delete(existing._id);
        } else {
          await ctx.db.patch(existing._id, { ...entry, userId });
        }
      }
    }

    return await ctx.db
      .query("libraryEntries")
      .withIndex("by_user_and_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * Remove one entry outright.
 */
export const remove = mutation({
  args: { key: v.string(), titleKey: v.string() },
  handler: async (ctx, { key, titleKey }) => {
    const userId = await requireUserId(ctx);
    const existing = await findEntry(ctx, userId, key, titleKey);

    if (existing) await ctx.db.delete(existing._id);
  },
});

/**
 * Find a user's entry by its id key, falling back to the title key.
 *
 * The fallback is what lets a title marked from a browse tile — where only a
 * name is on screen — match the same film once its lookup has resolved an
 * IMDb id and changed its key.
 */
async function findEntry(
  ctx: QueryCtx,
  userId: Id<"users">,
  key: string,
  titleKey: string
): Promise<Doc<"libraryEntries"> | null> {
  const byKey = await ctx.db
    .query("libraryEntries")
    .withIndex("by_user_and_key", (q) => q.eq("userId", userId).eq("key", key))
    .first();

  if (byKey) return byKey;

  return await ctx.db
    .query("libraryEntries")
    .withIndex("by_user_and_title", (q) =>
      q.eq("userId", userId).eq("titleKey", titleKey)
    )
    .first();
}

/**
 * Does this entry still record anything the user asked for?
 */
function isEmpty(entry: {
  watchedAt?: number;
  watchlistedAt?: number;
  sentiment?: string;
  rating?: number;
  reviewText?: string;
}): boolean {
  return (
    entry.watchedAt === undefined &&
    entry.watchlistedAt === undefined &&
    entry.sentiment === undefined &&
    entry.rating === undefined &&
    (entry.reviewText === undefined || entry.reviewText.trim() === "")
  );
}
