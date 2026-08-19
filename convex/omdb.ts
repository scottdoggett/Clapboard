/**
 * OMDb Ingestion
 *
 * This is the only place in the backend that talks to an external ratings
 * provider. The extension never calls OMDb directly — it calls the `lookup`
 * action here, which serves from the Convex cache when it can and falls back
 * to OMDb when the cache is cold or stale. That keeps the API key server-side
 * and makes the database a shared cache across all users.
 *
 * OMDb returns IMDb, Rotten Tomatoes, and Metacritic in a single request, plus
 * a free-text awards summary. Letterboxd has no public API, so it stays absent
 * until we add a provider for it.
 */

import {
  action,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { fetchWikidataAwards } from "./wikidata";
import { mergeAwards } from "./wikidataParse";
import { fetchMdblistRatings } from "./mdblist";
import { mergeRatings } from "./mdblistParse";
import { fetchTmdbMetadata } from "./tmdb";
import { mergeMetadata } from "./tmdbParse";
import {
  lookupKey,
  parseAwardTotals,
  stripTitleQualifier,
  parseOmdbResponse,
  classifyOmdbFailure,
  isRetryable,
  isCacheableMiss,
  describeFailure,
  type LookupResult,
  type OmdbFailure,
  type OmdbResponse,
} from "./omdbParse";

/**
 * How long a cached lookup stays fresh before we re-fetch from OMDb.
 *
 * Mirrors CACHE_CONFIG.RATINGS_TTL_MS in src/shared/constants.ts. It is
 * duplicated rather than imported because Convex bundles the `convex/`
 * directory on its own and does not resolve the extension's path aliases.
 */
const RATINGS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Negative results expire faster — a title we couldn't match today may match
 * tomorrow once OMDb catches up, and site titles get corrected over time.
 */
const NOT_FOUND_TTL_MS = 60 * 60 * 1000; // 1 hour

const OMDB_ENDPOINT = "https://www.omdbapi.com/";

/** Attempts per request, including the first. Only transient failures retry. */
const MAX_ATTEMPTS = 3;

/** Backoff before retry N, in ms. */
const RETRY_DELAY_MS = [250, 750];

/**
 * Content type as detected by the extension
 */
const contentType = v.union(v.literal("movie"), v.literal("series"));

// ---------------------------------------------------------------------------
// Internal database access (called by the action)
// ---------------------------------------------------------------------------

/**
 * Shape a movie doc plus its ratings and awards into the extension payload
 */
function toLookupResult(
  movie: Doc<"movies">,
  ratings: Doc<"ratings">[],
  awards: Doc<"awards">[]
): LookupResult {
  return {
    movie: {
      id: movie._id,
      title: movie.title,
      year: movie.year,
      imdbId: movie.imdbId,
      tmdbId: movie.tmdbId,
      plot: movie.plot,
      actors: movie.actors,
      writer: movie.writer,
      rated: movie.rated,
      genre: movie.genre,
      posterUrl: movie.posterUrl,
      runtime: movie.runtime,
      director: movie.director,
      awards: awards.map((award) => ({
        id: award._id,
        name: award.name,
        category: award.category,
        year: award.year,
        isWin: award.isWin,
        count: award.count,
        people: award.people,
        url: award.url,
      })),
    },
    ratings: ratings.map((rating) => ({
      id: rating._id,
      movieId: rating.movieId,
      source: rating.source,
      score: rating.score,
      maxScore: rating.maxScore,
      fetchedAt: rating.fetchedAt,
    })),
  };
}

/**
 * Read a cached lookup, if one exists and is still fresh.
 *
 * Returns `{ status: "miss" }` when we should hit OMDb, `{ status: "empty" }`
 * for a fresh negative result, and `{ status: "hit", result }` otherwise.
 */
export const getCachedLookup = internalQuery({
  args: {
    key: v.string(),
  },
  handler: async (ctx, { key }) => {
    const cached = await ctx.db
      .query("lookups")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!cached) {
      return { status: "miss" as const };
    }

    const age = Date.now() - cached.fetchedAt;
    const ttl = cached.movieId ? RATINGS_TTL_MS : NOT_FOUND_TTL_MS;

    if (age > ttl) {
      return { status: "miss" as const };
    }

    if (!cached.movieId) {
      return { status: "empty" as const };
    }

    const movie = await ctx.db.get(cached.movieId);
    if (!movie) {
      // Movie was deleted out from under the lookup row
      return { status: "miss" as const };
    }

    const [ratings, awards] = await Promise.all([
      ctx.db
        .query("ratings")
        .withIndex("by_movie", (q) => q.eq("movieId", movie._id))
        .collect(),
      ctx.db
        .query("awards")
        .withIndex("by_movie", (q) => q.eq("movieId", movie._id))
        .collect(),
    ]);

    return {
      status: "hit" as const,
      result: toLookupResult(movie, ratings, awards),
    };
  },
});

