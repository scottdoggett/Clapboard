/**
 * Optional Provider Verification
 *
 * Exercises the MDBList and TMDB parsers.
 *
 * A caveat worth stating plainly: both endpoints need an API key, so neither
 * response could be observed. The TMDB fixtures follow its long-stable and
 * well-documented `/find` and `/movie` shapes. The MDBList fixture is built
 * from its own OpenAPI spec (`api.mdblist.com/schema/`), which pins down the
 * route, the top-level fields and the rating source names — but declares each
 * entry in `ratings` as a bare `type: object` with no properties.
 *
 * So the MDBList parser accepts several plausible spellings of the value
 * field, and these tests fix that tolerance in place. The first real response
 * should still be checked against them.
 *
 * Run with: npm run verify:providers
 */

import {
  parseMdblistRatings,
  parseMdblistMetadata,
  mergeRatings,
  MDBLIST_SOURCES,
} from "../convex/mdblistParse";
import {
  parseFindResponse,
  parseTmdbDetails,
  mergeMetadata,
} from "../convex/tmdbParse";

let failures = 0;

/**
 * Serialize with keys in a stable order.
 *
 * Plain `JSON.stringify` compares key order, so a merge that spreads one object
 * over another reports a false failure purely because the spread moved a key.
 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  );
}

function check(label: string, actual: unknown, expected: unknown): void {
  const a = stable(actual);
  const e = stable(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

// ===========================================================================
// MDBList
// ===========================================================================

// Source names are from the spec's `return_rating` enum; the per-entry shape
// is the widely-used {source, value} form
const mdblistResponse = {
  id: 27205,
  imdb_id: "tt1375666",
  title: "Inception",
  year: 2010,
  type: "movie",
  score: 88,
  ratings: [
    { source: "imdb", value: 8.8, votes: 2_400_000 },
    { source: "tomatoes", value: 87 },
    { source: "metacritic", value: 74 },
    { source: "letterboxd", value: 4.2 },
    { source: "trakt", value: 89 },
    { source: "tmdb", value: 83 },
  ],
};

// The point of the whole provider: Letterboxd, which nothing else carries
check("parses ratings, keeping only mapped sources", parseMdblistRatings(mdblistResponse), [
  { source: "IMDb", score: 8.8, maxScore: 10 },
  { source: "RottenTomatoes", score: 87, maxScore: 100 },
  { source: "Metacritic", score: 74, maxScore: 100 },
  { source: "Letterboxd", score: 4.2, maxScore: 5 },
]);

check(
  "the spec's source list includes letterboxd",
  MDBLIST_SOURCES.includes("letterboxd"),
  true
);

// The spec doesn't name the value field, so the parser accepts the likely ones
check(
  "accepts a 'score' field",
  parseMdblistRatings({ ratings: [{ source: "imdb", score: 7.5 }] }),
  [{ source: "IMDb", score: 7.5, maxScore: 10 }]
);
check(
  "accepts a 'rating' field",
  parseMdblistRatings({ ratings: [{ source: "imdb", rating: 7.5 }] }),
  [{ source: "IMDb", score: 7.5, maxScore: 10 }]
);
check(
  "accepts a numeric string",
  parseMdblistRatings({ ratings: [{ source: "imdb", value: "7.5" }] }),
  [{ source: "IMDb", score: 7.5, maxScore: 10 }]
);

// A value on the wrong scale must be converted or dropped, never shown as-is —
// Letterboxd reported out of 100 would otherwise render as 84 stars out of 5
check(
  "rescales a percent-shaped Letterboxd value",
  parseMdblistRatings({ ratings: [{ source: "letterboxd", value: 84 }] }),
  [{ source: "Letterboxd", score: 4.2, maxScore: 5 }]
);
check(
  "drops a value that fits no scale",
  parseMdblistRatings({ ratings: [{ source: "imdb", value: 880 }] }),
  []
);
check(
  "drops a negative value",
  parseMdblistRatings({ ratings: [{ source: "imdb", value: -1 }] }),
  []
);

check("first entry per source wins", parseMdblistRatings({
  ratings: [
    { source: "tomatoes", value: 87 },
    { source: "tomatoes", value: 62 },
  ],
}), [{ source: "RottenTomatoes", score: 87, maxScore: 100 }]);

check("tolerates a malformed body", parseMdblistRatings({ ratings: "none" }), []);
check("tolerates null", parseMdblistRatings(null), []);
check("tolerates junk entries", parseMdblistRatings({ ratings: [null, 42, {}] }), []);

check("reads metadata", parseMdblistMetadata(mdblistResponse), {
  title: "Inception",
  year: 2010,
  imdbId: "tt1375666",
});

// OMDb's ratings arrive first; MDBList fills gaps rather than relitigating
check(
  "merge keeps existing ratings and adds only new sources",
  mergeRatings(
    [{ source: "IMDb", score: 8.8, maxScore: 10 }],
    [
      { source: "IMDb", score: 8.7, maxScore: 10 },
      { source: "Letterboxd", score: 4.2, maxScore: 5 },
    ]
  ),
  [
    { source: "IMDb", score: 8.8, maxScore: 10 },
    { source: "Letterboxd", score: 4.2, maxScore: 5 },
  ]
);

// ===========================================================================
// TMDB
// ===========================================================================

check(
  "find returns a movie match",
  parseFindResponse({ movie_results: [{ id: 27205 }], tv_results: [] }),
  { id: 27205, mediaType: "movie" }
);
check(
  "find falls through to a tv match",
  parseFindResponse({ movie_results: [], tv_results: [{ id: 136315 }] }),
  { id: 136315, mediaType: "tv" }
);
check("find with no match", parseFindResponse({ movie_results: [], tv_results: [] }), null);
check("find tolerates junk", parseFindResponse({ movie_results: "no" }), null);

check(
  "parses movie details",
  parseTmdbDetails({
    id: 27205,
    title: "Inception",
    release_date: "2010-07-15",
    runtime: 148,
    poster_path: "/abc.jpg",
    genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }],
    credits: { crew: [{ job: "Producer", name: "Emma Thomas" }, { job: "Director", name: "Christopher Nolan" }] },
  }),
  {
    tmdbId: "27205",
    posterUrl: "https://image.tmdb.org/t/p/w500/abc.jpg",
    runtime: 148,
    genre: ["Action", "Science Fiction"],
    director: "Christopher Nolan",
    year: 2010,
    title: "Inception",
  }
);

// Series use different field names for the same ideas
check(
  "parses series details",
  parseTmdbDetails({
    id: 136315,
    name: "The Bear",
    first_air_date: "2022-06-23",
    episode_run_time: [30],
    poster_path: "/bear.jpg",
    genres: [{ name: "Comedy" }],
  }),
  {
    tmdbId: "136315",
    posterUrl: "https://image.tmdb.org/t/p/w500/bear.jpg",
    runtime: 30,
    genre: ["Comedy"],
    director: undefined,
    year: 2022,
    title: "The Bear",
  }
);

check("details with a null poster", parseTmdbDetails({ id: 1, poster_path: null }), {
  tmdbId: "1",
  posterUrl: undefined,
  runtime: undefined,
  genre: undefined,
  director: undefined,
  year: undefined,
  title: undefined,
});
check("details tolerates junk", parseTmdbDetails("nope"), {});

// TMDB wins on artwork; everything else only fills a gap, because overwriting
// a title or year OMDb resolved could contradict the id the lookup keyed on
check(
  "merge prefers TMDB artwork but keeps resolved fields",
  mergeMetadata(
    {
      title: "Inception",
      posterUrl: "https://omdb/poster.jpg",
      runtime: 148,
      genre: ["Action"],
      director: "Christopher Nolan",
    },
    {
      tmdbId: "27205",
      posterUrl: "https://image.tmdb.org/t/p/w500/abc.jpg",
      runtime: 150,
      genre: ["Sci-Fi"],
      director: "Someone Else",
    }
  ),
  {
    title: "Inception",
    tmdbId: "27205",
    posterUrl: "https://image.tmdb.org/t/p/w500/abc.jpg",
    runtime: 148,
    genre: ["Action"],
    director: "Christopher Nolan",
  }
);
check(
  "merge fills gaps TMDB can cover",
  mergeMetadata({ title: "X" }, { runtime: 99, genre: ["Drama"], director: "A. Director" }),
  {
    title: "X",
    tmdbId: undefined,
    posterUrl: undefined,
    runtime: 99,
    genre: ["Drama"],
    director: "A. Director",
  }
);
check(
  "merge with nothing from TMDB is a no-op",
  mergeMetadata({ title: "X", runtime: 100 }, {}),
  { title: "X", tmdbId: undefined, posterUrl: undefined, runtime: 100, genre: undefined, director: undefined }
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
