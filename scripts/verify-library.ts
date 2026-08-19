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
import { fillFor, starRow, nextScore } from "../src/shared/utils/stars";
import {
  buildListView,
  PAGE_SIZE,
  searchEntries,
  sortByMode,
} from "../src/shared/utils/libraryView";

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

// --- Star rating -----------------------------------------------------------
// Someone's own rating shown back to them incorrectly is the worst kind of
// bug here, and these boundaries are half a step apart.
check("an unrated row is empty", starRow(0).filter((f) => f !== "empty").length, 0);
check("half a star", starRow(0.5)[0], "half");
check("one star", starRow(1)[0], "full");
check("a whole score fills exactly that many", starRow(7).filter((f) => f === "full").length, 7);
check("...and leaves the rest empty", starRow(7).filter((f) => f === "empty").length, 3);
check("a half score fills the halves correctly", starRow(7.5).slice(6, 9), ["full", "half", "empty"]);
check("full marks fill every star", starRow(10).every((f) => f === "full"), true);

// Boundaries, one half-step either side
check("just under a half is empty", fillFor(0.4, 0), "empty");
check("exactly a half is half", fillFor(0.5, 0), "half");
check("just under full is half", fillFor(0.9, 0), "half");
check("exactly full is full", fillFor(1, 0), "full");

// Clicking what is already selected is the only route back to unrated
check("clicking the current score clears it", nextScore(7.5, 7.5), undefined);
check("clicking another score sets it", nextScore(7.5, 3), 3);
check("clicking from unrated sets it", nextScore(undefined, 5), 5);

// ===========================================================================
// Searching, sorting and paging
// ===========================================================================
//
// These matter at import scale and not before. A hand-marked library is a
// dozen titles; an imported Netflix history is several hundred, and the list
// that rendered the first forty of them and said nothing about the rest looked
// exactly like a library holding forty.

console.log("\n--- Views ---");

const row = (over: Partial<LibraryEntry>): LibraryEntry => ({
  key: `k-${over.title ?? "x"}`,
  title: "Untitled",
  updatedAt: 0,
  ...over,
});

const shelf = [
  row({ title: "Spider-Man: No Way Home", year: 2021, updatedAt: 30 }),
  row({ title: "Dune", year: 2021, updatedAt: 10, review: { text: "", rating: 9, updatedAt: 0 } }),
  row({ title: "Heat", year: 1995, updatedAt: 20, review: { text: "", rating: 8, updatedAt: 0 } }),
  row({ title: "Arcane", updatedAt: 40 }),
];

// Anyone typing into a search box is working from memory, and memory does not
// carry punctuation
check("search ignores punctuation", searchEntries(shelf, "spiderman").map((e) => e.title), [
  "Spider-Man: No Way Home",
]);
check("search is case-insensitive", searchEntries(shelf, "DUNE").map((e) => e.title), ["Dune"]);
check("search matches mid-title", searchEntries(shelf, "way home").map((e) => e.title), [
  "Spider-Man: No Way Home",
]);
check("an empty query matches everything", searchEntries(shelf, "  ").length, 4);
check("no match", searchEntries(shelf, "zzz"), []);

check("recent is newest first", sortByMode(shelf, "recent").map((e) => e.title), [
  "Arcane", "Spider-Man: No Way Home", "Heat", "Dune",
]);
check("A-Z", sortByMode(shelf, "title").map((e) => e.title), [
  "Arcane", "Dune", "Heat", "Spider-Man: No Way Home",
]);

// An imported Netflix row carries no year at all, and those must sort last
// rather than read as year zero and lead the list
check("year is newest first, undated last", sortByMode(shelf, "year").map((e) => e.title), [
  "Dune", "Spider-Man: No Way Home", "Heat", "Arcane",
]);
check("rating is highest first, unrated last", sortByMode(shelf, "rating").map((e) => e.title), [
  "Dune", "Heat", "Arcane", "Spider-Man: No Way Home",
]);

// A list that reshuffles its unrated entries on every render is worse than one
// sorted by something arbitrary but stable
check(
  "ties break on title, so the order is total",
  sortByMode([row({ title: "B" }), row({ title: "A" })], "recent").map((e) => e.title),
  ["A", "B"]
);

// The whole point: what is held back is counted, never silently dropped
const many = Array.from({ length: 150 }, (_, index) =>
  row({ title: `Film ${String(index).padStart(3, "0")}`, updatedAt: index })
);

const page1 = buildListView(many, "", "title", 1);
check("a page is capped", page1.visible.length, PAGE_SIZE);
check("...but the total is the truth", page1.total, 150);
check("...and the remainder is counted", page1.remaining, 150 - PAGE_SIZE);

const page3 = buildListView(many, "", "title", 3);
check("asking for more pages shows more", page3.visible.length, 150);
check("and nothing is left over", page3.remaining, 0);

check("search narrows before paging", buildListView(many, "Film 04", "title", 1).total, 10);
check("a view of nothing", buildListView([], "", "recent", 1), {
  visible: [],
  total: 0,
  remaining: 0,
});

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
