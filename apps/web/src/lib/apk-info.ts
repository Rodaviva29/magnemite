import {
  EMPTY_APK_INFO,
  readApkInfo as readApkInfoFrom,
  type ApkInfo,
  type ByteReader,
} from "@magnemite/apk";

export type { ApkInfo };

/**
 * Raw DEFLATE in the browser.
 *
 * `DecompressionStream` is the only way to do this without shipping an inflate
 * implementation, and it has been in every current engine for a while. Where
 * it is missing the caller simply gets nothing back, which is the same answer
 * as an unreadable file.
 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read an APK's own package name and version, in the browser, before it is
 * uploaded.
 *
 * The point is that the operator sees which build they picked without waiting
 * out a few hundred megabytes to find out — the commonest mistake on this page
 * is choosing the wrong file from a folder of near-identical names. It runs the
 * same parser the hub runs on the uploaded file, so what is shown here is what
 * gets stored.
 *
 * Only slices are read: the zip's tail for its directory, then the one entry
 * holding the manifest. A 250 MB bundle costs a few kilobytes.
 */
export async function readApkInfoFromFile(file: File): Promise<ApkInfo> {
  if (typeof DecompressionStream === "undefined") return EMPTY_APK_INFO;

  const reader: ByteReader = {
    size: file.size,
    read: async (start, length) => {
      const end = Math.min(file.size, start + length);
      if (end <= start) return new Uint8Array(0);
      return new Uint8Array(await file.slice(start, end).arrayBuffer());
    },
  };

  try {
    return await readApkInfoFrom(reader, inflateRaw);
  } catch {
    return EMPTY_APK_INFO;
  }
}
