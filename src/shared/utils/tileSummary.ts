/**
 * Browse-Tile Summary
 *
 * What a browse-grid tile shows once its lookup resolves: a compact row of
 * rating chips and a one-line award tally.
 *
 * Pure, and separate from `src/content/tiles.ts` for the usual reason — the
 * tile renderer writes inline-styled DOM into someone else's tree and can't be
 * exercised without a page, while the decisions it makes (which sources to
 * show, in what order, formatted how) can be checked outright by
 * `npm run verify:tiles`.
 *
 * A tile has perhaps 250px of width and sits under artwork the user is
 * scanning, not reading. That is the whole design constraint: source names are
 * abbreviated, scores are one number each, and the award line collapses to
 * counts. The detail view is where the full picture lives.
 */

import type { Award, MovieData, Rating, RatingSource } from "@shared/types/movie";
import { sortRatingsByPriority } from "@shared/utils/scoring";
import { ratingUrl } from "@shared/utils/links";

/**
 * Short forms of the source names.
 *
 * "Rotten Tomatoes" is 15 characters and would take a third of the tile on its
 * own. These are the abbreviations each site uses for itself, so they read as
 * shorthand rather than as invented codes.
 */
export const TILE_LABELS: Record<RatingSource, string> = {
  IMDb: "IMDb",
  RottenTomatoes: "RT",
  Metacritic: "MC",
  Letterboxd: "LB",
};

/** One rating, as it appears on a tile. */
export interface TileChip {
  source: RatingSource;
  /** Abbreviated source name */
  label: string;
  /** The score, formatted for its own scale */
  value: string;
  /** Where clicking it goes, or null when no URL can be built */
  href: string | null;
}

/** The award tally, reduced to something that fits on one line. */
export interface TileAwards {
  wins: number;
  nominations: number;
  /** e.g. "4 wins · 8 noms" */
  label: string;
}

export interface TileSummary {
  chips: TileChip[];
  awards: TileAwards | null;
}

/**
 * Format a score for a tile.
 *
 * Percentages keep their sign because 87 and 87% mean different things at a
 * glance; everything else is a bare number, since the abbreviated label
 * already says which scale it is on.
 *
 * @param rating - The rating to format
 * @returns A short string, e.g. "8.8", "87%", "4.2"
 */
export function formatTileScore(rating: Rating): string {
  if (rating.maxScore === 100) return `${Math.round(rating.score)}%`;

  // One decimal place across the board: IMDb reports 8.8 and Letterboxd 4.2,
  // and a rating that happens to land on 8 should not render as "8" beside
  // them — a ragged column of numbers is harder to scan than a regular one.
  return rating.score.toFixed(1);
}

/**
 * Reduce a list of awards to counts.
 *
 * A tile has no room for categories or recipients, so this answers only the
 * question the artwork prompts — is this thing decorated? Opening the title
 * shows what for.
 *
 * @param awards - Awards attached to the resolved movie
 * @returns The tally, or null when there is nothing to report
 */
export function summarizeTileAwards(awards: Award[] | undefined): TileAwards | null {
  if (!awards || awards.length === 0) return null;

  let wins = 0;
  let nominations = 0;

  for (const award of awards) {
    // Our upstream sources report counts as well as individual awards
    // ("Won 4 Oscars" arrives as one record), so a missing count means one
    const count = award.count ?? 1;
    if (award.isWin) wins += count;
    else nominations += count;
  }

  if (wins === 0 && nominations === 0) return null;

  const parts = [
    wins > 0 ? `${wins} ${wins === 1 ? "win" : "wins"}` : null,
    // "nominations" is the honest word and twice too long for a tile
    nominations > 0 ? `${nominations} ${nominations === 1 ? "nom" : "noms"}` : null,
  ].filter((part): part is string => part !== null);

  return { wins, nominations, label: parts.join(" · ") };
}

/**
 * Everything a tile shows about a resolved title.
 *
 * @param data - The lookup result, or null when the title didn't resolve
 * @returns Chips and an award tally, both possibly empty
 */
export function buildTileSummary(data: MovieData | null): TileSummary {
  if (!data) return { chips: [], awards: null };

  const chips = sortRatingsByPriority(data.ratings).map((rating) => ({
    source: rating.source,
    label: TILE_LABELS[rating.source] ?? rating.source,
    value: formatTileScore(rating),
    href: ratingUrl(rating.source, data.movie.title, data.movie.imdbId),
  }));

  return { chips, awards: summarizeTileAwards(data.movie.awards) };
}
