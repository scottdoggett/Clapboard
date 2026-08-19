/**
 * Watch-History Import Verification
 *
 * The import path is the only one in the extension that writes the user's own
 * record of what they have watched from a file they hand over. A wrong ratings
 * column puts scores they never gave into their library; a wrong episode rule
 * turns "John Wick: Chapter 2" into "John Wick"; a merge that overwrites loses
 * a review they typed. None of that surfaces as an error — it just quietly
 * becomes what their library says. So the decisions are pinned here.
 *
 * **On the fixtures.** The Netflix shapes (`Title,Date`, and the fuller
 * `ViewingActivity.csv` from a data request) are documented and widely
 * described. The Letterboxd and IMDb rows below are built from third-party
 * descriptions of those exports, not read off a real file — the same caveat
 * that stands over the MDBList parser. What these tests therefore prove is
 * that the *tolerance* works: columns are matched by name from a synonym list,
 * so a header that differs from the fixture still imports. Check the first real
 * export against them.
 *
 * Run with: npm run verify:import
 */

import { parseCsv, parseCsvRecords, normalizeHeader } from "../src/shared/utils/csv";
import {
  collapseEpisodeTitle,
  collapseImported,
  describeImport,
  detectFiveStarScale,
  detectKind,
  detectSource,
  findColumn,
  mergeImported,
  parseImdbId,
  parseImportDate,
  parseImportFile,
  parseImportRating,
  parseImportYear,
  type ImportedTitle,
} from "../src/shared/utils/importParse";
import { isZip, readZip, entryText } from "../src/shared/utils/zip";
import type { LibraryEntry } from "../src/shared/utils/library";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

const NOW = Date.UTC(2026, 7, 19);
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

// ===========================================================================
// CSV
// ===========================================================================

console.log("\n--- CSV ---");

check("plain rows", parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);

// The first row of a real Letterboxd export defeats a comma split
check(
  "a comma inside a quoted field",
  parseCsv('Title,Year\n"Kill Bill: Vol. 1, The",2003'),
  [["Title", "Year"], ["Kill Bill: Vol. 1, The", "2003"]]
);

check(
  "a doubled quote is one literal quote",
  parseCsv('Review\n"He said ""no"" twice"'),
  [["Review"], ['He said "no" twice']]
);

// Letterboxd reviews are free text and routinely contain paragraph breaks
check(
  "a newline inside a quoted field does not end the row",
  parseCsv('Name,Review\nDune,"Line one\nLine two"'),
  [["Name", "Review"], ["Dune", "Line one\nLine two"]]
);