/**
 * Persist a fresh OMDb result: upsert the movie, replace its ratings and
 * awards, and record the lookup so the next request hits the cache.
 */
export const persistLookup = internalMutation({
  args: {
    key: v.string(),
    movie: v.object({
      title: v.string(),
      year: v.optional(v.number()),
      imdbId: v.optional(v.string()),
      tmdbId: v.optional(v.string()),
      plot: v.optional(v.string()),
      actors: v.optional(v.array(v.string())),
      writer: v.optional(v.array(v.string())),
      rated: v.optional(v.string()),
      genre: v.optional(v.array(v.string())),
      posterUrl: v.optional(v.string()),
      runtime: v.optional(v.number()),
      director: v.optional(v.string()),
    }),
    ratings: v.array(
      v.object({
        source: v.union(
          v.literal("IMDb"),
          v.literal("RottenTomatoes"),
          v.literal("Metacritic"),
          v.literal("Letterboxd")
        ),
        score: v.number(),
        maxScore: v.number(),
      })
    ),
    awards: v.array(
      v.object({
        name: v.string(),
        category: v.optional(v.string()),
        year: v.number(),
        isWin: v.boolean(),
        count: v.number(),
        people: v.optional(v.array(v.string())),
        url: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find an existing movie by IMDb ID (the only reliable identifier)
    let movieId: Id<"movies"> | null = null;

    if (args.movie.imdbId) {
      const existing = await ctx.db
        .query("movies")
        .withIndex("by_imdb_id", (q) => q.eq("imdbId", args.movie.imdbId))
        .first();

      if (existing) {
        movieId = existing._id;
      }
    }

    if (movieId) {
      await ctx.db.patch(movieId, { ...args.movie, updatedAt: now });
    } else {
      movieId = await ctx.db.insert("movies", {
        ...args.movie,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Replace ratings — sources can disappear between fetches, so a wholesale
    // replace keeps us from serving a rating OMDb no longer reports.
    const staleRatings = await ctx.db
      .query("ratings")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    for (const rating of staleRatings) {
      await ctx.db.delete(rating._id);
    }

    for (const rating of args.ratings) {
      await ctx.db.insert("ratings", {
        movieId,
        source: rating.source,
        score: rating.score,
        maxScore: rating.maxScore,
        fetchedAt: now,
      });
    }

    // Replace awards for the same reason
    const staleAwards = await ctx.db
      .query("awards")
      .withIndex("by_movie", (q) => q.eq("movieId", movieId))
      .collect();

    for (const award of staleAwards) {
      await ctx.db.delete(award._id);
    }

    for (const award of args.awards) {
      await ctx.db.insert("awards", {
        movieId,
        name: award.name,
        category: award.category,
        year: award.year,
        isWin: award.isWin,
        count: award.count,
        people: award.people,
        url: award.url,
        createdAt: now,
      });
    }

    await upsertLookupRow(ctx, args.key, movieId, now);

    const [ratings, awards, movie] = await Promise.all([
      ctx.db
        .query("ratings")
        .withIndex("by_movie", (q) => q.eq("movieId", movieId))
        .collect(),
      ctx.db
        .query("awards")
        .withIndex("by_movie", (q) => q.eq("movieId", movieId))
        .collect(),
      ctx.db.get(movieId),
    ]);

    if (!movie) {
      throw new Error("Movie disappeared during persist");
    }

    return toLookupResult(movie, ratings, awards);
  },
});

/**
 * Record that a lookup found nothing, so repeat misses don't re-hit OMDb
 */
export const persistNotFound = internalMutation({
  args: {
    key: v.string(),
  },
  handler: async (ctx, { key }) => {
    await upsertLookupRow(ctx, key, undefined, Date.now());
  },
});

/**
 * Insert or refresh a lookup cache row
 */
async function upsertLookupRow(
  ctx: MutationCtx,
  key: string,
  movieId: Id<"movies"> | undefined,
  now: number
): Promise<void> {
  const existing = await ctx.db
    .query("lookups")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { movieId, fetchedAt: now });
  } else {
    await ctx.db.insert("lookups", { key, movieId, fetchedAt: now });
  }
}

// ---------------------------------------------------------------------------
// Public action
// ---------------------------------------------------------------------------

/**
 * The outcome of one OMDb query: a title, or a classified reason there isn't one.
 */
type OmdbFetchResult =
  | { ok: true; data: OmdbResponse }
  | { ok: false; failure: OmdbFailure };

/**
 * Call OMDb, retrying only failures that retrying can fix.
 *
 * Both the status and the body feed the classification: 401 covers a wrong key
 * and an exhausted quota alike, and a 200 can still carry `{"Response":"False"}`
 * for a miss.
 */
async function fetchOmdb(
  apiKey: string,
  params: Record<string, string>
): Promise<OmdbFetchResult> {
  const url = new URL(OMDB_ENDPOINT);
  url.searchParams.set("apikey", apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let failure: OmdbFailure = { kind: "transient", message: "no attempt made" };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY_MS[attempt - 1] ?? 750)
      );
    }

    try {
      const response = await fetch(url.toString());

      // The body is worth reading whatever the status: OMDb puts its own
      // explanation there even on a 401, and "Invalid API key!" is a great
      // deal more useful to act on than "HTTP 401".
      const data = await response
        .json()
        .then((body) => body as OmdbResponse)
        .catch(() => null);

      if (response.ok && data?.Response === "True") {
        return { ok: true, data };
      }

      failure = classifyOmdbFailure(data?.Error, response.status);
    } catch (error) {
      // Network-level failure — no status, no body, always worth one more go
      failure = {
        kind: "transient",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!isRetryable(failure)) break;
  }

  return { ok: false, failure };
}

/**
 * Resolve a title against OMDb, widening the search if the exact match fails.
 *
 * Streaming sites often show a title without the year, or with a localized or
 * abbreviated name, so we try progressively looser queries.
 *
 * A failure that isn't "no such title" stops the ladder immediately. Trying
 * three more variations against a rejected key or an exhausted quota just
 * spends more of a 1,000-a-day allowance to be told the same thing.
 */
async function resolveFromOmdb(
  apiKey: string,
  title: string,
  year?: number,
  type?: "movie" | "series"
): Promise<OmdbFetchResult> {
  const typeParam: Record<string, string> = type ? { type } : {};
  let lastFailure: OmdbFailure = {
    kind: "notFound",
    message: `No OMDb match for "${title}"`,
  };

  /** Run one query; returns the result, or null to keep widening. */
  const attempt = async (
    params: Record<string, string>
  ): Promise<OmdbFetchResult | null> => {
    const result = await fetchOmdb(apiKey, params);

    if (result.ok) return result;

    lastFailure = result.failure;
    return isCacheableMiss(result.failure) ? null : result;
  };

  // 1. Exact title, with year if we have one
  if (year !== undefined) {
    const withYear = await attempt({
      t: title,
      y: String(year),
      plot: "short",
      ...typeParam,
    });
    if (withYear) return withYear;
  }

  // 2. Exact title, no year
  const withoutYear = await attempt({ t: title, plot: "short", ...typeParam });
  if (withoutYear) return withoutYear;

  // 3. Drop a trailing parenthetical qualifier. Streaming services
  //    disambiguate regional versions ("The Office (U.S.)") in a way the
  //    databases don't, and the exact-title attempts above cannot match those.
  const withoutQualifier = stripTitleQualifier(title);
  if (withoutQualifier) {
    const qualifierStripped = await attempt({
      t: withoutQualifier,
      plot: "short",
      ...typeParam,
    });
    if (qualifierStripped) return qualifierStripped;
  }

  // 4. Search, then fetch full details for the best match. The `s` endpoint
  //    returns no ratings, so a second request by IMDb ID is required.
  const search = await fetchOmdb(apiKey, {
    s: withoutQualifier ?? title,
    ...typeParam,
  });

  if (!search.ok) {
    return isCacheableMiss(search.failure)
      ? { ok: false, failure: lastFailure }
      : search;
  }

  const firstMatch = (search.data as OmdbResponse & {
    Search?: Array<{ imdbID: string }>;
  }).Search?.[0]?.imdbID;

  if (!firstMatch) {
    return { ok: false, failure: lastFailure };
  }

  return await fetchOmdb(apiKey, { i: firstMatch, plot: "short" });
}

/**
 * Fill out an OMDb result with everything the other providers can add.
 *
 * OMDb resolves the title — it's the only one of the four that searches well by
 * name — and then three optional providers deepen the result, each answering a
 * question OMDb answers badly or not at all:
 *
 * - **Wikidata** names the awards. OMDb only counts them. No key needed.
 * - **MDBList** adds Letterboxd, which nothing else carries. Needs a key.
 * - **TMDB** has better artwork, and a rate limit measured per second rather
 *   than per day. Needs a key.
 *
 * None of them is allowed to fail the lookup. Each returns empty on any error
 * and the result is simply what OMDb gave — a card with ratings and no
 * Letterboxd score is fine, a card with nothing because a third-party endpoint
 * was slow is not.
 *
 * They run concurrently: none depends on another, and doing them in sequence
 * would stack three timeouts onto a request a user is waiting on.
 *
 * @param parsed - The parsed OMDb response
 * @param awardsSummary - OMDb's raw `Awards` sentence
 * @param type - Content type hint from the extension
 * @returns The enriched movie, ratings and awards
 */
async function enrichLookup(
  parsed: ReturnType<typeof parseOmdbResponse>,
  awardsSummary: string | undefined,
  type: "movie" | "series" | undefined
): Promise<ReturnType<typeof parseOmdbResponse>> {
  const imdbId = parsed.movie.imdbId;
  if (!imdbId) return parsed;

  const year = parsed.movie.year ?? new Date().getFullYear();

  const [named, extraRatings, tmdbMetadata] = await Promise.all([
    fetchWikidataAwards(imdbId, year),
    fetchMdblistRatings(imdbId, type),
    fetchTmdbMetadata(imdbId),
  ]);

  return {
    movie: mergeMetadata(parsed.movie, tmdbMetadata),
    ratings: mergeRatings(parsed.ratings, extraRatings),
    awards:
      named.length > 0
        ? mergeAwards(named, parseAwardTotals(awardsSummary), year)
        : parsed.awards,
  };
}

/**
 * Look up a title's ratings and awards.
 *
 * Serves from the Convex cache when fresh, otherwise fetches from OMDb and
 * stores the result. Returns null when the title can't be matched.
 */
export const lookup = action({
  args: {
    title: v.string(),
    year: v.optional(v.number()),
    type: v.optional(contentType),
  },
  handler: async (ctx, { title, year, type }): Promise<LookupResult | null> => {
    const key = lookupKey(title, year, type);

    const cached = await ctx.runQuery(internal.omdb.getCachedLookup, { key });

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "empty") {
      return null;
    }

    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OMDB_API_KEY is not set. Add it with: npx convex env set OMDB_API_KEY <key>"
      );
    }

    const result = await resolveFromOmdb(apiKey, title, year, type);

    if (!result.ok) {
      // Only a real miss is worth remembering. Caching an unrecognised failure
      // as "no such title" would outlast whatever caused it, and make the fix
      // look like it changed nothing.
      if (isCacheableMiss(result.failure)) {
        await ctx.runMutation(internal.omdb.persistNotFound, { key });
        return null;
      }

      throw new Error(describeFailure(result.failure));
    }

    if (!result.data.imdbID) {
      await ctx.runMutation(internal.omdb.persistNotFound, { key });
      return null;
    }

    const parsed = parseOmdbResponse(result.data);
    const enriched = await enrichLookup(parsed, result.data.Awards, type);

    return await ctx.runMutation(internal.omdb.persistLookup, {
      key,
      movie: enriched.movie,
      ratings: enriched.ratings,
      awards: enriched.awards,
    });
  },
});
