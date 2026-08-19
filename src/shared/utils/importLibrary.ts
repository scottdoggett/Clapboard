/**
 * Import Orchestration
 *
 * Takes the files someone dropped on the popup and puts them in the library.
 *
 * The parsing decisions all live in `importParse.ts` where they can be tested;
 * this is the part that can't be — reading files, unzipping, and the single
 * read-modify-write against `chrome.storage`.
 *
 * That storage write being *single* is the point. A Netflix history is tens of
 * thousands of rows, and routing each one through `updateEntry` would be tens
 * of thousands of round trips to storage to build one object. The whole import
 * is folded in memory and written once.
 *
 * **Nothing here performs a lookup.** An import of 4,000 titles would be 4,000
 * OMDb resolutions against a 1,000-a-day quota, so imported entries are stored
 * keyed by title exactly as a browse tile's are, and resolve the first time
 * the user actually opens one.
 */

import { readLibraryMap, writeLibraryMap } from "@shared/utils/library";
import {
  collapseImported,
  mergeImported,
  parseImportFile,
  type ImportedTitle,
  type ImportFileResult,
  type ImportKind,
  type ImportSummary,
} from "@shared/utils/importParse";
import { entryText, isZip, readZip } from "@shared/utils/zip";

/** A file to import, as the popup has it. */
export interface ImportInput {
  name: string;
  /** Raw bytes, so a ZIP and a CSV can be told apart by signature */
  buffer: ArrayBuffer;
}

/**
 * Read a set of uploaded files into the library.
 *
 * @param inputs - The uploaded files
 * @param kindOverride - What the rows mean, when the user has said
 * @returns What each file yielded and what changed overall
 */
export async function importFiles(
  inputs: readonly ImportInput[],
  kindOverride?: ImportKind
): Promise<ImportSummary> {
  const now = Date.now();
  const files: ImportFileResult[] = [];

  for (const input of inputs) {
    files.push(...(await readInput(input, now, kindOverride)));
  }

  // Collapsed across files as well as within them: a Letterboxd export is
  // four files describing one set of films, and `watched.csv` plus
  // `ratings.csv` plus `reviews.csv` should end as one entry each, not three
  const titles = collapseImported(files.flatMap((file) => file.titles));

  const library = await readLibraryMap();
  const merged = mergeImported(library, titles, now);
  await writeLibraryMap(merged.library);

  return {
    files,
    added: merged.added,
    updated: merged.updated,
    titles: titles.length,
  };
}

/**
 * Read one uploaded file, unpacking it first when it is an archive.
 *
 * A Letterboxd export arrives as a ZIP of five CSVs, and each one has to keep
 * its own name — `watchlist.csv` and `watched.csv` have identical columns and
 * only their names say which is which.
 */
async function readInput(
  input: ImportInput,
  now: number,
  kindOverride?: ImportKind
): Promise<ImportFileResult[]> {
  if (!isZip(input.buffer)) {
    const text = new TextDecoder("utf-8").decode(input.buffer);
    return [parseImportFile(input.name, text, now, kindOverride)];
  }

  const entries = await readZip(input.buffer);

  return entries
    .filter((entry) => /\.csv$/i.test(entry.name))
    // A ZIP path is `letterboxd-user-2026/watched.csv`; the leaf is the part
    // that identifies the list
    .map((entry) =>
      parseImportFile(leafName(entry.name), entryText(entry), now, kindOverride)
    )
    .filter((file) => file.titles.length > 0 || file.rows > 0);
}

function leafName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Read a `File` from an `<input type="file">` into an import input.
 *
 * @param file - The uploaded file
 * @returns Its name and bytes
 */
export async function toImportInput(file: File): Promise<ImportInput> {
  return { name: file.name, buffer: await file.arrayBuffer() };
}

export type { ImportedTitle, ImportSummary };
