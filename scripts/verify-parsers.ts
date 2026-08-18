/**
 * OMDb Parser Verification
 *
 * Exercises the pure parsing functions in convex/omdbParse.ts against real
 * OMDb response shapes. These parsers sit between a loosely-typed external API
 * and the database, and can't be run through the Convex functions without a
 * live deployment — so they get checked here instead.
 *
 * Run with: npm run verify:parsers
 */

import {
  parseOmdbResponse,
  parseAwards,
  parseYear,
  parseRuntime,
  parseRatingValue,
  normalizeTitle,
  lookupKey,
  classifyOmdbFailure,
  isRetryable,
  isCacheableMiss,
} from "../convex/omdbParse";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

// --- Real OMDb payload: Inception -----------------------------------------
const inception = {
  Response: "True" as const,
  Title: "Inception",
  Year: "2010",
  Runtime: "148 min",
  Genre: "Action, Adventure, Sci-Fi",
  Director: "Christopher Nolan",
  Poster: "https://m.media-amazon.com/images/M/inception.jpg",
  Awards: "Won 4 Oscars. 159 wins & 220 nominations total.",
  imdbID: "tt1375666",
  imdbRating: "8.8",
  Metascore: "74",
  Ratings: [
    { Source: "Internet Movie Database", Value: "8.8/10" },
    { Source: "Rotten Tomatoes", Value: "87%" },
    { Source: "Metacritic", Value: "74/100" },
  ],
};

const parsed = parseOmdbResponse(inception);

check("inception movie", parsed.movie, {
  title: "Inception",
  year: 2010,
  imdbId: "tt1375666",
  genre: ["Action", "Adventure", "Sci-Fi"],
  posterUrl: "https://m.media-amazon.com/images/M/inception.jpg",
  runtime: 148,
  director: "Christopher Nolan",
});

check("inception ratings", parsed.ratings, [
  { source: "IMDb", score: 8.8, maxScore: 10 },
  { source: "RottenTomatoes", score: 87, maxScore: 100 },
  { source: "Metacritic", score: 74, maxScore: 100 },
]);

check("inception awards", parsed.awards, [
  { name: "Oscar", year: 2010, isWin: true, count: 4 },
  { name: "Other awards", category: "wins", year: 2010, isWin: true, count: 155 },
  { name: "Nominations", year: 2010, isWin: false, count: 220 },
]);

// --- Series with a year range and N/A fields ------------------------------
const series = {
  Response: "True" as const,
  Title: "Severance",
  Year: "2022–",
  Runtime: "N/A",
  Genre: "Drama, Mystery, Sci-Fi",
  Director: "N/A",
  Poster: "N/A",
  Awards: "Won 8 Primetime Emmys. 40 wins & 155 nominations total.",
  imdbID: "tt11280740",
  imdbRating: "8.7",
  Metascore: "N/A",
  Ratings: [{ Source: "Internet Movie Database", Value: "8.7/10" }],
};

const parsedSeries = parseOmdbResponse(series);

check("series year range", parsedSeries.movie.year, 2022);
check("series N/A director dropped", parsedSeries.movie.director, undefined);
check("series N/A poster dropped", parsedSeries.movie.posterUrl, undefined);
check("series N/A runtime dropped", parsedSeries.movie.runtime, undefined);
check("series N/A metascore not backfilled", parsedSeries.ratings, [
  { source: "IMDb", score: 8.7, maxScore: 10 },
]);
check("emmy headline", parsedSeries.awards[0], {
  name: "Primetime Emmy",
  year: 2022,
  isWin: true,
  count: 8,
});

// --- Backfill when the Ratings array is missing entries --------------------
const sparse = {
  Response: "True" as const,
  Title: "Some Film",
  Year: "1999",
  imdbID: "tt0000001",
  imdbRating: "6.4",
  Metascore: "52",
  Awards: "N/A",
  Ratings: [{ Source: "Rotten Tomatoes", Value: "61%" }],
};

check("backfill from top-level fields", parseOmdbResponse(sparse).ratings, [
  { source: "RottenTomatoes", score: 61, maxScore: 100 },
  { source: "IMDb", score: 6.4, maxScore: 10 },
  { source: "Metacritic", score: 52, maxScore: 100 },
]);

