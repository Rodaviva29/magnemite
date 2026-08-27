import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@magnemite/db";
import { bus } from "../bus.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { artifactFilename, ensureArtifactDir } from "./artifacts.js";
import { wrapAsBundle } from "./zip.js";

/**
 * Manual installs: an operator hands us an APK for some app on the boxes —
 * the scanner, a launcher, anything — instead of waiting for a watched source
 * to publish one.
 *
 * The upload lands here as a raw stream and comes out the far side as an
 * ordinary `AppVersion` in `READY`, which means every part downstream — the
 * scheduler, the agent, the rollout pages, retries — treats it exactly like a
 * version discovered on a source. The only thing that marks it out is
 * `source = MANUAL` and its target's `manual` flag.
 */

/** Refuse absurd uploads early: the biggest real bundle is ~250 MB. */
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

export type UploadInput = {
  stream: Readable;
  /** Name the browser sent, used only to decide whether to wrap it. */
  filename: string;
  packageName: string;
  /** What the operator calls this build, e.g. "1.4.2" or "2026-08-26 hotfix". */
  version: string;
  displayName?: string | null;
  arch?: string | null;
  note?: string | null;
  uploadedById?: string | null;
};

export type UploadResult = {
  appVersionId: string;
  appTargetId: string;
  packageName: string;
  version: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  wrapped: boolean;
};

/**
 * A version label is whatever the operator typed — "1.4.2", but also
 * "2026-08-26 hotfix". The label is kept as-is in the database; this is what
 * goes in the filename, which becomes a URL the boxes fetch.
 */
function slug(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "build"
  );
}

/**
 * Bare `.apk` files are wrapped into a one-entry bundle; anything that is
 * already a multi-APK archive is stored as it arrived.
 */
function needsWrapping(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".apk";
}

export async function storeUpload(input: UploadInput): Promise<UploadResult> {
  const packageName = input.packageName.trim();
  const version = input.version.trim();

  if (!PACKAGE_NAME.test(packageName)) {
    throw new Error(`"${packageName}" is not an Android package name`);
  }
  if (!version) throw new Error("a version label is required");

  const arch = (input.arch ?? "").trim() || "arm64-v8a";
  const wrapped = needsWrapping(input.filename);

  await ensureArtifactDir();
  const stamp = Date.now().toString(36);
  const incoming = path.join(env.ARTIFACT_DIR, `upload-${stamp}.part`);

  // --- receive ------------------------------------------------------------
  let received = 0;
  try {
    input.stream.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) input.stream.destroy(new Error("upload is too large"));
    });
    await pipeline(input.stream, createWriteStream(incoming));
  } catch (err) {
    await fs.rm(incoming, { force: true });
    throw err;
  }

  if (received === 0) {
    await fs.rm(incoming, { force: true });
    throw new Error("the upload was empty");
  }

  // --- shape it like every other artifact ---------------------------------
  const filename = artifactFilename(packageName, slug(version), arch, "manual");
  const finalPath = path.join(env.ARTIFACT_DIR, filename);

  try {
    if (wrapped) {
      await wrapAsBundle(incoming, finalPath);
      await fs.rm(incoming, { force: true });
    } else {
      await fs.rename(incoming, finalPath);
    }

    const sha256 = await sha256File(finalPath);
    const { size } = await fs.stat(finalPath);

    // --- record it ---------------------------------------------------------
    const target = await prisma.appTarget.upsert({
      where: { packageName },
      update: {},
      create: {
        packageName,
        displayName: input.displayName?.trim() || packageName.split(".").pop() || packageName,
        manual: true,
        arch,
        // Nothing polls a manual target and nothing auto-updates it; uploads
        // are approved on arrival because a human just chose the file.
        enabled: true,
        autoApprove: true,
      },
    });

    // Re-uploading the same label replaces the artifact rather than failing on
    // the unique constraint — the operator fixing a bad build expects that.
    const appVersion = await prisma.appVersion.upsert({
      where: {
        appTargetId_version_arch: { appTargetId: target.id, version, arch },
      },
      update: {
        filename,
        artifactPath: finalPath,
        sizeBytes: BigInt(size),
        sha256,
        status: "READY",
        cacheProgress: 100,
        error: null,
        approved: true,
        publishedAt: new Date(),
      },
      create: {
        appTargetId: target.id,
        version,
        source: "MANUAL",
        arch,
        // There is no upstream to re-fetch from: the artifact is the upload.
        remoteUrl: "",
        filename,
        artifactPath: finalPath,
        sizeBytes: BigInt(size),
        sha256,
        status: "READY",
        cacheProgress: 100,
        approved: true,
        publishedAt: new Date(),
      },
    });

    bus.publish({ kind: "version", versionId: appVersion.id });
    log.info(
      { packageName, version, sizeBytes: size, wrapped, manualTarget: target.manual },
      "manual upload stored",
    );

    return {
      appVersionId: appVersion.id,
      appTargetId: target.id,
      packageName,
      version,
      filename,
      sizeBytes: size,
      sha256,
      wrapped,
    };
  } catch (err) {
    await fs.rm(incoming, { force: true });
    await fs.rm(finalPath, { force: true });
    throw err;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
