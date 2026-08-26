import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/**
 * A one-entry zip writer, stored (uncompressed).
 *
 * It exists for exactly one job: the agent only ever installs `.apkm`
 * bundles — a zip of `base.apk` plus the ABI, density and language splits —
 * and a manually uploaded `.apk` is not that. Rather than teach the agent a
 * second install path (and roll a new agent to every box to get it), the hub
 * wraps the single APK in a bundle with one entry, `base.apk`, which the
 * agent's existing selector classifies as the base split and installs alone.
 *
 * Stored rather than deflated on purpose: an APK is already a compressed
 * archive, so deflating it again costs CPU on the VPS and saves nothing.
 * There is no zip64 support here — an APK over 4 GB is not a thing.
 */
export async function wrapAsBundle(
  sourcePath: string,
  destPath: string,
  entryName = "base.apk",
): Promise<void> {
  const { size } = await fs.stat(sourcePath);
  if (size >= 0xffffffff) throw new Error("file is too large to wrap into a zip");

  const crc = await crc32File(sourcePath);
  const name = Buffer.from(entryName, "utf8");
  const { time, date } = dosTimestamp(new Date());

  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed to extract (2.0)
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18); // compressed size
  local.writeUInt32LE(size, 22); // uncompressed size
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra field length
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); // central directory header signature
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8); // flags
  central.writeUInt16LE(0, 10); // method: stored
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30); // extra
  central.writeUInt16LE(0, 32); // comment
  central.writeUInt16LE(0, 34); // disk number start
  central.writeUInt16LE(0, 36); // internal attributes
  central.writeUInt32LE(0, 38); // external attributes
  central.writeUInt32LE(0, 42); // offset of local header
  name.copy(central, 46);

  const centralOffset = local.length + size;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(1, 8); // entries on this disk
  end.writeUInt16LE(1, 10); // entries total
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20); // comment length

  const out = createWriteStream(destPath);
  const written = new Promise<void>((resolve, reject) => {
    out.on("error", reject);
    out.on("close", resolve);
  });

  out.write(local);
  await pipeline(createReadStream(sourcePath), out, { end: false });
  out.write(central);
  out.end(end);
  await written;
}

async function crc32File(filePath: string): Promise<number> {
  let checksum = 0;
  for await (const chunk of createReadStream(filePath)) {
    checksum = zlib.crc32(chunk as Buffer, checksum);
  }
  // crc32 returns a signed-safe number already, but the header field is
  // unsigned and Buffer.writeUInt32LE rejects a negative.
  return checksum >>> 0;
}

/** Zip stores mtime as the DOS pair MS-DOS used in 1980. */
function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
