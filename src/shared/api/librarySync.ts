/**
 * Library Sync
 *
 * Reconciles the local library with the signed-in user's copy on the server.
 *
 * Local is the working copy: it is written as you browse, it works signed out,
 * and it is correct when the network is not. The server is durability — the
 * thing that survives a reinstall. So sync pushes everything local, the server
 * merges by `updatedAt`, and whatever comes back is written down locally.
 *
 * Merging rather than overwriting is the point. A user who marks ten titles
 * signed out and then signs in should keep those ten, and a second device
 * should not erase the first.
 */

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { STORAGE_KEYS } from "@shared/constants";
import { listEntries, titleKey, type LibraryEntry } from "@shared/utils/library";
import { getStoredAuthToken } from "@shared/utils/authStorage";

/**
 * The row shape `convex/library.ts` stores. Flatter than the local entry —
 * Convex validators don't nest as comfortably as the local shape reads.
 */
interface ServerEntry {
  key: string;
  titleKey: string;
  title: string;
  year?: number;
  type?: "movie" | "series";
  imdbId?: string;
  posterUrl?: string;
  watchedAt?: number;
  watchlistedAt?: number;
  sentiment?: "liked" | "disliked";
  rating?: number;
  reviewText?: string;
  reviewUpdatedAt?: number;
  updatedAt: number;
}

const pushRef = makeFunctionReference<
  "mutation",
  { entries: ServerEntry[] },
  ServerEntry[]
>("library:push");

/**
 * Flatten a local entry for the server.
 */
function toServer(entry: LibraryEntry): ServerEntry {
  return {
    key: entry.key,
    titleKey: titleKey(entry.title),
    title: entry.title,
    year: entry.year,
    type: entry.type,
    imdbId: entry.imdbId,
    posterUrl: entry.posterUrl,
    watchedAt: entry.watchedAt,
    watchlistedAt: entry.watchlistedAt,
    sentiment: entry.sentiment,
    rating: entry.review?.rating,
    reviewText: entry.review?.text,
    reviewUpdatedAt: entry.review?.updatedAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Rebuild a local entry from a server row.
 */
function toLocal(row: ServerEntry): LibraryEntry {
  const hasReview = row.reviewText !== undefined || row.rating !== undefined;

  return {
    key: row.key,
    title: row.title,
    year: row.year,
    type: row.type,
    imdbId: row.imdbId,
    posterUrl: row.posterUrl,
    watchedAt: row.watchedAt,
    watchlistedAt: row.watchlistedAt,
    sentiment: row.sentiment,
    review: hasReview
      ? {
          text: row.reviewText ?? "",
          rating: row.rating,
          updatedAt: row.reviewUpdatedAt ?? row.updatedAt,
        }
      : undefined,
    updatedAt: row.updatedAt,
  };
}

/**
 * Push local entries, merge, and write the result back.
 *
 * @param url - Convex deployment URL
 * @returns How many entries the library holds afterwards, or null when signed out
 */
export async function syncLibrary(url: string): Promise<number | null> {
  const token = await getStoredAuthToken();
  if (!token || !url) return null;

  const client = new ConvexHttpClient(url);
  client.setAuth(token);

  const local = await listEntries();
  const merged = await client.mutation(pushRef, { entries: local.map(toServer) });

  // The server's answer is the union of both sides, so it replaces the local
  // copy wholesale rather than being merged again here
  const library: Record<string, LibraryEntry> = {};
  for (const row of merged) {
    library[row.key] = toLocal(row);
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.LIBRARY]: library });

  return merged.length;
}
