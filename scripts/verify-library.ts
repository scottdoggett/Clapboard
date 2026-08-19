/**
 * Personal Library Verification
 *
 * The library holds the only data in this extension the user created rather
 * than fetched, so the state machine has to be right: nothing invented,
 * nothing silently lost.
 *
 * Run with: npm run verify:library
 */

import {
  libraryKey,
  titleKey,
  applyChange,
  buildReview,
  groupEntries,
  sortEntries,
  type LibraryEntry,
} from "../src/shared/utils/library";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

const NOW = 1_700_000_000_000;
const bigShort = { title: "The Big Short", year: 2015, type: "movie" as const, imdbId: "tt1596363" };

// --- Identity --------------------------------------------------------------
check("an IMDb id is the identity when present", libraryKey(bigShort), "imdb:tt1596363");
// The same film is titled differently across services, so the id has to win
check(
  "the same film matches across platform title differences",
  libraryKey({ title: "The Office (U.S.)", imdbId: "tt0386676" }) ===
    libraryKey({ title: "The Office", year: 2005, imdbId: "tt0386676" }),
  true
);
check(
  "titles fall back to a normalized key",
  libraryKey({ title: "The Big Short", year: 2015, type: "movie" }),
  "title:the big short|2015|movie"
);
// A browse tile knows only a name, so its key must ignore year and type
check("a tile key uses the title alone", titleKey("The Big Short"), "title:the big short||");

// A title marked from a tile and later opened in the modal must be the same
// entry, even though the modal knows a year and type the tile did not
check(
  "a tile-made entry is still found once year and type are known",
  titleKey("The Big Short") !== libraryKey({ title: "The Big Short", year: 2015, type: "movie" }),
  true
);
check(
  "punctuation and case don't split a title",
  titleKey("Spider-Man: No Way Home") === titleKey("spider man no way home"),
  true
);

// --- Creating and clearing marks -------------------------------------------
const watched = applyChange(undefined, bigShort, { watchedAt: NOW }, NOW);
check("marking watched creates an entry", watched?.watchedAt, NOW);
check("...carrying the title's details", [watched?.title, watched?.year, watched?.imdbId], [
  "The Big Short",
  2015,
  "tt1596363",
]);

// An entry that records nothing is deleted rather than left as a husk
check(
  "clearing the only mark removes the entry",
  applyChange(watched!, bigShort, { watchedAt: undefined }, NOW),
  null
);

// ...but something the user actually wrote is never dropped as a side effect
const reviewed = applyChange(
  watched!,
  bigShort,
  { review: { text: "Furious and very funny.", rating: 8, updatedAt: NOW } },
  NOW
);
check(
  "un-watching keeps a review",
  applyChange(reviewed!, bigShort, { watchedAt: undefined }, NOW)?.review?.text,
  "Furious and very funny."
);
check(
  "an empty review does not keep an otherwise empty entry alive",
  applyChange(
    { ...watched!, watchedAt: undefined },
    bigShort,
    { review: { text: "   ", updatedAt: NOW } },
    NOW
  ),
  null
);

// --- Details improve as the lookup resolves --------------------------------
// A title marked from a browse tile has no id or poster yet
const fromTile = applyChange(undefined, { title: "The Big Short" }, { watchlistedAt: NOW }, NOW);
check("a tile-marked entry starts without an id", fromTile?.imdbId, undefined);

const enriched = applyChange(
  fromTile!,
  { ...bigShort, posterUrl: "https://example.com/p.jpg" },
  {},
  NOW + 1
);
check("a later lookup fills in the id", enriched?.imdbId, "tt1596363");
check("...and the poster", enriched?.posterUrl, "https://example.com/p.jpg");
check("...without losing the mark", enriched?.watchlistedAt, NOW);

// --- Reviews ---------------------------------------------------------------
check("a review is trimmed", buildReview("  Great  ", 8, NOW), {
  text: "Great",
  rating: 8,
  updatedAt: NOW,
});
check("a rating alone is a review", buildReview("", 7, NOW)?.rating, 7);
check("nothing typed is not a review", buildReview("   ", undefined, NOW), undefined);
check("a rating is clamped to the scale", buildReview("x", 47, NOW)?.rating, 10);
check("a negative rating is clamped", buildReview("x", -3, NOW)?.rating, 0);
check("a rating is rounded to one decimal", buildReview("x", 7.44, NOW)?.rating, 7.4);
check("a non-finite rating is dropped", buildReview("x", NaN, NOW)?.rating, undefined);

// --- Grouping --------------------------------------------------------------
const entries: LibraryEntry[] = [
  { key: "a", title: "Watchlisted", watchlistedAt: NOW, updatedAt: NOW + 3 },
  { key: "b", title: "Watched", watchedAt: NOW, updatedAt: NOW + 2 },
  // Watched *and* watchlisted: it has served its purpose on the list
  { key: "c", title: "Both", watchlistedAt: NOW, watchedAt: NOW, updatedAt: NOW + 1 },
  { key: "d", title: "Reviewed", review: { text: "Good", updatedAt: NOW }, updatedAt: NOW },
];
const grouped = groupEntries(entries);
check("the watchlist drops what has been watched", grouped.watchlist.map((e) => e.title), [
  "Watchlisted",
]);
check("watched includes both", grouped.watched.map((e) => e.title), ["Watched", "Both"]);
check("reviewed lists only real reviews", grouped.reviewed.map((e) => e.title), ["Reviewed"]);
check(
  "entries sort most recently touched first",
  sortEntries(entries).map((e) => e.title),
  ["Watchlisted", "Watched", "Both", "Reviewed"]
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
