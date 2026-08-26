import { z } from "zod";
import type { AppTarget } from "@magnemite/db";
import { env } from "../../env.js";
import { log } from "../../log.js";
import type { DiscoveredVersion } from "./types.js";

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullish(),
  draft: z.boolean().default(false),
  prerelease: z.boolean().default(false),
  published_at: z.string().nullish(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number(),
      browser_download_url: z.string(),
    }),
  ),
});

/**
 * Tags look like `playstore-2026081202-0.425.0`: the middle field is the Play
 * build code, the last one is the marketing version.
 */
function parseTag(tag: string): { buildCode: string | null; version: string | null } {
  const match = /^playstore-(\d+)-(.+)$/.exec(tag);
  if (match) return { buildCode: match[1]!, version: match[2]! };
  // Fall back to the first dotted number anywhere in the tag.
  const loose = /(\d+\.\d+\.\d+)/.exec(tag);
  return { buildCode: null, version: loose?.[1] ?? null };
}

/** `googleplaystore_2026081202_0.425.0_com.nianticlabs.pokemongo_arm64-v8a.apkm` */
function parseAssetName(name: string): { buildCode: string | null; version: string | null } {
  const match = /^googleplaystore_(\d+)_([\d.]+)_/.exec(name);
  if (match) return { buildCode: match[1]!, version: match[2]! };
  return { buildCode: null, version: null };
}

// ETags keep the polls off GitHub's rate limit: an unchanged release list
// costs a 304 rather than one of the 60 anonymous calls per hour.
const etags = new Map<string, string>();

export async function pollGithub(target: AppTarget): Promise<DiscoveredVersion[]> {
  if (!target.githubRepo) return [];

  const url = `https://api.github.com/repos/${target.githubRepo}/releases?per_page=20`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "magnemite-hub",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const etag = etags.get(url);
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch(url, { headers });
  if (res.status === 304) return [];
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    log.warn(
      { repo: target.githubRepo, reset },
      "github rate limited — set GITHUB_TOKEN to raise the limit",
    );
    return [];
  }
  if (!res.ok) throw new Error(`github releases: HTTP ${res.status}`);

  const newEtag = res.headers.get("etag");
  if (newEtag) etags.set(url, newEtag);

  const releases = z.array(releaseSchema).parse(await res.json());
  const pattern = target.assetPattern ? new RegExp(target.assetPattern) : null;
  const found: DiscoveredVersion[] = [];

  for (const release of releases) {
    if (release.draft) continue;

    for (const asset of release.assets) {
      if (pattern && !pattern.test(asset.name)) continue;
      if (!pattern && !asset.name.endsWith(".apkm")) continue;
      // A release carries the loose base.apk, dump.cs and metadata too; only
      // the bundle is installable.
      if (!asset.name.endsWith(".apkm")) continue;
      if (!asset.name.includes(target.arch)) continue;

      const fromAsset = parseAssetName(asset.name);
      const fromTag = parseTag(release.tag_name);
      const version = fromAsset.version ?? fromTag.version;
      if (!version) {
        log.warn({ asset: asset.name }, "could not parse a version out of the asset name");
        continue;
      }

      found.push({
        source: "GITHUB",
        version,
        buildCode: fromAsset.buildCode ?? fromTag.buildCode,
        arch: target.arch,
        filename: asset.name,
        remoteUrl: asset.browser_download_url,
        sizeBytes: asset.size,
        // GitHub publishes no hash for release assets; the hub computes
        // sha256 while caching and the size is the only upfront check.
        md5: null,
        publishedAt: release.published_at ? new Date(release.published_at) : null,
      });
    }
  }

  return found;
}
