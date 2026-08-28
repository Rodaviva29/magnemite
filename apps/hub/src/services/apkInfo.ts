import fs from "node:fs/promises";
import zlib from "node:zlib";
import {
  EMPTY_APK_INFO,
  readApkInfo as readApkInfoFrom,
  type ApkInfo,
  type ByteReader,
} from "@magnemite/apk";

export type { ApkInfo };

/**
 * The parser itself lives in `@magnemite/apk`, because the dashboard runs the
 * same one: it reads the version out of the file in the browser so the
 * operator sees which build they picked before spending a few hundred
 * megabytes of upload finding out. Only the two host-specific pieces — how to
 * read bytes, and how to inflate — are here.
 */
const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(zlib.inflateRawSync(data));

/**
 * Reads through the open handle rather than slurping the file.
 *
 * A bundle is a few hundred megabytes and we want three strings out of the
 * tail and one small entry, so holding the whole thing would be the most
 * expensive part of an upload by a wide margin.
 */
async function fileReader(
  filePath: string,
): Promise<{ reader: ByteReader; close: () => Promise<void> }> {
  const handle = await fs.open(filePath, "r");
  const { size } = await handle.stat();

  return {
    reader: {
      size,
      read: async (start, length) => {
        const clamped = Math.max(0, Math.min(length, size - start));
        const buffer = Buffer.alloc(clamped);
        if (clamped === 0) return new Uint8Array(0);
        const { bytesRead } = await handle.read(buffer, 0, clamped, start);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
      },
    },
    close: () => handle.close(),
  };
}

/**
 * Read what an APK or bundle says about itself. Never throws: a file we cannot
 * make sense of is one the operator deals with by hand.
 */
export async function readApkInfo(filePath: string): Promise<ApkInfo> {
  let opened: Awaited<ReturnType<typeof fileReader>> | null = null;
  try {
    opened = await fileReader(filePath);
    return await readApkInfoFrom(opened.reader, inflateRaw);
  } catch {
    return EMPTY_APK_INFO;
  } finally {
    await opened?.close().catch(() => undefined);
  }
}
