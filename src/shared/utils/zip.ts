/**
 * ZIP Reading
 *
 * Just enough of the ZIP format to get the CSVs out of a Letterboxd export.
 *
 * There is no dependency here because there doesn't need to be: Chrome ships
 * `DecompressionStream("deflate-raw")`, which is the only hard part of the
 * format, and the rest is reading a few little-endian integers off the end of
 * the file. A ZIP library would be tens of kilobytes in a bundle that gets
 * injected into every Netflix page, to do what a hundred lines does here.
 *
 * The alternative — telling people to unzip the download and upload four
 * particular files out of it — is the kind of instruction that turns a feature
 * into a support question. Handing over the file you were given should work.
 *
 * ## What this does not do
 *
 * Zip64 (archives past 4GB or 65,535 entries), encryption, and multi-disk
 * archives are all rejected rather than mishandled. A data export is a handful
 * of small text files; anything that needs those is not one, and reading it
 * wrongly would be worse than declining it.
 */

/** One file inside an archive. */
export interface ZipEntry {
  name: string;
  /** Uncompressed contents */
  data: Uint8Array;
}

/** Signatures, little-endian, as they appear in the file. */
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** The end-of-central-directory record is 22 bytes plus a comment. */
const EOCD_MIN_SIZE = 22;
/** The comment length field is 16 bits, so the record starts within this. */
const EOCD_MAX_SEARCH = EOCD_MIN_SIZE + 0xffff;

/**
 * Is this buffer a ZIP archive?
 *
 * Checked by signature rather than by file extension, because the thing that
 * matters is what was uploaded, not what it was called.
 *
 * @param buffer - The uploaded file
 * @returns True when it starts with a local file header
 */
export function isZip(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 4) return false;
  return new DataView(buffer).getUint32(0, true) === LOCAL_FILE_HEADER;
}

/**
 * Read every file out of an archive.
 *
 * @param buffer - The archive
 * @returns Its entries, directories omitted
 * @throws When the archive is malformed or uses a feature this doesn't support
 */
export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const directory = findCentralDirectory(view);

  const entries: ZipEntry[] = [];
  let offset = directory.offset;

  for (let index = 0; index < directory.count; index++) {
    if (offset + 46 > view.byteLength) {
      throw new Error("Archive ends inside its own index");
    }
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new Error("Archive index is not where it says it is");
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength));

    // Bit 0 is the encryption flag. An encrypted entry can't be read, and
    // returning its ciphertext as text would be far more confusing than saying so.
    if ((flags & 0x1) !== 0) throw new Error(`"${name}" is encrypted`);

    offset += 46 + nameLength + extraLength + commentLength;

    // Directories are stored as zero-length entries ending in a slash
    if (name.endsWith("/")) continue;

    entries.push({
      name,
      data: await readEntry(view, bytes, localOffset, method, compressedSize, name),
    });
  }

  return entries;
}

/**
 * Locate the index at the end of the archive.
 *
 * It is searched for backwards because its own length depends on a trailing
 * comment of arbitrary size — there is no way to seek to it directly, which is
 * a quirk of the format rather than of this code.
 */
function findCentralDirectory(view: DataView): { offset: number; count: number } {
  const limit = Math.min(view.byteLength, EOCD_MAX_SEARCH);

  for (let back = EOCD_MIN_SIZE; back <= limit; back++) {
    const position = view.byteLength - back;
    if (view.getUint32(position, true) !== END_OF_CENTRAL_DIRECTORY) continue;

    const count = view.getUint16(position + 10, true);
    const offset = view.getUint32(position + 16, true);

    // Zip64 archives park 0xffff/0xffffffff here and put the real values in a
    // separate record. Reading the placeholders as real numbers would send us
    // to offset 4294967295.
    if (count === 0xffff || offset === 0xffffffff) {
      throw new Error("Zip64 archives are not supported");
    }

    return { offset, count };
  }

  throw new Error("Not a ZIP archive");
}

/**
 * Read and decompress one entry's data.
 *
 * The size and name come from the central directory rather than from the local
 * header: the local header is allowed to leave them as zero and defer them to
 * a trailing descriptor, which the directory never does.
 */
async function readEntry(
  view: DataView,
  bytes: Uint8Array,
  localOffset: number,
  method: number,
  compressedSize: number,
  name: string
): Promise<Uint8Array> {
  if (localOffset + 30 > view.byteLength) {
    throw new Error(`"${name}" points past the end of the archive`);
  }
  if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) {
    throw new Error(`"${name}" is not where the index says it is`);
  }

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const end = start + compressedSize;

  if (end > bytes.byteLength) throw new Error(`"${name}" is truncated`);

  const compressed = bytes.subarray(start, end);

  // 0 is stored, 8 is deflate. Everything else is a compression method no
  // export tool produces and the browser can't undo.
  if (method === 0) return compressed.slice();
  if (method !== 8) throw new Error(`"${name}" uses an unsupported compression method`);

  return inflateRaw(compressed);
}

/**
 * Undo a raw deflate stream using the browser's own decompressor.
 */
async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));

  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode an entry name.
 *
 * Always UTF-8: it is what every modern archiver writes, and the legacy
 * alternative (CP437) differs only for names outside ASCII, which the files in
 * a data export do not have.
 */
function decodeName(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Read an entry as text.
 *
 * @param entry - The entry
 * @returns Its contents decoded as UTF-8
 */
export function entryText(entry: ZipEntry): string {
  return new TextDecoder("utf-8").decode(entry.data);
}
