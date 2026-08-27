import { z } from "zod";
import type { AppTarget, SourceFeed } from "@magnemite/db";
import type { DiscoveredVersion } from "./types.js";

/**
 * One index format, however many places publish it.
 *
 * The shape is the flat array the UnownHash mirror serves. Other publishers
 * carry extra fields — `package`, `version_code`, `sha256_hash`, an absolute
 * `url` — which are read when present and ignored when not, so a plain mirror
 * and a richer index both work through this one reader.
 */
const entrySchema = z.object({
  filename: z.string(),
  size: z.number(),
  arch: z.string(),
  version: z.string(),
  last_modified: z.string().nullish(),
  md5_hash: z.string().nullish(),
  /** Published by some feeds; the hub still computes its own after caching. */
  sha256_hash: z.string().nullish(),
  /** Saves matching on the filename prefix when the feed states it. */
  package: z.string().nullish(),
  /** Play build code, e.g. "2026081202". */
  version_code: z.string().nullish(),
  /** Absolute download URL. Feeds without one need the feed's baseUrl. */
  url: z.string().nullish(),
});

export type FeedEntry = z.infer<typeof entrySchema>;

/** Fetch and parse an index. Throws on anything that is not a usable list. */
export async function fetchFeedIndex(indexUrl: string, timeoutMs = 20_000): Promise<FeedEntry[]> {
  const res = await fetch(indexUrl, {
    headers: { "User-Agent": "magnemite-hub", Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`feed index: HTTP ${res.status}`);
  return z.array(entrySchema).parse(await res.json());
}

/** Entries of this index that are this target's package on this target's ABI. */
export function entriesForTarget(
  entries: FeedEntry[],
  target: { packageName: string; arch: string },
): FeedEntry[] {
  return entries.filter((entry) => {
    if (entry.arch !== target.arch) return false;
    // Feeds that name the package are matched on it; the rest are flat and
    // package-agnostic, so the filename prefix is all there is to go on.
    if (entry.package) return entry.package === target.packageName;
    return entry.filename.startsWith(target.packageName);
  });
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function pollFeed(feed: SourceFeed, target: AppTarget): Promise<DiscoveredVersion[]> {
  const entries = entriesForTarget(await fetchFeedIndex(feed.indexUrl), target);
  const base = feed.baseUrl
    ? feed.baseUrl.endsWith("/")
      ? feed.baseUrl
      : `${feed.baseUrl}/`
    : null;

  const found: DiscoveredVersion[] = [];
  for (const entry of entries) {
    const remoteUrl = entry.url ?? (base ? `${base}${entry.filename}` : null);
    // Nothing to download from: an index of relative filenames needs a base
    // URL, and without one the entry is not actionable.
    if (!remoteUrl) continue;

    found.push({
      source: "MIRROR",
      feedId: feed.id,
      version: entry.version,
      buildCode: emptyToNull(entry.version_code),
      arch: entry.arch,
      filename: entry.filename,
      remoteUrl,
      sizeBytes: entry.size,
      md5: emptyToNull(entry.md5_hash),
      publishedAt: entry.last_modified ? new Date(entry.last_modified) : null,
    });
  }
  return found;
}
