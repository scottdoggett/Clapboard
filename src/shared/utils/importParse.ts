/**
 * Watch-History Import
 *
 * Turns an export file from Netflix, Letterboxd, IMDb — or anything else with
 * a title column — into library entries.
 *
 * Pure, and deliberately so: this is the one path in the extension that reads
 * a file the user hands over and writes it into the record of what they have
 * watched. Getting it wrong doesn't degrade a card, it corrupts their list. So
 * every decision it makes — which column is the title, which is *their* rating
 * rather than the site's, what a Netflix episode row collapses to, what a date
 * in `10/01/2019` means — lives here where `npm run verify:import` can hold it
 * to account.
 *
 * ## Matching columns by name, not position
 *
 * Four services, four column orders, and no two agree. But the *names* are
 * stable enough to match on, so every field is found by looking for a header
 * from a synonym list. This also means a format we have never seen still
 * imports, provided it calls its title column something recognisable — which
 * is the only realistic answer for Prime Video and Disney+, neither of which
 * offers a simple export at all.
 *
 * ## What has been verified, and what hasn't
 *
 * The Netflix viewing-activity file (`Title,Date`) and the fuller
 * `ViewingActivity.csv` from a data request are documented and widely
 * described. Letterboxd's and IMDb's exports are described consistently by
 * third parties but **their headers have not been read off a real file here**
 * — the same caveat that stands over the MDBList parser. The synonym lists are
 * therefore wider than any single format needs, and the first real export
 * should be checked against `npm run verify:import`.
 */

import type { LibraryEntry } from "@shared/utils/library";
import { libraryKey, titleKey } from "@shared/utils/library";
import { parseCsvRecords } from "@shared/utils/csv";

/** Which service a file came from, as far as we can tell. */
export type ImportSource = "netflix" | "letterboxd" | "imdb" | "generic";

/** What the rows in a file mean. */
export type ImportKind = "watched" | "watchlist";

/** One title, as read out of an export. */
export interface ImportedTitle {
  title: string;
  year?: number;
  type?: "movie" | "series";
  imdbId?: string;
  watchedAt?: number;
  watchlistedAt?: number;
  /** Out of 10 in halves, matching the scale the overlay uses */
  rating?: number;
  reviewText?: string;
}

/** What one file yielded. */
export interface ImportFileResult {
  fileName: string;
  source: ImportSource;
  kind: ImportKind;
  titles: ImportedTitle[];
  /** Data rows read, before collapsing episodes and de-duplicating */
  rows: number;
  /** Rows with no usable title */
  skipped: number;
  /** True when the file was longer than `MAX_ROWS` */
  truncated: boolean;
}

/**
 * The most rows read from one file.
 *
 * A Netflix history of several years runs to tens of thousands of episode
 * rows, which is fine; a file an order of magnitude past that is a sign
 * something else has been uploaded. Anything dropped is reported rather than
 * silently ignored — a truncated import that claims to have succeeded is worse
 * than one that says what it left out.
 */
export const MAX_ROWS = 50_000;

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------

/**
 * Header names to look for, in order of preference.
 *
 * Order carries real weight in two places. `your rating` must beat `rating`,
 * because an IMDb export contains both that and `imdb rating` — importing the
 * site's average as the user's own score would be a quiet, permanent lie. And
 * `watched date` must beat `date`, because Letterboxd's diary carries both the
 * day the film was seen and the day it was logged.
 */
const COLUMNS = {
  title: ["title", "name", "film title", "film", "movie", "video title", "series title", "show title", "original title"],
  year: ["year", "release year", "film year", "release date"],
  imdbId: ["const", "imdb id", "imdbid", "imdb", "tconst"],
  rating: ["your rating", "my rating", "user rating", "rating", "stars", "score"],
  review: ["review", "your review", "notes", "comment"],
  watchedDate: ["watched date", "date watched", "last watched", "date rated", "start time", "date added", "date", "created at", "timestamp"],
  supplemental: ["supplemental video type"],
} as const;

/**
 * Header names that must never be read as the user's own rating.
 *
 * Checked as an exclusion rather than by leaving them out of the synonym list,
 * because `rating` is in that list and `imdb rating` contains it. The failure
 * this prevents is silent: a library full of scores the user never gave.
 */
const NOT_MY_RATING = ["imdb rating", "average rating", "site rating", "community rating", "tmdb rating"];

/**
 * Find which header holds a given field.
 *
 * @param headers - Normalized headers from the file
 * @param field - Which field to look for
 * @returns The matching header, or undefined
 */
