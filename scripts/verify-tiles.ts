/**
 * Browse-Tile Summary Verification
 *
 * Checks what a browse tile says about a title: which ratings appear, in what
 * order, formatted how, and what the award line collapses to.
 *
 * The reason this is worth testing at all is that a tile is the one place the
 * data is shown without context. In the detail overlay a source is named in
 * full and a score sits under a heading; on a tile it is four characters and a
 * number, and "87" meaning a percentage while "8.8" means a ten-point scale is
 * carried entirely by the formatting.
 *
 * Run with: npm run verify:tiles
 */

import type { Award, MovieData, Rating } from "../src/shared/types/movie";
import {
  buildTileSummary,
  formatTileScore,
  summarizeTileAwards,
  TILE_LABELS,
} from "../src/shared/utils/tileSummary";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

function rating(
  source: Rating["source"],
  score: number,
  maxScore: number
): Rating {
  return { id: `r-${source}`, movieId: "m1", source, score, maxScore, fetchedAt: 0 };
}

function award(isWin: boolean, count?: number): Award {
  return { id: `a-${isWin}-${count ?? 1}`, name: "Oscar", year: 2016, isWin, count };
}

// --- Score formatting ------------------------------------------------------
// The label says which scale; the number only has to say how much. The one
// exception is a percentage, where dropping the sign changes the meaning.
check("percent scores keep their sign", formatTileScore(rating("RottenTomatoes", 87, 100)), "87%");
check("percent scores are whole", formatTileScore(rating("Metacritic", 74.4, 100)), "74%");
check("ten-point scores keep a decimal", formatTileScore(rating("IMDb", 8.8, 10)), "8.8");
check("five-point scores keep a decimal", formatTileScore(rating("Letterboxd", 4.2, 5)), "4.2");

// A ragged column is harder to scan than a regular one, so a round score still
// carries its decimal place
check("a round score is padded", formatTileScore(rating("IMDb", 8, 10)), "8.0");

// --- Award tally -----------------------------------------------------------
check("no awards reports nothing", summarizeTileAwards(undefined), null);
check("an empty list reports nothing", summarizeTileAwards([]), null);

check("wins and nominations both appear", summarizeTileAwards([award(true, 4), award(false, 8)]), {
  wins: 4,
  nominations: 8,
  label: "4 wins · 8 noms",
});

// OMDb reports "Won 4 Oscars" as one record with a count; Wikidata reports
// four separate ones. Both have to add up the same way.
check(
  "counted records and individual records agree",
  summarizeTileAwards([award(true), award(true), award(true), award(true)]),
  { wins: 4, nominations: 0, label: "4 wins" }
);

check("one win is singular", summarizeTileAwards([award(true)]), {
  wins: 1,
  nominations: 0,
  label: "1 win",
});
check("one nomination is singular", summarizeTileAwards([award(false)]), {
  wins: 0,
  nominations: 1,
  label: "1 nom",
});

// A record explicitly carrying zero should not produce "0 wins · 2 noms"
check("a zero count is left out", summarizeTileAwards([award(true, 0), award(false, 2)]), {
  wins: 0,
  nominations: 2,
  label: "2 noms",
});
check("records that all count zero report nothing", summarizeTileAwards([award(true, 0)]), null);

// --- Labels ----------------------------------------------------------------
// "Rotten Tomatoes" would take a third of a tile on its own
check("source names are abbreviated", TILE_LABELS.RottenTomatoes, "RT");
check("IMDb is already short enough", TILE_LABELS.IMDb, "IMDb");

// --- The whole summary -----------------------------------------------------
const movieData: MovieData = {
  movie: {
    id: "m1",
    title: "The Big Short",
    year: 2015,
    imdbId: "tt1596363",
    awards: [award(true, 1), award(false, 4)],
  },
  // Deliberately out of display order
  ratings: [
    rating("Letterboxd", 3.9, 5),
    rating("Metacritic", 81, 100),
    rating("IMDb", 7.8, 10),
  ],
};

check("chips run in source priority order, whatever order they arrive in", buildTileSummary(movieData), {
  chips: [
    { source: "IMDb", label: "IMDb", value: "7.8", href: "https://www.imdb.com/title/tt1596363/" },
    {
      source: "Metacritic",
      label: "MC",
      value: "81%",
      href: "https://www.metacritic.com/search/The%20Big%20Short/",
    },
    {
      source: "Letterboxd",
      label: "LB",
      value: "3.9",
      href: "https://letterboxd.com/imdb/tt1596363/",
    },
  ],
  awards: { wins: 1, nominations: 4, label: "1 win · 4 noms" },
});

// A title that didn't resolve renders nothing at all — a tile is not the place
// to explain that a lookup missed
check("an unresolved title summarizes to nothing", buildTileSummary(null), {
  chips: [],
  awards: null,
});

// Ratings and awards arrive from different providers and either can be empty
check(
  "ratings with no awards",
  buildTileSummary({
    movie: { id: "m2", title: "Nowhere Special", imdbId: "tt10611420" },
    ratings: [rating("IMDb", 7.2, 10)],
  }),
  {
    chips: [
      { source: "IMDb", label: "IMDb", value: "7.2", href: "https://www.imdb.com/title/tt10611420/" },
    ],
    awards: null,
  }
);

check(
  "awards with no ratings",
  buildTileSummary({
    movie: { id: "m3", title: "Some Festival Film", awards: [award(true, 2)] },
    ratings: [],
  }),
  { chips: [], awards: { wins: 2, nominations: 0, label: "2 wins" } }
);

// Without an IMDb id the chips still link somewhere useful rather than nowhere
check(
  "a title with no IMDb id still links out",
  buildTileSummary({
    movie: { id: "m4", title: "Unresolved Thing" },
    ratings: [rating("IMDb", 6.1, 10)],
  }).chips[0].href,
  "https://www.imdb.com/find/?q=Unresolved%20Thing"
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
