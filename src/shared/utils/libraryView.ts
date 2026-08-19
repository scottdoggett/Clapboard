/**
 * Library Views
 *
 * Searching, sorting and paging the user's own list.
 *
 * These were not worth having when a library was a dozen titles marked by
 * hand. An imported Netflix history is several hundred, and at that size the
 * list stops being something you read and becomes something you look *in* —
 * which is a different tool. The previous version rendered the first forty
 * entries and said nothing about the rest, so importing 260 titles produced a
 * list that appeared to hold 40.
 *
 * Pure, so `npm run verify:library` can hold the ordering and the matching to
 * account.
 */

import type { LibraryEntry } from "@shared/utils/library";
import { normalizeTitle } from "@shared/utils/text";

/** How the list can be ordered. */
export type SortMode = "recent" | "title" | "year" | "rating";

export const SORT_MODES: Array<{ id: SortMode; label: string }> = [
  { id: "recent", label: "Recent" },
  { id: "title", label: "A–Z" },
  { id: "year", label: "Year" },
  { id: "rating", label: "Rating" },
];

/**
 * How many entries to render at once.
 *
 * A page rather than everything, because several hundred rows each carrying a
 * poster is a visible stall when the popup opens. Whatever is held back is
 * *counted on the button* — a list that silently stops is indistinguishable
 * from a list that ends.
 */
export const PAGE_SIZE = 60;

/**
 * Reduce a title to what a search should compare.
 *
 * `normalizeTitle` collapses punctuation to a *space*, which is right for
 * cache keys and wrong here: it leaves "Spider-Man" as "spider man", so
 * someone typing "spiderman" finds nothing. Search removes the separators
 * entirely instead, on both sides, so spacing and punctuation stop mattering
 * altogether — "spiderman", "spider man" and "Spider-Man" are one query.
 *
 * Anyone typing into this box is working from memory, and memory does not
 * carry hyphens.
 */
function searchKey(text: string): string {
  return normalizeTitle(text).replace(/ /g, "");
}

/**
 * Filter a list by a search query.
 *
 * @param entries - The list to search
 * @param query - What the user typed
 * @returns Matching entries, in the order given
 */
export function searchEntries(
  entries: readonly LibraryEntry[],
  query: string
): LibraryEntry[] {
  const needle = searchKey(query);
  if (needle === "") return [...entries];

  return entries.filter((entry) => searchKey(entry.title).includes(needle));
}

/**
 * Order a list.
 *
 * Every mode falls back to the title when its own key is missing or equal, so
 * the order is total — a list that reshuffles its unrated entries every render
 * is worse than one sorted by something arbitrary but stable.
 *
 * @param entries - The list to order
 * @param mode - Which ordering
 * @returns A new, sorted array
 */
export function sortByMode(
  entries: readonly LibraryEntry[],
  mode: SortMode
): LibraryEntry[] {
  const byTitle = (a: LibraryEntry, b: LibraryEntry): number =>
    a.title.localeCompare(b.title);

  return [...entries].sort((a, b) => {
    switch (mode) {
      case "recent":
        return b.updatedAt - a.updatedAt || byTitle(a, b);

      case "title":
        return byTitle(a, b);

      case "year":
        // Undated entries go last rather than reading as year zero — an
        // imported Netflix row carries no year at all
        return (b.year ?? -Infinity) - (a.year ?? -Infinity) || byTitle(a, b);

      case "rating":
        return (
          (b.review?.rating ?? -Infinity) - (a.review?.rating ?? -Infinity) ||
          byTitle(a, b)
        );
    }
  });
}

export interface ListView {
  /** The entries to render */
  visible: LibraryEntry[];
  /** How many matched the search before paging */
  total: number;
  /** How many are held back by the page limit */
  remaining: number;
}

/**
 * Everything the list needs to render itself.
 *
 * @param entries - The tab's entries
 * @param query - The search box
 * @param mode - The chosen ordering
 * @param pages - How many pages the user has asked for
 * @returns The visible slice, and what it is a slice of
 */
export function buildListView(
  entries: readonly LibraryEntry[],
  query: string,
  mode: SortMode,
  pages: number
): ListView {
  const matched = sortByMode(searchEntries(entries, query), mode);
  const limit = Math.max(1, pages) * PAGE_SIZE;

  return {
    visible: matched.slice(0, limit),
    total: matched.length,
    remaining: Math.max(0, matched.length - limit),
  };
}
