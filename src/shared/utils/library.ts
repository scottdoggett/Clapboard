/**
 * Personal Library
 *
 * What the user has watched, wants to watch, liked, and written about.
 *
 * `chrome.storage.local` is the copy every toggle writes. Marking a title is a
 * local write rather than a round trip, and the whole thing works signed out —
 * nothing here may become a gate in front of that.
 *
 * Signing in adds a second copy in Convex that the two sides *merge* on
 * `updatedAt` (`api/librarySync.ts`), so a library survives a reinstall and
 * follows the user to another browser without either device erasing the other.
 * `exportLibrary` remains the way out for someone who wants neither.
 *
 * Entries are keyed by IMDb id where there is one, because the same film has
 * different titles across platforms and different years across sources. A
 * normalized title is the fallback, so a title can be marked before its lookup
 * resolves.
 */

import { STORAGE_KEYS } from "@shared/constants";
import { buildLookupKey } from "@shared/utils/text";

export type Sentiment = "liked" | "disliked";

export interface Review {
  /** Out of 10, matching the scale the overlay shows elsewhere */
  rating?: number;
  text: string;
  updatedAt: number;
}

export interface LibraryEntry {
  key: string;
  title: string;
  year?: number;
  type?: "movie" | "series";
  imdbId?: string;
  posterUrl?: string;
  /** When it was marked watched */
  watchedAt?: number;
  /** When it was added to the watchlist */
  watchlistedAt?: number;
  sentiment?: Sentiment;
  review?: Review;
  updatedAt: number;
}

/** Everything the library needs to identify and display a title. */
export interface LibrarySubject {
  title: string;
  year?: number;
  type?: "movie" | "series";
  imdbId?: string;
  posterUrl?: string;
}

/**
 * Stable identity for a title.
 *
 * IMDb id first: the same film is "The Office (U.S.)" on one service and "The
 * Office" on another, and its year differs between sources. The normalized
 * title is the fallback for the window before a lookup resolves, and for
 * matching a browse tile where only a name is on screen.
 *
 * @param subject - The title being marked
 * @returns A key stable across platforms and sessions
 */
export function libraryKey(subject: LibrarySubject): string {
  if (subject.imdbId) return `imdb:${subject.imdbId}`;

  return `title:${buildLookupKey(subject.title, subject.year, subject.type)}`;
}

/**
 * The key a browse tile would produce, where only a title is known.
 *
 * @param title - Title as shown on the tile
 * @returns The title-based key
 */
export function titleKey(title: string): string {
  return `title:${buildLookupKey(title)}`;
}

/**
 * Apply a change to an entry, creating it if needed and removing it when
 * nothing is left worth keeping.
 *
 * Pure, so the state machine can be tested: un-watching a title you never
 * reviewed should leave nothing behind, while un-watching one you wrote about
 * should keep the review.
 *
 * @param existing - The current entry, if any
 * @param subject - The title being marked
 * @param change - Fields to apply
 * @param now - Current time
 * @returns The updated entry, or null when the entry should be deleted
 */
export function applyChange(
  existing: LibraryEntry | undefined,
  subject: LibrarySubject,
  change: Partial<Pick<LibraryEntry, "watchedAt" | "watchlistedAt" | "sentiment" | "review">>,
  now: number
): LibraryEntry | null {
  const base: LibraryEntry = existing ?? {
    key: libraryKey(subject),
    title: subject.title,
    year: subject.year,
    type: subject.type,
    imdbId: subject.imdbId,
    posterUrl: subject.posterUrl,
    updatedAt: now,
  };

  const next: LibraryEntry = {
    ...base,
    // Refresh the descriptive fields — a later lookup may have resolved a
    // better title, a poster, or an IMDb id the first pass lacked
    title: subject.title || base.title,
    year: subject.year ?? base.year,
    type: subject.type ?? base.type,
    imdbId: subject.imdbId ?? base.imdbId,
    posterUrl: subject.posterUrl ?? base.posterUrl,
    ...change,
    updatedAt: now,
  };

  return isEmpty(next) ? null : next;
}

/**
 * Does this entry still record anything the user asked for?
 */
function isEmpty(entry: LibraryEntry): boolean {
  return (
    entry.watchedAt === undefined &&
    entry.watchlistedAt === undefined &&
    entry.sentiment === undefined &&
    (entry.review === undefined || entry.review.text.trim() === "")
  );
}

