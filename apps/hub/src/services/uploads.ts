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
import { readApkInfo } from "./apkInfo.js";
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
  /** Left empty, the package name is read out of the file's own manifest. */
  packageName?: string | null;
  /**
   * What the operator calls this build, e.g. "1.4.2" or "2026-08-26 hotfix".
   * Left empty, the manifest's versionName is used.
   */
  version?: string | null;
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
  /** True when the package name or version came from the file, not the form. */
  detected: boolean;
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
  const typedPackage = (input.packageName ?? "").trim();
  const typedVersion = (input.version ?? "").trim();

  if (typedPackage && !PACKAGE_NAME.test(typedPackage)) {
    throw new Error(`"${typedPackage}" is not an Android package name`);
  }

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

  // --- ask the file what it is --------------------------------------------
  // An APK carries its package and version in its manifest, so an operator
  // typing them again is an operator with a chance to get them wrong. What
  // they did type still wins: a label like "2026-08-26 hotfix" is a deliberate
  // choice the file cannot express.
  const manifest = await readApkInfo(incoming);

  const packageName = typedPackage || (manifest.packageName ?? "");
  // versionName is what people call a version, but it is optional in the
  // manifest — a build that only declares versionCode is still a build, and
  // the number it does have beats making the operator go and find one.
  const version = typedVersion || manifest.versionName || (manifest.versionCode ?? "");
  const detected =
    (!typedPackage && Boolean(manifest.packageName)) ||
    (!typedVersion && Boolean(manifest.versionName ?? manifest.versionCode));

  if (!PACKAGE_NAME.test(packageName)) {
    await fs.rm(incoming, { force: true });
    throw new Error(
      packageName
        ? `"${packageName}" is not an Android package name`
        : "could not read a package name out of this file — type one in",
    );
  }
  if (!version) {
    await fs.rm(incoming, { force: true });
    throw new Error("could not read a version out of this file — type a label in");
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
        buildCode: manifest.versionCode,
        status: "READY",
        cacheProgress: 100,
        error: null,
        approved: true,
        publishedAt: new Date(),
      },
      create: {
        appTargetId: target.id,
        version,
        // Android compares this, not the marketing string, and the sources
        // record it too — so a manual upload should not be the one hole.
        buildCode: manifest.versionCode,
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
      detected,
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
