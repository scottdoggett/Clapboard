/**
 * Outbound Links
 *
 * Builds the URL behind each rating and award, so the card is a way into the
 * sources rather than a dead end. Pure, so `npm run verify:links` can check
 * the constructions — a link that 404s is worse than no link, and these are
 * built from user-supplied titles.
 *
 * Every URL below was resolved against the live site before being used:
 *
 * - **IMDb** and **Letterboxd** are direct. Letterboxd is the pleasant
 *   surprise: `letterboxd.com/imdb/{id}` redirects to the film's own page, so
 *   an IMDb id is enough for both.
 * - **Rotten Tomatoes** and **Metacritic** publish no id we hold and their
 *   slugs are not derivable from a title — "the_big_short" happens to work,
 *   but disambiguated and re-released titles do not. A search that always
 *   lands somewhere useful beats a guessed slug that sometimes 404s.
 */

import type { RatingSource } from "@shared/types/movie";

/**
 * IMDb ids are `tt` followed by digits. Anything else is not something to
 * interpolate into a URL.
 */
const IMDB_ID = /^tt\d+$/;

/**
 * Where to send someone who clicks a rating.
 *
 * @param source - Which site's rating was clicked
 * @param title - Title as resolved by the lookup
 * @param imdbId - IMDb id, when the lookup found one
 * @returns A URL, or null when nothing sensible can be built
 */
export function ratingUrl(
  source: RatingSource,
  title: string,
  imdbId?: string
): string | null {
  const id = imdbId && IMDB_ID.test(imdbId) ? imdbId : null;
  const query = title.trim();

  if (!id && !query) return null;

  switch (source) {
    case "IMDb":
      return id
        ? `https://www.imdb.com/title/${id}/`
        : `https://www.imdb.com/find/?q=${encodeURIComponent(query)}`;

    case "Letterboxd":
      // Letterboxd resolves an IMDb id straight to the film's page
      return id
        ? `https://letterboxd.com/imdb/${id}/`
        : `https://letterboxd.com/search/${encodeURIComponent(query)}/`;

    case "RottenTomatoes":
      return query
        ? `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`
        : null;

    case "Metacritic":
      return query
        ? `https://www.metacritic.com/search/${encodeURIComponent(query)}/`
        : null;
  }
}

/**
 * Where to send someone who clicks an award.
 *
 * Wikidata carries the English Wikipedia article for most award categories, so
 * that is used when present — it explains what the award is and lists its
 * history, which is what someone clicking "Best Adapted Screenplay" wants.
 *
 * The fallback searches Wikipedia rather than guessing an article title, since
 * a wrong article is worse than a search page.
 *
 * @param name - Award body, e.g. "Oscar"
 * @param category - Award category, when there is one
 * @param url - Article URL supplied by the awards provider
 * @returns A URL, or null when there is nothing to point at
 */
export function awardUrl(
  name: string,
  category: string | undefined,
  url?: string
): string | null {
  if (url && /^https:\/\//.test(url)) return url;

  const query = [name, category].filter(Boolean).join(" ").trim();
  if (!query) return null;

  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}

/**
 * Where to send someone who clicks a person's name.
 *
 * @param person - The person's name as the awards provider gave it
 * @returns A URL, or null for an empty name
 */
export function personUrl(person: string): string | null {
  const query = person.trim();
  if (!query) return null;

  return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`;
}