/**
 * Clean up a review before storing it.
 *
 * @param text - Raw text from the form
 * @param rating - Optional score out of 10
 * @param now - Current time
 * @returns A review, or undefined when there's nothing to save
 */
export function buildReview(
  text: string,
  rating: number | undefined,
  now: number
): Review | undefined {
  const trimmed = text.trim();
  if (trimmed === "" && rating === undefined) return undefined;

  const clamped =
    rating === undefined || !Number.isFinite(rating)
      ? undefined
      : Math.min(10, Math.max(0, Math.round(rating * 10) / 10));

  return { text: trimmed, rating: clamped, updatedAt: now };
}

/**
 * Sort entries for display: most recently touched first.
 */
export function sortEntries(entries: LibraryEntry[]): LibraryEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Split the library into the lists the UI shows.
 */
export function groupEntries(entries: LibraryEntry[]): {
  watchlist: LibraryEntry[];
  watched: LibraryEntry[];
  reviewed: LibraryEntry[];
} {
  const sorted = sortEntries(entries);

  return {
    // A title you have already watched has served its purpose on the
    // watchlist, so it drops off rather than lingering
    watchlist: sorted.filter(
      (entry) => entry.watchlistedAt !== undefined && entry.watchedAt === undefined
    ),
    watched: sorted.filter((entry) => entry.watchedAt !== undefined),
    reviewed: sorted.filter(
      (entry) => entry.review !== undefined && entry.review.text.trim() !== ""
    ),
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export type LibraryMap = Record<string, LibraryEntry>;

async function readLibrary(): Promise<LibraryMap> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LIBRARY);
  return (stored[STORAGE_KEYS.LIBRARY] ?? {}) as LibraryMap;
}

async function writeLibrary(library: LibraryMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LIBRARY]: library });
}

/**
 * Read and write the whole library at once.
 *
 * These exist for the importer, which replaces thousands of entries in one
 * pass and would otherwise read and write storage once per title. Everything
 * else should go through `updateEntry`, which handles key migration and
 * deletion; these two do neither.
 */
export const readLibraryMap = readLibrary;
export const writeLibraryMap = writeLibrary;

/**
 * Read one title's entry.
 *
 * Falls back to the title-based key so a title marked from a browse tile is
 * still found once its IMDb id has been resolved.
 */
export async function getEntry(
  subject: LibrarySubject
): Promise<LibraryEntry | undefined> {
  const library = await readLibrary();

  return library[libraryKey(subject)] ?? library[titleKey(subject.title)];
}

/**
 * Apply a change and persist it.
 *
 * @returns The entry after the change, or undefined if it was removed
 */
export async function updateEntry(
  subject: LibrarySubject,
  change: Partial<Pick<LibraryEntry, "watchedAt" | "watchlistedAt" | "sentiment" | "review">>
): Promise<LibraryEntry | undefined> {
  const library = await readLibrary();
  const key = libraryKey(subject);
  const existing = library[key] ?? library[titleKey(subject.title)];

  const next = applyChange(existing, subject, change, Date.now());

  // An entry first created from a browse tile is keyed by title; once the
  // lookup resolves an IMDb id it moves, and the old key has to go with it
  if (existing && existing.key !== key) delete library[existing.key];

  if (next) {
    library[key] = { ...next, key };
  } else {
    delete library[key];
  }

  await writeLibrary(library);
  return next ?? undefined;
}

/**
 * Every entry, newest first.
 */
export async function listEntries(): Promise<LibraryEntry[]> {
  return sortEntries(Object.values(await readLibrary()));
}

/**
 * A lookup table of title keys, for badging browse tiles where only a name is
 * on screen. Returned as a plain object so it survives `chrome.runtime`
 * messaging, which cannot carry a Map.
 */
export async function getTitleIndex(): Promise<
  Record<string, Pick<LibraryEntry, "watchedAt" | "watchlistedAt" | "sentiment">>
> {
  const library = await readLibrary();
  const index: Record<
    string,
    Pick<LibraryEntry, "watchedAt" | "watchlistedAt" | "sentiment">
  > = {};

  for (const entry of Object.values(library)) {
    index[titleKey(entry.title)] = {
      watchedAt: entry.watchedAt,
      watchlistedAt: entry.watchlistedAt,
      sentiment: entry.sentiment,
    };
  }

  return index;
}

/**
 * The whole library as JSON, so it can be taken elsewhere — including into
 * an account, once there are accounts.
 */
export async function exportLibrary(): Promise<string> {
  return JSON.stringify(await listEntries(), null, 2);
}
