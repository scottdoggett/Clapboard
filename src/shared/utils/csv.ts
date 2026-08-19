/**
 * CSV Reading
 *
 * A small RFC 4180 reader, for the export files people bring in from Netflix,
 * Letterboxd and IMDb.
 *
 * It is written out rather than pulled in because the alternative — splitting
 * on commas — breaks on the very first row of a real export. Film titles
 * contain commas ("Kill Bill: Vol. 1, The"), Letterboxd reviews contain commas
 * *and* newlines *and* quotes, and every one of those is legal inside a quoted
 * field. A parser that handles quoting is about forty lines; a parser that
 * doesn't silently mangles someone's viewing history.
 *
 * Three details come from real files rather than from the spec:
 *
 * - **A leading BOM.** Excel writes one, and anyone who opened their export to
 *   look at it before uploading it has re-saved it through Excel. Left in
 *   place it prefixes the first header with U+FEFF, which then matches nothing.
 * - **CRLF.** Netflix's file uses it; so does anything round-tripped through
 *   Windows.
 * - **Ragged rows.** A row with fewer cells than the header is common at the
 *   end of a truncated download. It is read as far as it goes rather than
 *   discarded.
 */

/**
 * Split CSV text into rows of raw cells.
 *
 * @param text - The file's contents
 * @returns One array of cells per row, in file order
 */
export function parseCsv(text: string): string[][] {
  // Strip a byte-order mark before anything else looks at the first character
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
  };

  const endRow = (): void => {
    endCell();
    // A trailing newline would otherwise produce a final row of one empty cell
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote
        if (source[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index++;
        continue;
      }

      cell += char;
      index++;
      continue;
    }

    // A quote opens a field only at its start. Exports that pad after the
    // comma ("a", "b") still count as a start — the padding is not data.
    if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
      index++;
      continue;
    }

    if (char === ",") {
      endCell();
      index++;
      continue;
    }

    if (char === "\r" || char === "\n") {
      endRow();
      // Consume CRLF as one line ending, not two
      index += char === "\r" && source[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    cell += char;
    index++;
  }

  // Whatever is left when the text runs out is the last row, unless the file
  // ended on a newline and there is nothing pending
  if (cell !== "" || row.length > 0) endRow();

  return rows;
}

/**
 * Read CSV text as records keyed by header name.
 *
 * Header-keyed rather than positional on purpose: these files come from four
 * different services and none of them agree on column order, while their
 * *names* are stable enough to match on.
 *
 * @param text - The file's contents
 * @returns The normalized header names and one record per data row
 */
export function parseCsvRecords(text: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], rows: [] };

  // Case and spacing differ between exports ("Watched Date" / "watched_date"),
  // so headers are matched in a normalized form throughout
  const headers = rows[0].map(normalizeHeader);

  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};

    headers.forEach((header, position) => {
      if (header === "") return;
      record[header] = (cells[position] ?? "").trim();
    });

    return record;
  });

  return { headers, rows: records };
}

/**
 * Reduce a header to a form the column matcher can compare.
 *
 * "Watched Date", "watched_date" and "WatchedDate" all become "watched date" —
 * near enough that one synonym list covers every export we support.
 *
 * A byte-order mark is not handled here: `parseCsv` strips it from the file
 * before any cell is read, and a second strip in this function only made the
 * first one impossible to test.
 *
 * @param header - The raw header cell
 * @returns Lowercased, single-spaced header
 */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}