check("CRLF line endings", parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
check("a trailing newline adds no row", parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
check("blank lines are dropped", parseCsv("a,b\n\n1,2"), [["a", "b"], ["1", "2"]]);
check("empty quoted fields", parseCsv('a,"",c'), [["a", "", "c"]]);
check("padding before an opening quote", parseCsv('a, "b, c"'), [["a", "b, c"]]);

// Anyone who opened the export in Excel before uploading it has one of these
check("a byte-order mark is stripped from the file", parseCsv("﻿Title\nDune"), [["Title"], ["Dune"]]);
check("so the first header still matches", parseCsvRecords("﻿Title\nDune").headers, ["title"]);

// Common near the end of an interrupted download
check(
  "a short row reads as far as it goes",
  parseCsvRecords("Title,Year,Rating\nDune,2021").rows,
  [{ title: "Dune", year: "2021", rating: "" }]
);

check("headers normalize", normalizeHeader("  Watched_Date  "), "watched date");
check("empty input", parseCsvRecords(""), { headers: [], rows: [] });

// ===========================================================================
// Column matching
// ===========================================================================

console.log("\n--- Columns ---");

// The failure this prevents is silent and permanent: an IMDb export carries
// both the site's average and the user's own score, and importing the wrong
// one fills a library with ratings they never gave
const IMDB_HEADERS = [
  "const", "your rating", "date rated", "title", "original title", "url",
  "title type", "imdb rating", "runtime mins", "year", "genres", "num votes",
  "release date", "directors",
];

check("'your rating' wins over 'imdb rating'", findColumn(IMDB_HEADERS, "rating"), "your rating");
check("the site's rating is never taken alone", findColumn(["imdb rating"], "rating"), undefined);
check("nor is an average", findColumn(["average rating"], "rating"), undefined);
check("a plain 'rating' is the user's", findColumn(["name", "rating"], "rating"), "rating");

// Letterboxd's diary has both the day it was logged and the day it was seen
check(
  "'watched date' wins over 'date'",
  findColumn(["date", "name", "year", "watched date"], "watchedDate"),
  "watched date"
);
check("Netflix's plain file has only a date", findColumn(["title", "date"], "watchedDate"), "date");
check(
  "Netflix's data request uses a start time",
  findColumn(["profile name", "start time", "title"], "watchedDate"),
  "start time"
);

check("the IMDb id column", findColumn(IMDB_HEADERS, "imdbId"), "const");
check("a title column", findColumn(["letterboxd uri", "name", "year"], "title"), "name");
check("a missing column", findColumn(["date"], "title"), undefined);

// A header no fixed list would have covers itself by substring
check(
  "an unfamiliar header still matches",
  findColumn(["watched date (utc)"], "watchedDate"),
  "watched date (utc)"
);

// ===========================================================================
// Format detection
// ===========================================================================

console.log("\n--- Formats ---");

check(
  "Letterboxd is known by its URI column",
  detectSource("export (1).csv", ["date", "name", "year", "letterboxd uri"]),
  "letterboxd"
);
check("IMDb is known by Const", detectSource("ratings.csv", IMDB_HEADERS), "imdb");
check(
  "Netflix's data request is known by its columns",
  detectSource("something.csv", ["profile name", "start time", "title", "supplemental video type"]),
  "netflix"
);
check(
  "Netflix's plain download is known by its shape",
  detectSource("NetflixViewingHistory.csv", ["title", "date"]),
  "netflix"
);
check("anything else is generic", detectSource("my films.csv", ["title", "year"]), "generic");

// Headers beat the file name, since a name is whatever the downloads folder
// made of it
check(
  "a renamed Letterboxd file is still Letterboxd",
  detectSource("netflix-stuff.csv", ["letterboxd uri", "name"]),
  "letterboxd"
);

// Letterboxd's watched.csv and watchlist.csv have identical columns, so only
// the name can tell them apart — which is why the user can override it
check("a watchlist file", detectKind("watchlist.csv"), "watchlist");
check("a watchlist with a suffix", detectKind("watchlist (2).csv"), "watchlist");
check("a watched file", detectKind("watched.csv"), "watched");
check("a diary file", detectKind("diary.csv"), "watched");
check("'watched' is not read as 'watchlist'", detectKind("WATCHED.CSV"), "watched");

// ===========================================================================
// Episode collapsing
// ===========================================================================

console.log("\n--- Episodes ---");

// A viewing history is a list of episodes; a library is a list of titles
check("a Netflix episode row", collapseEpisodeTitle("Stranger Things: Season 1: Chapter One"), {
  title: "Stranger Things",
  isEpisode: true,
});

// The four cases that look identical and must not be treated identically.
// The rule is that a season marker only counts with something after it.
check("a series whose season is a 'Part'", collapseEpisodeTitle("Money Heist: Part 1: Episode 1"), {
  title: "Money Heist",
  isEpisode: true,
});
check(
  "a film whose title ends in 'Part 1'",
  collapseEpisodeTitle("Harry Potter and the Deathly Hallows: Part 1"),
  { title: "Harry Potter and the Deathly Hallows: Part 1", isEpisode: false }
);
check("a film whose title ends in 'Chapter 2'", collapseEpisodeTitle("John Wick: Chapter 2"), {
  title: "John Wick: Chapter 2",
  isEpisode: false,
});
// Three segments with the marker last and nothing after it. This is the case
// the two-part early return does not answer, and the one that decides the
// trade: a film written this way is common, a Netflix row for a whole season
// with no episode after it is not.
check(
  "a three-part film title ending in a marker",
  collapseEpisodeTitle("The Hunger Games: Mockingjay: Part 1"),
  { title: "The Hunger Games: Mockingjay: Part 1", isEpisode: false }
);
check(
  "a colon inside the show's own name survives",
  collapseEpisodeTitle("Avatar: The Last Airbender: Book 1: Water: The Boy in the Iceberg"),
  { title: "Avatar: The Last Airbender", isEpisode: true }
);

check("a limited series", collapseEpisodeTitle("The Queen's Gambit: Limited Series: Openings"), {
  title: "The Queen's Gambit",
  isEpisode: true,
});
check("Netflix localizes the marker", collapseEpisodeTitle("Dark: Saison 1: Geheimnisse"), {
  title: "Dark",
  isEpisode: true,
});
check("a plain film is untouched", collapseEpisodeTitle("Dune"), {
  title: "Dune",
  isEpisode: false,
});
check("a film with a subtitle is untouched", collapseEpisodeTitle("Mission: Impossible"), {
  title: "Mission: Impossible",
  isEpisode: false,
});

// ===========================================================================
// Dates
// ===========================================================================

console.log("\n--- Dates ---");

// Everything is built in UTC: these are calendar dates with no time in them,
// and reading a bare date in local time shifts it a day for half the world
check("ISO", parseImportDate("2021-10-22"), utc(2021, 10, 22));
check("ISO with a time", parseImportDate("2021-10-22 19:04:11"), Date.UTC(2021, 9, 22, 19, 4, 11));
check("ISO with a T", parseImportDate("2021-10-22T19:04"), Date.UTC(2021, 9, 22, 19, 4));

// Netflix writes the profile's locale and says nothing about which it used.
// An unmistakable day settles it; otherwise it reads month-first, which is
// what the US-default download produces.
check("an unambiguous day-first date", parseImportDate("22/10/2021"), utc(2021, 10, 22));
check("an ambiguous date reads month-first", parseImportDate("10/01/2019"), utc(2019, 10, 1));
check("a two-digit year", parseImportDate("3/14/19"), utc(2019, 3, 14));
check("a two-digit year before the pivot", parseImportDate("3/14/99"), utc(1999, 3, 14));
check("YYYY/MM/DD", parseImportDate("2021/10/22"), utc(2021, 10, 22));
check("an empty cell", parseImportDate(""), undefined);
check("junk", parseImportDate("not a date"), undefined);

// ===========================================================================
// Years, ids and ratings
// ===========================================================================

console.log("\n--- Fields ---");

check("a bare year", parseImportYear("2021"), 2021);
check("a year inside a release date", parseImportYear("2021-10-22"), 2021);
check("a runtime is not a year", parseImportYear("148"), undefined);
check("a year before film existed", parseImportYear("1023"), undefined);

check("an IMDb id", parseImdbId("tt1375666"), "tt1375666");
check("a Letterboxd URI is not an IMDb id", parseImdbId("https://boxd.it/2a1c"), undefined);
check("an empty id", parseImdbId(""), undefined);

// Letterboxd rates out of 5 in halves; the overlay's stars are out of 10 in
// halves, so the conversion is exact
check("a five-star rating doubles", parseImportRating("4.5", true), 9);
check("half a star", parseImportRating("0.5", true), 1);
check("a ten-point rating passes through", parseImportRating("8", false), 8);
check("a rating off the scale is dropped", parseImportRating("11", false), undefined);
check("a doubled rating off the scale is dropped", parseImportRating("6", true), undefined);
check("an unrated row", parseImportRating("", false), undefined);
check("a zero is not a rating", parseImportRating("0", true), undefined);
// The overlay draws halves, so anything finer has to land on one
check("an odd scale is rounded to a half", parseImportRating("7.3", false), 7.5);

check("Letterboxd is known to be out of five", detectFiveStarScale("letterboxd", ["4"]), true);
check("IMDb is known to be out of ten", detectFiveStarScale("imdb", ["4"]), false);
check("an unknown file of low scores reads as five", detectFiveStarScale("generic", ["4", "3.5"]), true);
check("an unknown file with a high score reads as ten", detectFiveStarScale("generic", ["4", "9"]), false);
check("no ratings at all", detectFiveStarScale("generic", ["", ""]), false);

// ===========================================================================
// Whole files
// ===========================================================================

console.log("\n--- Files ---");

const netflix = parseImportFile(
  "NetflixViewingHistory.csv",
  [
    "Title,Date",
    '"Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers","10/22/21"',
    '"Stranger Things: Season 1: Chapter Two: The Weirdo on Maple Street","10/23/21"',
    '"Stranger Things: Season 2: MADMAX","11/02/21"',
    '"The Big Short","3/14/19"',
  ].join("\n"),
  NOW
);

check("Netflix: detected", [netflix.source, netflix.kind], ["netflix", "watched"]);
check("Netflix: four rows read", netflix.rows, 4);
// The whole point of collapsing: a season is one entry, not one per episode
check("Netflix: a season collapses to one title", netflix.titles.length, 2);
check("Netflix: the show, dated from its first episode", netflix.titles[0], {
  title: "Stranger Things",
  year: undefined,
  type: "series",
  imdbId: undefined,
  watchedAt: utc(2021, 10, 22),
});
check("Netflix: the film keeps its own date", netflix.titles[1], {
  title: "The Big Short",
  year: undefined,
  type: undefined,
  imdbId: undefined,
  watchedAt: utc(2019, 3, 14),
});

// The fuller export from a data request logs trailers and title-card
// animations alongside real viewing; those are not things anyone watched
const netflixFull = parseImportFile(
  "ViewingActivity.csv",
  [
    "Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type",
    'Scott,2021-10-22 19:04:11,00:48:12,,"Dune",,Chrome',
    'Scott,2021-10-22 18:59:02,00:01:30,,"Dune",TRAILER,Chrome',
  ].join("\n"),
  NOW
);

check("Netflix full: detected", netflixFull.source, "netflix");
check("Netflix full: a trailer is not a watch", netflixFull.skipped, 1);
check("Netflix full: one real title", netflixFull.titles, [
  {
    title: "Dune",
    year: undefined,
    type: undefined,
    imdbId: undefined,
    watchedAt: Date.UTC(2021, 9, 22, 19, 4, 11),
  },
]);

const letterboxd = parseImportFile(
  "reviews.csv",
  [
    "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date",
    '2022-01-04,Dune,2021,https://boxd.it/1,4.5,No,"A staggering piece of craft, if cold.",sci-fi,2021-12-30',
  ].join("\n"),
  NOW
);

check("Letterboxd: detected", letterboxd.source, "letterboxd");
check("Letterboxd: a diary row carries everything", letterboxd.titles, [
  {
    title: "Dune",
    year: 2021,
    type: undefined,
    imdbId: undefined,
    // The watched date, not the logged date
    watchedAt: utc(2021, 12, 30),
    rating: 9,
    reviewText: "A staggering piece of craft, if cold.",
  },
]);

const letterboxdWatchlist = parseImportFile(
  "watchlist.csv",
  ["Date,Name,Year,Letterboxd URI", "2026-02-01,Sinners,2025,https://boxd.it/9"].join("\n"),
  NOW
);
check("Letterboxd: a watchlist file is a watchlist", letterboxdWatchlist.kind, "watchlist");
check("Letterboxd: watchlisted, not watched", letterboxdWatchlist.titles[0], {
  title: "Sinners",
  year: 2025,
  type: undefined,
  imdbId: undefined,
  watchlistedAt: utc(2026, 2, 1),
  rating: undefined,
});

const imdb = parseImportFile(
  "ratings.csv",
  [
    "Const,Your Rating,Date Rated,Title,Title Type,IMDb Rating,Year",
    "tt1375666,9,2020-05-01,Inception,movie,8.8,2010",
  ].join("\n"),
  NOW
);
check("IMDb: the user's rating, not the site's", imdb.titles, [
  {
    title: "Inception",
    year: 2010,
    type: undefined,
    imdbId: "tt1375666",
    watchedAt: utc(2020, 5, 1),
    rating: 9,
  },
]);

// The honest answer for Prime Video and Disney+, neither of which offers an
// export: any CSV with a title column works
const generic = parseImportFile(
  "my films.csv",
  ["Video Title,Year", "The Bear,2022", ",2019"].join("\n"),
  NOW
);
check("generic: an unfamiliar file still imports", generic.titles.length, 1);
check("generic: a row with no title is skipped, not guessed at", generic.skipped, 1);
check("generic: a row with no date is dated from the import", generic.titles[0].watchedAt, NOW);

const override = parseImportFile("my films.csv", "Title\nDune", NOW, "watchlist");
check("the user can say what a file means", override.titles[0], {
  title: "Dune",
  year: undefined,
  type: undefined,
  imdbId: undefined,
  watchlistedAt: NOW,
});

check("a file with no title column yields nothing", parseImportFile("x.csv", "Date\n2021-01-01", NOW).titles, []);
check("an empty file", parseImportFile("x.csv", "", NOW).titles, []);

// ===========================================================================
// Collapsing across files
// ===========================================================================

console.log("\n--- Collapsing ---");

// A Letterboxd export is four files describing one set of films: watched.csv
// says it was seen, ratings.csv scores it, reviews.csv writes about it
check(
  "the same title across files becomes one entry",
  collapseImported([
    { title: "Dune", watchedAt: utc(2021, 12, 30) },
    { title: "Dune", year: 2021, rating: 9 },
    { title: "Dune", reviewText: "Cold and vast." },
  ]),
  [
    {
      title: "Dune",
      year: 2021,
      type: undefined,
      imdbId: undefined,
      watchedAt: utc(2021, 12, 30),
      watchlistedAt: undefined,
      rating: 9,
      reviewText: "Cold and vast.",
    },
  ]
);

// "When did I first see this" is the question a history can answer
check(
  "the earliest watch date survives a rewatch",
  collapseImported([
    { title: "Dune", watchedAt: utc(2024, 1, 1) },
    { title: "Dune", watchedAt: utc(2021, 12, 30) },
  ])[0].watchedAt,
  utc(2021, 12, 30)
);

// Where two rows *are* the same film, the better-written name is the one to
// keep — Netflix strips punctuation from titles that Letterboxd spells out
check(
  "the fuller spelling of the same title wins",
  collapseImported([
    { title: "spider man no way home" },
    { title: "Spider-Man: No Way Home" },
  ]).map((entry) => entry.title),
  ["Spider-Man: No Way Home"]
);

// A sequel is not its predecessor, however much of the name it shares
check(
  "a longer title is a different film, not a fuller one",
  collapseImported([{ title: "Dune" }, { title: "Dune: Part Two" }]).length,
  2
);
check(
  "and so is this one",
  collapseImported([{ title: "Avatar" }, { title: "Avatar: The Way of Water" }]).length,
  2
);

// Punctuation and case differ between services for the same film
check(
  "normalization matches across services",
  collapseImported([{ title: "Spider-Man: No Way Home" }, { title: "Spider Man No Way Home" }]).length,
  1
);

// ===========================================================================
// Merging into a library
// ===========================================================================

console.log("\n--- Merge ---");

const entry = (over: Partial<LibraryEntry>): LibraryEntry => ({
  key: "title:dune||",
  title: "Dune",
  updatedAt: 1,
  ...over,
});

// Adding to an empty library
const fresh = mergeImported({}, [{ title: "Dune", watchedAt: utc(2021, 12, 30) }], NOW);
check("a new title is added", [fresh.added, fresh.updated], [1, 0]);
check("keyed by normalized title, as a browse tile is", Object.keys(fresh.library), ["title:dune||"]);

// Re-importing the same file must be a no-op, or every import inflates the
// counts and rewrites every row
const again = mergeImported(fresh.library, [{ title: "Dune", watchedAt: utc(2021, 12, 30) }], NOW);
check("re-importing changes nothing", [again.added, again.updated], [0, 0]);

// The governing rule: an import never takes anything away
const withReview = {
  "title:dune||": entry({
    watchedAt: utc(2024, 1, 1),
    watchlistedAt: utc(2023, 1, 1),
    sentiment: "liked" as const,
    review: { text: "Written here, by hand.", rating: 7, updatedAt: 5 },
  }),
};

const onto = mergeImported(
  withReview,
  [
    {
      title: "Dune",
      year: 2021,
      watchedAt: utc(2021, 12, 30),
      rating: 9,
      reviewText: "Imported text.",
    },
  ],
  NOW
);

check("the user's own review is not overwritten", onto.library["title:dune||"].review, {
  text: "Written here, by hand.",
  rating: 7,
  updatedAt: 5,
});
check("a mark made here is not cleared", onto.library["title:dune||"].sentiment, "liked");
check("the import moves the watch date earlier", onto.library["title:dune||"].watchedAt, utc(2021, 12, 30));
check("a gap the import can fill is filled", onto.library["title:dune||"].year, 2021);
check("changing something counts as an update", [onto.added, onto.updated], [0, 1]);

// An import can supply what was never recorded
const gaps = mergeImported(
  { "title:dune||": entry({ watchlistedAt: utc(2023, 1, 1) }) },
  [{ title: "Dune", rating: 9, reviewText: "Imported text." }],
  NOW
);
check("an import supplies a review where there was none", gaps.library["title:dune||"].review, {
  text: "Imported text.",
  rating: 9,
  updatedAt: NOW,
});

// An IMDb export carries ids, so its entries key by id — and an entry already
// held under a title key migrates onto it rather than doubling up
const migrated = mergeImported(
  { "title:inception||": entry({ key: "title:inception||", title: "Inception", watchlistedAt: 10 }) },
  [{ title: "Inception", imdbId: "tt1375666", watchedAt: utc(2020, 5, 1) }],
  NOW
);
check("an id-carrying import migrates the entry", Object.keys(migrated.library), ["imdb:tt1375666"]);
check("and keeps what was already there", migrated.library["imdb:tt1375666"].watchlistedAt, 10);

// A library holding other titles must come through untouched
const others = mergeImported(
  { "title:heat||": entry({ key: "title:heat||", title: "Heat", watchedAt: 3 }) },
  [{ title: "Dune", watchedAt: NOW }],
  NOW
);
check("other entries are left alone", Object.keys(others.library).sort(), ["title:dune||", "title:heat||"]);

// ===========================================================================
// Reporting
// ===========================================================================

console.log("\n--- Reporting ---");

check(
  "a summary says what happened",
  describeImport({ files: [netflix], added: 2, updated: 0, titles: 2 }),
  "2 added."
);
check(
  "titles that changed nothing are accounted for",
  describeImport({ files: [netflix], added: 1, updated: 1, titles: 5 }),
  "1 added, 1 updated, 3 already up to date."
);
check("nothing to import", describeImport({ files: [], added: 0, updated: 0, titles: 0 }), "Nothing to import.");

// ===========================================================================
// ZIP
// ===========================================================================

console.log("\n--- ZIP ---");

/**
 * Build a ZIP the way an export tool would, so the reader is tested against a
 * real archive rather than against its own assumptions. Both storage methods
 * appear because exporters use both — a tiny CSV often ends up stored.
 */
async function buildZip(
  files: Array<{ name: string; body: string; deflate: boolean }>
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const raw = encoder.encode(file.body);
    const data = file.deflate ? await deflateRaw(raw) : raw;
    const name = encoder.encode(file.name);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, file.deflate ? 8 : 0, true);
    localView.setUint32(14, crc32(raw), true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const header = new Uint8Array(46 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(10, file.deflate ? 8 : 0, true);
    headerView.setUint32(16, crc32(raw), true);
    headerView.setUint32(20, data.length, true);
    headerView.setUint32(24, raw.length, true);
    headerView.setUint16(28, name.length, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);

    chunks.push(local, data);
    central.push(header);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }

  return out.buffer;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function verifyZip(): Promise<void> {
  const archive = await buildZip([
    { name: "letterboxd-scott/watched.csv", body: "Date,Name,Year\n2021-12-30,Dune,2021", deflate: true },
    { name: "letterboxd-scott/watchlist.csv", body: "Date,Name,Year\n2026-02-01,Sinners,2025", deflate: false },
  ]);

  check("an archive is known by its signature, not its name", isZip(archive), true);
  check("a CSV is not an archive", isZip(new TextEncoder().encode("Title,Date").buffer), false);

  const entries = await readZip(archive);
  check("both entries are found", entries.map((e) => e.name), [
    "letterboxd-scott/watched.csv",
    "letterboxd-scott/watchlist.csv",
  ]);
  check("a deflated entry inflates", entryText(entries[0]), "Date,Name,Year\n2021-12-30,Dune,2021");
  check("a stored entry reads straight through", entryText(entries[1]), "Date,Name,Year\n2026-02-01,Sinners,2025");

  // A path keeps its leaf name, because that leaf is what says which list it
  // is — and the folder around it can say something different
  check(
    "the file inside the archive still identifies its list",
    parseImportFile("watchlist.csv", entryText(entries[1]), NOW).kind,
    "watchlist"
  );
  // …and why only the leaf may be passed: a whole path drags the folder's name
  // into the decision, and export folders are named after the export
  check(
    "a full path would let the folder decide",
    parseImportFile("letterboxd-watchlist-2026/watched.csv", "Name\nDune", NOW).kind,
    "watchlist"
  );
  check(
    "the leaf alone gets it right",
    parseImportFile("watched.csv", "Name\nDune", NOW).kind,
    "watched"
  );

  let rejected = "";
  try {
    await readZip(new TextEncoder().encode("not an archive at all").buffer);
  } catch (caught) {
    rejected = caught instanceof Error ? caught.message : String(caught);
  }
  check("a file that isn't an archive is refused", rejected, "Not a ZIP archive");
}

await verifyZip();

// ===========================================================================
// The whole path
// ===========================================================================

/**
 * Run a real Letterboxd-shaped export end to end: a ZIP, several CSVs inside
 * it under a folder, one storage write at the end.
 *
 * `chrome.storage` is stubbed rather than mocked away, so this exercises the
 * orchestration for real — unzipping, keeping each entry's leaf name so
 * `watchlist.csv` is still a watchlist, folding four files describing one set
 * of films into one entry each, and writing once rather than once per title.
 */
async function verifyWholePath(): Promise<void> {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          writes++;
          Object.assign(store, values);
        },
      },
    },
  };

  let writes = 0;
  const { importFiles } = await import("../src/shared/utils/importLibrary");

  // The folder is deliberately named after a watchlist export while holding
  // watched.csv, which is what pins the orchestration to the leaf name
  const archive = await buildZip([
    {
      name: "letterboxd-watchlist-scott-2026/watched.csv",
      body: "Date,Name,Year,Letterboxd URI\n2022-01-04,Dune,2021,https://boxd.it/1",
      deflate: true,
    },
    {
      name: "letterboxd-watchlist-scott-2026/ratings.csv",
      body: "Date,Name,Year,Letterboxd URI,Rating\n2022-01-04,Dune,2021,https://boxd.it/1,4.5",
      deflate: true,
    },
    {
      name: "letterboxd-watchlist-scott-2026/watchlist.csv",
      body: "Date,Name,Year,Letterboxd URI\n2026-02-01,Sinners,2025,https://boxd.it/9",
      deflate: true,
    },
    // A note file that would parse perfectly well as a title list if anything
    // let it through. Only the extension says it isn't one.
    {
      name: "letterboxd-watchlist-scott-2026/lists/best-of-2021.txt",
      body: "Name,Year\nSome Note I Wrote,2021",
      deflate: false,
    },
  ]);

  const summary = await importFiles([{ name: "letterboxd-watchlist-scott-2026.zip", buffer: archive }]);

  check("the whole path: three CSVs read, the text file ignored", summary.files.length, 3);
  check("the whole path: two distinct films", summary.titles, 2);
  check("the whole path: both added", [summary.added, summary.updated], [2, 0]);
  check("the whole path: one storage write, not one per title", writes, 1);

  const library = store["clapboard_library"] as Record<string, LibraryEntry>;
  const dune = library["title:dune||"];

  // watched.csv says it was seen and ratings.csv scores it; they are one film
  check(
    "the whole path: watched and rated fold into one entry",
    [dune.title, dune.year, dune.watchedAt, dune.review?.rating, dune.watchlistedAt],
    ["Dune", 2021, utc(2022, 1, 4), 9, undefined]
  );
  // watched.csv sat inside a folder whose name says "watchlist"; the leaf wins
  check(
    "the whole path: the folder name did not relabel watched.csv",
    dune.watchlistedAt,
    undefined
  );
  check(
    "the whole path: the watchlist file stayed a watchlist",
    [library["title:sinners||"].watchlistedAt, library["title:sinners||"].watchedAt],
    [utc(2026, 2, 1), undefined]
  );

  // Handing over the same download twice is something people do
  const again = await importFiles([{ name: "letterboxd-watchlist-scott-2026.zip", buffer: archive }]);
  check("the whole path: re-importing changes nothing", [again.added, again.updated], [0, 0]);
}

await verifyWholePath();

const _typecheck: ImportedTitle = { title: "x" };
void _typecheck;

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