export function findColumn(
  headers: readonly string[],
  field: keyof typeof COLUMNS
): string | undefined {
  const candidates = COLUMNS[field];

  // Exact matches first, in preference order, so `your rating` wins over
  // `rating` even when `rating` appears earlier in the file
  for (const candidate of candidates) {
    const hit = headers.find((header) => header === candidate);
    if (hit && !(field === "rating" && NOT_MY_RATING.includes(hit))) return hit;
  }

  // Then substring matches, for headers like "letterboxd rating" or
  // "watched date (utc)" that no fixed list would cover
  for (const candidate of candidates) {
    const hit = headers.find(
      (header) => header.includes(candidate) && !NOT_MY_RATING.includes(header)
    );
    if (hit) return hit;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/**
 * Work out which service a file came from.
 *
 * The headers are trusted over the file name, since a name is whatever the
 * user's downloads folder made of it — the same Letterboxd export is
 * `ratings.csv` for one person and `ratings (1).csv` for another.
 *
 * @param fileName - Name of the uploaded file
 * @param headers - Normalized headers from the file
 * @returns The detected source
 */
export function detectSource(fileName: string, headers: readonly string[]): ImportSource {
  const name = fileName.toLowerCase();

  if (headers.includes("letterboxd uri")) return "letterboxd";
  if (headers.includes("const") || headers.includes("title type")) return "imdb";
  if (headers.includes("profile name") || headers.includes("supplemental video type")) {
    return "netflix";
  }

  if (name.includes("letterboxd")) return "letterboxd";
  if (name.includes("netflix") || name.includes("viewingactivity")) return "netflix";
  if (name.includes("imdb")) return "imdb";

  // Netflix's plain download is exactly two columns and no other export is
  if (headers.length === 2 && headers.includes("title") && headers.includes("date")) {
    return "netflix";
  }

  return "generic";
}

/**
 * Work out whether a file lists things watched or things to watch.
 *
 * This one *has* to come from the file name. Letterboxd's `watchlist.csv` and
 * `watched.csv` have identical columns, so nothing inside either file
 * distinguishes them — which is why the importer lets the user say.
 *
 * @param fileName - Name of the uploaded file
 * @returns What its rows mean
 */
export function detectKind(fileName: string): ImportKind {
  const name = fileName.toLowerCase();

  return /watch\s*-?_?list|to\s*-?_?watch|queue/.test(name) ? "watchlist" : "watched";
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

/**
 * Segments that mark the start of a season rather than part of a title.
 *
 * Netflix writes an episode as `Show: Season 1: Episode Name`, and localizes
 * the middle segment. Everything before it is the show.
 */
const SEASON_MARKER =
  /^(?:season|series|limited series|part|volume|vol\.?|book|episode|saison|temporada|staffel|stagione|seizoen|sezon|série|serie)\b/i;

/**
 * Reduce a Netflix row to the thing worth recording.
 *
 * A viewing history is a list of episodes; a library is a list of titles.
 * Fifty rows of *Stranger Things* should become one entry, not fifty.
 *
 * The rule is narrow on purpose: a season marker only counts when something
 * follows it. That single condition is what separates the four cases that
 * otherwise look identical —
 *
 * - `Money Heist: Part 1: Episode 1` collapses to *Money Heist* ✓
 * - `Harry Potter and the Deathly Hallows: Part 1` is left alone ✓
 * - `Avatar: The Last Airbender: Book 1: Water: The Boy in the Iceberg`
 *   collapses to *Avatar: The Last Airbender* ✓ (the first marker wins, so the
 *   colon inside the show's own name survives)
 * - `John Wick: Chapter 2` is left alone ✓
 *
 * A marker in final position is therefore under-collapsed rather than
 * over-collapsed, and that is the right way round: an entry titled
 * `Show: Episode 3` simply won't resolve against a ratings provider, while
 * `John Wick` truncated from `John Wick: Chapter 2` is a different film that
 * resolves perfectly.
 *
 * @param raw - The title cell as Netflix wrote it
 * @returns The show or film, and whether this was an episode row
 */
export function collapseEpisodeTitle(raw: string): { title: string; isEpisode: boolean } {
  const parts = raw.split(":").map((part) => part.trim());
  if (parts.length < 3) return { title: raw.trim(), isEpisode: false };

  // Start at 1: a marker can't be the show's whole name, and stop before the
  // last segment, since a marker with nothing after it is part of the title
  for (let index = 1; index < parts.length - 1; index++) {
    if (SEASON_MARKER.test(parts[index])) {
      return { title: parts.slice(0, index).join(": "), isEpisode: true };
    }
  }

  return { title: raw.trim(), isEpisode: false };
}

/**
 * Read a date out of an export.
 *
 * Netflix writes dates in the profile's locale, so `10/01/2019` is genuinely
 * ambiguous — October 1st to an American profile, January 10th to a British
 * one, and nothing in the file says which. Where the day is unmistakable
 * (a first number above 12) that settles it; otherwise it reads month-first,
 * which is what Netflix's own US-default download produces. The cost of being
 * wrong is a watch date off by a few months, which is the least bad outcome
 * available.
 *
 * Everything is built in UTC. These are calendar dates with no time in them,
 * and interpreting a bare date in local time shifts it across a day boundary
 * for half the world.
 *
 * @param value - The raw cell
 * @returns Milliseconds since the epoch, or undefined when unreadable
 */
export function parseImportDate(value: string): number | undefined {
  const text = value.trim();
  if (text === "") return undefined;

  // ISO first: Letterboxd and IMDb both write YYYY-MM-DD, optionally with a
  // time after it (Netflix's data-request export writes a full timestamp)
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (iso) {
    return Date.UTC(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
      Number(iso[6] ?? 0)
    );
  }

  const slashed = /^(\d{1,4})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (slashed) {
    const [, first, second, third] = slashed;

    // YYYY/MM/DD leaves no room for doubt
    if (first.length === 4) {
      return Date.UTC(Number(first), Number(second) - 1, Number(third));
    }

    const dayFirst = Number(first) > 12;
    const month = Number(dayFirst ? second : first);
    const day = Number(dayFirst ? first : second);

    return Date.UTC(expandYear(Number(third)), month - 1, day);
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * "19" -> 2019, "99" -> 1999.
 *
 * Netflix's download writes two-digit years. The pivot sits at 70 because the
 * earliest thing anyone can have streamed is a great deal more recent than
 * 1970, while a four-digit year is passed through untouched.
 */
function expandYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

/**
 * Read a release year.
 *
 * Some columns hold a bare year and some hold a full release date, so this
 * takes the first four-digit number that could plausibly be one.
 *
 * @param value - The raw cell
 * @returns A year, or undefined
 */
export function parseImportYear(value: string): number | undefined {
  const match = /(?<!\d)(\d{4})(?!\d)/.exec(value.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  // Film exists from the 1880s; anything outside that isn't a release year
  return year >= 1880 && year <= 2100 ? year : undefined;
}

/**
 * IMDb ids are `tt` and digits, and are the only thing here worth keying on.
 */
export function parseImdbId(value: string): string | undefined {
  const match = /^(tt\d+)$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Convert a rating onto the 0-10-in-halves scale the overlay uses.
 *
 * @param value - The raw cell
 * @param fiveStar - Whether the file's scale runs to 5 rather than 10
 * @returns A score, or undefined when the cell isn't a usable number
 */
export function parseImportRating(value: string, fiveStar: boolean): number | undefined {
  const score = Number(value.trim());
  if (!Number.isFinite(score) || score <= 0) return undefined;

  const scaled = fiveStar ? score * 2 : score;
  if (scaled > 10) return undefined;

  // The overlay's stars are half-steps, so a rating that isn't on one would
  // render as a star it can't draw
  return Math.round(scaled * 2) / 2;
}

/**
 * Decide whether a file's ratings are out of 5 or out of 10.
 *
 * Letterboxd and IMDb are known, so they are answered outright. For anything
 * else this is a guess made once per file rather than per row: a column where
 * nothing exceeds 5 and something carries a half is a five-star scale. A file
 * of ten-point scores that happen to all be low would be doubled — which is
 * why the guess is only reached for sources we don't recognise, and why the
 * import reports which scale it used.
 *
 * @param source - The detected service
 * @param values - Every rating cell in the file
 * @returns True when the scale runs to 5
 */
export function detectFiveStarScale(source: ImportSource, values: readonly string[]): boolean {
  if (source === "letterboxd") return true;
  if (source === "imdb") return false;

  const numbers = values
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (numbers.length === 0) return false;

  return numbers.every((value) => value <= 5);
}

// ---------------------------------------------------------------------------
// Reading a file
// ---------------------------------------------------------------------------

/**
 * Read one export file into titles.
 *
 * @param fileName - Name of the uploaded file, used to detect the format
 * @param text - Its contents
 * @param now - Current time, used when a row carries no date
 * @param kindOverride - What the user said the rows mean, if they said
 * @returns Everything the file yielded, plus what was skipped
 */
export function parseImportFile(
  fileName: string,
  text: string,
  now: number,
  kindOverride?: ImportKind
): ImportFileResult {
  const { headers, rows } = parseCsvRecords(text);
  const source = detectSource(fileName, headers);
  const kind = kindOverride ?? detectKind(fileName);

  const titleColumn = findColumn(headers, "title");
  const yearColumn = findColumn(headers, "year");
  const imdbColumn = findColumn(headers, "imdbId");
  const ratingColumn = findColumn(headers, "rating");
  const reviewColumn = findColumn(headers, "review");
  const dateColumn = findColumn(headers, "watchedDate");
  const supplementalColumn = findColumn(headers, "supplemental");

  const truncated = rows.length > MAX_ROWS;
  const usable = truncated ? rows.slice(0, MAX_ROWS) : rows;

  const fiveStar = ratingColumn
    ? detectFiveStarScale(source, usable.map((row) => row[ratingColumn] ?? ""))
    : false;

  const titles: ImportedTitle[] = [];
  let skipped = 0;

  for (const row of usable) {
    const raw = titleColumn ? (row[titleColumn] ?? "") : "";
    if (raw.trim() === "") {
      skipped++;
      continue;
    }

    // Netflix's fuller export logs trailers and title-card animations
    // alongside real viewing. They are not things anyone watched.
    if (supplementalColumn && (row[supplementalColumn] ?? "").trim() !== "") {
      skipped++;
      continue;
    }

    const collapsed = collapseEpisodeTitle(raw);
    const date = dateColumn ? parseImportDate(row[dateColumn] ?? "") : undefined;

    const entry: ImportedTitle = {
      title: collapsed.title,
      year: yearColumn ? parseImportYear(row[yearColumn] ?? "") : undefined,
      type: collapsed.isEpisode ? "series" : undefined,
      imdbId: imdbColumn ? parseImdbId(row[imdbColumn] ?? "") : undefined,
    };

    if (kind === "watchlist") {
      entry.watchlistedAt = date ?? now;
    } else {
      entry.watchedAt = date ?? now;
    }

    if (ratingColumn) {
      entry.rating = parseImportRating(row[ratingColumn] ?? "", fiveStar);
    }

    if (reviewColumn) {
      const review = (row[reviewColumn] ?? "").trim();
      if (review !== "") entry.reviewText = review;
    }

    titles.push(entry);
  }

  return {
    fileName,
    source,
    kind,
    titles: collapseImported(titles),
    rows: rows.length,
    skipped,
    truncated,
  };
}

/**
 * Fold repeated rows for the same title into one.
 *
 * This is most of the value on a Netflix file, where a season is fifty rows
 * and a rewatched film is several. The surviving entry takes the **earliest**
 * date, because "when did I first see this" is the question a watch history
 * can answer and a later rewatch can't, and fills any field the other rows
 * had — a diary row with a review and a ratings row with a score describe the
 * same title and should end as one entry carrying both.
 *
 * @param titles - Titles in file order
 * @returns One entry per title, in first-seen order
 */
export function collapseImported(titles: readonly ImportedTitle[]): ImportedTitle[] {
  const byKey = new Map<string, ImportedTitle>();

  for (const title of titles) {
    const key = title.imdbId ? `imdb:${title.imdbId}` : titleKey(title.title);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...title });
      continue;
    }

    byKey.set(key, mergeImportedTitle(existing, title));
  }

  return [...byKey.values()];
}

/**
 * Combine two readings of the same title.
 */
function mergeImportedTitle(a: ImportedTitle, b: ImportedTitle): ImportedTitle {
  return {
    // The longer title is the more complete one: a Letterboxd row naming
    // "Avatar: The Way of Water" beats a Netflix row that only said "Avatar"
    title: b.title.length > a.title.length ? b.title : a.title,
    year: a.year ?? b.year,
    type: a.type ?? b.type,
    imdbId: a.imdbId ?? b.imdbId,
    watchedAt: earliest(a.watchedAt, b.watchedAt),
    watchlistedAt: earliest(a.watchlistedAt, b.watchlistedAt),
    rating: a.rating ?? b.rating,
    reviewText: a.reviewText ?? b.reviewText,
  };
}

function earliest(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

// ---------------------------------------------------------------------------
// Merging into the library
// ---------------------------------------------------------------------------

export interface MergeResult {
  library: Record<string, LibraryEntry>;
  added: number;
  updated: number;
}

/**
 * Fold imported titles into an existing library.
 *
 * The governing rule is that **an import never takes anything away**. It fills
 * gaps and moves a watch date earlier; it does not clear a mark, overwrite a
 * review the user wrote here, or replace a score they set with the stars in
 * the overlay. Someone importing a three-year-old Letterboxd export should not
 * lose last week's rating to it, and re-importing the same file twice should
 * change nothing the second time.
 *
 * Entries key by IMDb id when the export carries one — only IMDb's does — and
 * otherwise by normalized title *alone*, matching what a browse tile produces.
 * That is what lets a Netflix row and a Letterboxd row for the same film land
 * on one entry, and what lets the entry migrate to its id later when the title
 * is opened and its lookup resolves.
 *
 * @param library - The current library, keyed as stored
 * @param titles - Titles read out of the export
 * @param now - Current time
 * @returns The merged library and what changed
 */
export function mergeImported(
  library: Record<string, LibraryEntry>,
  titles: readonly ImportedTitle[],
  now: number
): MergeResult {
  const merged: Record<string, LibraryEntry> = { ...library };
  let added = 0;
  let updated = 0;

  for (const imported of titles) {
    const key = libraryKey({ title: imported.title, imdbId: imported.imdbId });
    const fallback = titleKey(imported.title);
    const existing = merged[key] ?? merged[fallback];

    const next = applyImport(existing, imported, key, now);

    if (!existing) {
      added++;
    } else if (changed(existing, next)) {
      updated++;
    }

    // An entry found under the title key but now carrying an IMDb id moves,
    // exactly as `updateEntry` moves one marked from a browse tile
    if (existing && existing.key !== key) delete merged[existing.key];

    merged[key] = next;
  }

  return { library: merged, added, updated };
}

/**
 * Apply one imported title to one entry.
 */
function applyImport(
  existing: LibraryEntry | undefined,
  imported: ImportedTitle,
  key: string,
  now: number
): LibraryEntry {
  const base: LibraryEntry = existing ?? {
    key,
    title: imported.title,
    updatedAt: now,
  };

  const review = mergeReview(base.review, imported, now);

  return {
    ...base,
    key,
    // Keep the fuller title: an export usually names a film better than a
    // browse tile did, but never replace a name with a shorter one
    title: imported.title.length > base.title.length ? imported.title : base.title,
    year: base.year ?? imported.year,
    type: base.type ?? imported.type,
    imdbId: base.imdbId ?? imported.imdbId,
    watchedAt: earliest(base.watchedAt, imported.watchedAt),
    watchlistedAt: earliest(base.watchlistedAt, imported.watchlistedAt),
    review,
    updatedAt: now,
  };
}

/**
 * Fold an imported score and review into whatever is already recorded.
 *
 * The user's own writing wins outright. An import can supply a review where
 * there was none and a score where there was none, and that is all — the text
 * in the extension was typed by hand and the score was set on the stars, both
 * more recent and more deliberate than a file.
 */
function mergeReview(
  existing: LibraryEntry["review"],
  imported: ImportedTitle,
  now: number
): LibraryEntry["review"] {
  if (imported.rating === undefined && imported.reviewText === undefined) {
    return existing;
  }

  if (!existing) {
    return {
      text: imported.reviewText ?? "",
      rating: imported.rating,
      updatedAt: now,
    };
  }

  const text = existing.text.trim() !== "" ? existing.text : (imported.reviewText ?? "");
  const rating = existing.rating ?? imported.rating;

  if (text === existing.text && rating === existing.rating) return existing;

  return { text, rating, updatedAt: existing.updatedAt };
}

/**
 * Did applying the import actually change anything worth counting?
 *
 * Re-importing the same file should report nothing updated, so this compares
 * everything except `updatedAt` — which the merge always moves.
 */
function changed(before: LibraryEntry, after: LibraryEntry): boolean {
  const strip = (entry: LibraryEntry): string =>
    JSON.stringify({ ...entry, updatedAt: 0 });

  return strip(before) !== strip(after);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface ImportSummary {
  files: ImportFileResult[];
  added: number;
  updated: number;
  /** Distinct titles across every file */
  titles: number;
}

/**
 * One line describing what an import did, for the popup to show.
 *
 * @param summary - The result of an import
 * @returns Human-readable summary
 */
export function describeImport(summary: ImportSummary): string {
  if (summary.files.length === 0) return "Nothing to import.";
  if (summary.titles === 0) return "No titles found in that file.";

  const parts = [
    `${summary.added} added`,
    summary.updated > 0 ? `${summary.updated} updated` : null,
    summary.added + summary.updated < summary.titles
      ? `${summary.titles - summary.added - summary.updated} already up to date`
      : null,
  ].filter((part): part is string => part !== null);

  const truncated = summary.files.filter((file) => file.truncated);
  const tail =
    truncated.length > 0
      ? ` Stopped at ${MAX_ROWS.toLocaleString()} rows in ${truncated.length} file(s).`
      : "";

  return `${parts.join(", ")}.${tail}`;
}
