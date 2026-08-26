import { z } from "zod";
import type { AppTarget } from "@magnemite/db";
import type { DiscoveredVersion } from "./types.js";

/** Entry shape of https://mirror.unownhash.com/index.json */
const entrySchema = z.object({
  filename: z.string(),
  last_modified: z.string().nullish(),
  md5_hash: z.string().nullish(),
  size: z.number(),
  arch: z.string(),
  version: z.string(),
});

export async function pollMirror(target: AppTarget): Promise<DiscoveredVersion[]> {
  if (!target.mirrorIndexUrl || !target.mirrorBaseUrl) return [];

  const res = await fetch(target.mirrorIndexUrl, {
    headers: { "User-Agent": "magnemite-hub", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mirror index: HTTP ${res.status}`);

  const entries = z.array(entrySchema).parse(await res.json());
  const base = target.mirrorBaseUrl.endsWith("/")
    ? target.mirrorBaseUrl
    : `${target.mirrorBaseUrl}/`;

  return (
    entries
      .filter((e) => e.arch === target.arch)
      // The index is flat and package-agnostic, so match on the filename prefix.
      .filter((e) => e.filename.startsWith(target.packageName))
      .map((e) => ({
        source: "MIRROR" as const,
        version: e.version,
        buildCode: null,
        arch: e.arch,
        filename: e.filename,
        remoteUrl: `${base}${e.filename}`,
        sizeBytes: e.size,
        md5: e.md5_hash ?? null,
        publishedAt: e.last_modified ? new Date(e.last_modified) : null,
      }))
  );
}
