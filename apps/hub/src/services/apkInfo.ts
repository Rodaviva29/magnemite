import fs from "node:fs/promises";
import zlib from "node:zlib";

/**
 * What an APK says about itself.
 *
 * An operator uploading a build already has the answer in their hands — the
 * package name and version are inside the file — so asking them to type it
 * again is asking them to make a mistake. This reads it instead.
 *
 * Two formats stand between us and those three strings:
 *
 *   the zip     an APK is one, and an .apkm/.xapk is a zip of APKs
 *   AXML        AndroidManifest.xml is not text but Android's binary XML
 *
 * Neither needs a general-purpose implementation. We want exactly three
 * attributes off the first element, so this reads the zip's central directory
 * for one entry and walks the AXML far enough to find them.
 */

export type ApkInfo = {
  packageName: string | null;
  versionName: string | null;
  versionCode: string | null;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

type ZipEntry = { name: string; compression: number; offset: number; size: number };

/**
 * List a zip's entries.
 *
 * The end-of-central-directory record is at the tail, after a comment of up to
 * 64 KB, so the search starts from the end of the file rather than parsing
 * forwards through hundreds of megabytes of APK.
 */
function readCentralDirectory(buffer: Buffer): ZipEntry[] {
  const maxComment = 0xffff;
  const start = Math.max(0, buffer.length - maxComment - 22);

  let eocd = -1;
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.push({ name, compression, offset: localOffset, size: compressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Pull one entry out, following its local header to the data. */
function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (buffer.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE) {
    throw new Error(`${entry.name}: bad local header`);
  }
  // The local header repeats the name and carries its own extra field, whose
  // length differs from the central one often enough to matter.
  const nameLength = buffer.readUInt16LE(entry.offset + 26);
  const extraLength = buffer.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.size);

  if (entry.compression === 0) return data;
  if (entry.compression === 8) return zlib.inflateRawSync(data);
  throw new Error(`${entry.name}: unsupported compression ${entry.compression}`);
}

// --- AXML -------------------------------------------------------------------

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_RESOURCE_MAP = 0x0180;
const CHUNK_START_ELEMENT = 0x0102;
const UTF8_FLAG = 1 << 8;

/**
 * Attribute ids from Android's own resource table.
 *
 * A compiled manifest often leaves the name of a framework attribute out of
 * the string pool and identifies it by id instead, through the resource map
 * chunk. Only these two are needed here.
 */
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;

/**
 * The string pool every other chunk indexes into.
 *
 * Strings are either UTF-16 (the original format) or UTF-8 (since Android 4),
 * flagged in the header — and the UTF-8 form writes two lengths, in characters
 * and then in bytes, which is the part everyone gets wrong.
 */
function readStringPool(chunk: Buffer): string[] {
  const count = chunk.readUInt32LE(8);
  const flags = chunk.readUInt32LE(16);
  const stringsStart = chunk.readUInt32LE(20);
  const utf8 = (flags & UTF8_FLAG) !== 0;

  const strings: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = stringsStart + chunk.readUInt32LE(28 + i * 4);
    if (offset >= chunk.length) {
      strings.push("");
      continue;
    }

    if (utf8) {
      // Lengths above 0x7f take two bytes, high bit set on the first.
      let cursor = offset;
      const skip = (chunk[cursor]! & 0x80) !== 0 ? 2 : 1;
      cursor += skip; // characters, which we do not need
      const byteLength =
        (chunk[cursor]! & 0x80) !== 0
          ? ((chunk[cursor]! & 0x7f) << 8) | chunk[cursor + 1]!
          : chunk[cursor]!;
      cursor += (chunk[cursor]! & 0x80) !== 0 ? 2 : 1;
      strings.push(chunk.toString("utf8", cursor, cursor + byteLength));
    } else {
      const length = chunk.readUInt16LE(offset);
      strings.push(chunk.toString("utf16le", offset + 2, offset + 2 + length * 2));
    }
  }
  return strings;
}

/** Value types, of which only these three ever appear on what we read. */
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;

/**
 * Read `package`, `versionName` and `versionCode` off the manifest element.
 *
 * Only the first start element is needed — `<manifest>` — so the walk stops
 * there rather than building a tree nobody asked for.
 */
function parseManifest(axml: Buffer): ApkInfo {
  const info: ApkInfo = { packageName: null, versionName: null, versionCode: null };

  let strings: string[] = [];
  let resourceIds: number[] = [];
  let offset = 8; // past the file header

  while (offset + 8 <= axml.length) {
    const type = axml.readUInt16LE(offset);
    const size = axml.readUInt32LE(offset + 4);
    if (size <= 0 || offset + size > axml.length) break;

    const chunk = axml.subarray(offset, offset + size);

    if (type === CHUNK_STRING_POOL) {
      strings = readStringPool(chunk);
    } else if (type === CHUNK_RESOURCE_MAP) {
      // One resource id per string-pool index, in order.
      resourceIds = [];
      for (let i = 8; i + 4 <= chunk.length; i += 4) resourceIds.push(chunk.readUInt32LE(i));
    } else if (type === CHUNK_START_ELEMENT) {
      // A start element is the 8-byte chunk header, then lineNumber and
      // comment, and only then the attribute block this reads — hence 16.
      const attributeStart = chunk.readUInt16LE(24);
      const attributeSize = chunk.readUInt16LE(26);
      const attributeCount = chunk.readUInt16LE(28);
      const base = 16 + attributeStart;

      for (let i = 0; i < attributeCount; i += 1) {
        const at = base + i * attributeSize;
        if (at + 20 > chunk.length) break;

        const nameIndex = chunk.readUInt32LE(at + 4);
        const rawValue = chunk.readInt32LE(at + 8);
        const valueType = chunk.readUInt8(at + 15);
        const data = chunk.readUInt32LE(at + 16);

        const name = strings[nameIndex] ?? "";
        const resourceId = resourceIds[nameIndex] ?? 0;

        let value: string | null = null;
        if (valueType === TYPE_STRING) value = strings[rawValue] ?? null;
        else if (valueType === TYPE_INT_DEC || valueType === TYPE_INT_HEX) value = String(data);

        // By name where the pool has one, by resource id where it does not.
        if (name === "package") info.packageName = value;
        else if (name === "versionName" || resourceId === ATTR_VERSION_NAME) {
          info.versionName = value;
        } else if (name === "versionCode" || resourceId === ATTR_VERSION_CODE) {
          info.versionCode = value;
        }
      }

      // <manifest> is the first element; everything after it is application
      // detail we have no use for.
      return info;
    }

    offset += size;
  }

  return info;
}

/** The entry to read, preferring the base split of a multi-APK bundle. */
function pickManifestSource(entries: ZipEntry[]): { manifest?: ZipEntry; apk?: ZipEntry } {
  const manifest = entries.find((e) => e.name === "AndroidManifest.xml");
  if (manifest) return { manifest };

  const apks = entries.filter((e) => e.name.toLowerCase().endsWith(".apk"));
  const base =
    apks.find((e) => /(^|\/)base\.apk$/i.test(e.name)) ??
    // Split names carry a config suffix; anything without one is the base.
    apks.find((e) => !/split_|config\./i.test(e.name)) ??
    apks[0];
  return { apk: base };
}

/**
 * Read what an APK or bundle says about itself. Never throws: a file we cannot
 * make sense of is one the operator labels by hand, which is what they did
 * before this existed.
 */
export async function readApkInfo(filePath: string): Promise<ApkInfo> {
  const empty: ApkInfo = { packageName: null, versionName: null, versionCode: null };

  try {
    const buffer = await fs.readFile(filePath);
    const entries = readCentralDirectory(buffer);
    const { manifest, apk } = pickManifestSource(entries);

    if (manifest) return parseManifest(readEntry(buffer, manifest));
    if (!apk) return empty;

    // A bundle: the manifest is inside the base split.
    const inner = readEntry(buffer, apk);
    const innerManifest = readCentralDirectory(inner).find((e) => e.name === "AndroidManifest.xml");
    if (!innerManifest) return empty;
    return parseManifest(readEntry(inner, innerManifest));
  } catch {
    return empty;
  }
}
