/**
 * Outbound Link Verification
 *
 * These URLs are built from titles that arrive off a streaming page, so they
 * have to survive punctuation, spaces and the occasional malformed id. A link
 * that 404s is worse than no link at all.
 *
 * The URL *shapes* here were each resolved against the live site; this checks
 * that the construction stays correct.
 *
 * Run with: npm run verify:links
 */

import { ratingUrl, awardUrl, personUrl } from "../src/shared/utils/links";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

// --- Direct links, where an id exists --------------------------------------
check(
  "IMDb goes straight to the title",
  ratingUrl("IMDb", "The Big Short", "tt1596363"),
  "https://www.imdb.com/title/tt1596363/"
);
// Verified live: this redirects to letterboxd.com/film/the-big-short/
check(
  "Letterboxd resolves an IMDb id to the film",
  ratingUrl("Letterboxd", "The Big Short", "tt1596363"),
  "https://letterboxd.com/imdb/tt1596363/"
);

// --- Search, where no id is published --------------------------------------
check(
  "Rotten Tomatoes searches",
  ratingUrl("RottenTomatoes", "The Big Short", "tt1596363"),
  "https://www.rottentomatoes.com/search?search=The%20Big%20Short"
);
check(
  "Metacritic searches",
  ratingUrl("Metacritic", "The Big Short", "tt1596363"),
  "https://www.metacritic.com/search/The%20Big%20Short/"
);

// --- Falling back when the id is missing or malformed ----------------------
check(
  "IMDb falls back to search without an id",
  ratingUrl("IMDb", "The Big Short"),
  "https://www.imdb.com/find/?q=The%20Big%20Short"
);
// An id that isn't an IMDb id must never be interpolated into a path
check(
  "a malformed id is not trusted",
  ratingUrl("IMDb", "Dune", "../../evil"),
  "https://www.imdb.com/find/?q=Dune"
);
check(
  "Letterboxd falls back to search",
  ratingUrl("Letterboxd", "Dune", "nonsense"),
  "https://letterboxd.com/search/Dune/"
);

// --- Titles that would break a naive URL -----------------------------------
check(
  "encodes punctuation",
  ratingUrl("RottenTomatoes", "Spider-Man: No Way Home"),
  "https://www.rottentomatoes.com/search?search=Spider-Man%3A%20No%20Way%20Home"
);
check(
  "encodes ampersands",
  ratingUrl("Metacritic", "Fear & Loathing"),
  "https://www.metacritic.com/search/Fear%20%26%20Loathing/"
);
check("no title and no id yields nothing", ratingUrl("RottenTomatoes", "   "), null);

// --- Awards ----------------------------------------------------------------
// Wikidata supplies the article for most categories
check(
  "an award uses the article the provider gave",
  awardUrl("Oscar", "Best Adapted Screenplay", "https://en.wikipedia.org/wiki/Academy_Award_for_Best_Adapted_Screenplay"),
  "https://en.wikipedia.org/wiki/Academy_Award_for_Best_Adapted_Screenplay"
);
check(
  "an award without an article searches rather than guessing one",
  awardUrl("Oscar", "Best Sound"),
  "https://en.wikipedia.org/w/index.php?search=Oscar%20Best%20Sound"
);
// A provider URL is interpolated into an href, so only https is accepted
check(
  "a non-https article is rejected",
  awardUrl("Oscar", "Best Sound", "javascript:alert(1)"),
  "https://en.wikipedia.org/w/index.php?search=Oscar%20Best%20Sound"
);
check(
  "an award with no category still links",
  awardUrl("National Board of Review", undefined),
  "https://en.wikipedia.org/w/index.php?search=National%20Board%20of%20Review"
);
check("an unnamed award links nowhere", awardUrl("", undefined), null);

// --- People ----------------------------------------------------------------
check(
  "a recipient links to a search",
  personUrl("Adam McKay"),
  "https://en.wikipedia.org/w/index.php?search=Adam%20McKay"
);
check("an empty name links nowhere", personUrl("  "), null);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