check("no awards for N/A", parseOmdbResponse(sparse).awards, []);

// --- Awards summary variants ----------------------------------------------
check("nominated headline", parseAwards("Nominated for 3 Oscars. 12 wins & 45 nominations total.", 2001), [
  { name: "Oscar", year: 2001, isWin: false, count: 3 },
  { name: "Other awards", category: "wins", year: 2001, isWin: true, count: 12 },
  { name: "Nominations", year: 2001, isWin: false, count: 42 },
]);

check("totals only", parseAwards("3 wins & 5 nominations.", 2015), [
  { name: "Other awards", category: "wins", year: 2015, isWin: true, count: 3 },
  { name: "Nominations", year: 2015, isWin: false, count: 5 },
]);

check("single win", parseAwards("1 win.", 2015), [
  { name: "Other awards", category: "wins", year: 2015, isWin: true, count: 1 },
]);

check("golden globe naming", parseAwards("Won 2 Golden Globes. 2 wins & 6 nominations total.", 2020)[0], {
  name: "Golden Globe",
  year: 2020,
  isWin: true,
  count: 2,
});

check("bafta naming", parseAwards("Won 5 BAFTA Awards. 30 wins & 60 nominations total.", 2020)[0], {
  name: "BAFTA",
  year: 2020,
  isWin: true,
  count: 5,
});

// --- Scalar parsers --------------------------------------------------------
check("rating value slash", parseRatingValue("8.8/10"), 8.8);
check("rating value percent", parseRatingValue("87%"), 87);
check("rating value junk", parseRatingValue("N/A"), null);
check("year plain", parseYear("2010"), 2010);
check("year range", parseYear("2019–2023"), 2019);
check("year NA", parseYear("N/A"), undefined);
check("runtime", parseRuntime("148 min"), 148);

// --- Title normalization ---------------------------------------------------
check(
  "punctuation variants collapse",
  normalizeTitle("Spider-Man: No Way Home"),
  normalizeTitle("Spider-Man - No Way Home")
);
check("diacritics stripped", normalizeTitle("Amélie"), "amelie");
check("lookup key", lookupKey("Inception", 2010, "movie"), "inception|2010|movie");
check("lookup key sparse", lookupKey("Inception"), "inception||");

// --- Failure classification ------------------------------------------------
// OMDb returns 401 for both "Invalid API key!" and "Request limit reached!",
// so the status alone can't separate them; a genuine miss is 200 with
// "Movie not found!". Both halves feed the verdict, and anything unrecognised
// must stay out of the "no such title" bucket, which is the one that's cached.

const kindOf = (error?: string, status?: number) =>
  classifyOmdbFailure(error, status).kind;

check("movie not found is a miss", kindOf("Movie not found!"), "notFound");
check("series not found is a miss", kindOf("Series not found!"), "notFound");
check("invalid key is not a miss", kindOf("Invalid API key!"), "invalidKey");
check("missing key is not a miss", kindOf("No API key provided."), "invalidKey");
check("quota exhausted is not a miss", kindOf("Request limit reached!"), "rateLimited");
check("bad imdb id", kindOf("Incorrect IMDb ID."), "badRequest");

// HTTP-level failures, where there's no body to read
check("401 is a key problem", kindOf(undefined, 401), "invalidKey");
check("429 is a quota problem", kindOf(undefined, 429), "rateLimited");
check("500 is transient", kindOf(undefined, 503), "transient");

// The safety property: anything unrecognised must never be read as "no such
// title", because that answer gets cached and outlives whatever caused it
check("an unknown error is not a miss", kindOf("Something went wrong."), "transient");
check("an empty error is not a miss", kindOf(undefined, 200), "transient");

check(
  "only transient failures retry",
  ["notFound", "invalidKey", "rateLimited", "badRequest", "transient"].filter((kind) =>
    isRetryable({ kind: kind as never, message: "" })
  ),
  ["transient"]
);
check(
  "only a real miss is cacheable",
  ["notFound", "invalidKey", "rateLimited", "badRequest", "transient"].filter((kind) =>
    isCacheableMiss({ kind: kind as never, message: "" })
  ),
  ["notFound"]
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
