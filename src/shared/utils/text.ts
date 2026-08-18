/**
 * Text Utilities
 *
 * Title normalization shared between the cache layer and anything else that
 * needs to decide whether two title strings refer to the same thing.
 *
 * Note: `convex/omdb.ts` keeps its own copy of this logic. Convex bundles the
 * `convex/` directory independently and doesn't resolve the extension's path
 * aliases, so the two must be kept in sync by hand — if you change the
 * normalization here, change it there too, or the local and backend caches
 * will disagree about what counts as the same title.
 */

/**
 * Normalize a title for comparison and cache keys.
 *
 * Streaming sites vary punctuation and casing for the same film
 * ("Spider-Man: No Way Home" vs "Spider-Man - No Way Home"), so everything
 * that isn't a letter or digit collapses to a single space.
 *
 * @param title - Raw title as displayed by the site
 * @returns Lowercased, punctuation-stripped title
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Build a cache key for a title lookup
 *
 * @param title - Title as displayed by the site
 * @param year - Optional release year
 * @param type - Optional content type
 * @returns Stable key identifying this lookup
 */
export function buildLookupKey(
  title: string,
  year?: number,
  type?: string
): string {
  return `${normalizeTitle(title)}|${year ?? ""}|${type ?? ""}`;
}
