import { getHubSettings, prisma } from "@magnemite/db";
import { bus } from "../../bus.js";
import { log } from "../../log.js";
import { runAutoUpdate } from "../autoUpdate.js";
import { pollFeed } from "./feed.js";
import type { DiscoveredVersion } from "./types.js";

/** How often the timer wakes up to check whether a poll is due. */
const CHECK_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastPolledAt = 0;

/** What each feed did the last time it was asked, for the Status page. */
export type SourcePollStat = {
  feedId: string;
  name: string;
  at: string;
  ok: boolean;
  found: number;
  error: string | null;
};

const pollStats = new Map<string, SourcePollStat>();

export function getPollStats(): SourcePollStat[] {
  return [...pollStats.values()];
}

export function getPollStat(feedId: string): SourcePollStat | null {
  return pollStats.get(feedId) ?? null;
}

/**
 * Pick one row per build.
 *
 * Two feeds mirroring the same release are the same thing to the fleet, so the
 * version is stored once and the feed with the lowest `priority` decides which
 * URL is downloaded. Feeds are handed in priority order, so the first sighting
 * of a build wins and later ones only fill in what it was missing.
 */
function dedupe(found: DiscoveredVersion[]): DiscoveredVersion[] {
  const byBuild = new Map<string, DiscoveredVersion>();
  for (const item of found) {
    const key = `${item.version}|${item.arch}`;
    const seen = byBuild.get(key);
    if (!seen) {
      byBuild.set(key, item);
      continue;
    }
    // Same build from a lower-priority feed: keep the winner's URL, take any
    // metadata it did not publish itself.
    seen.md5 ??= item.md5;
    seen.buildCode ??= item.buildCode;
    seen.publishedAt ??= item.publishedAt;
  }
  return [...byBuild.values()];
}

export async function pollAllSources() {
  if (inFlight) return;
  inFlight = true;
  lastPolledAt = Date.now();
  try {
    // Manual targets exist only to hold uploads: nothing to poll, and no
    // auto-update policy to run against them.
    const [targets, feeds] = await Promise.all([
      prisma.appTarget.findMany({ where: { enabled: true, manual: false } }),
      prisma.sourceFeed.findMany({ where: { enabled: true }, orderBy: { priority: "asc" } }),
    ]);

    if (feeds.length === 0) {
      log.warn("no source feeds are enabled — nothing to poll");
      return;
    }

    for (const target of targets) {
      const found: DiscoveredVersion[] = [];

      for (const feed of feeds) {
        try {
          const listed = await pollFeed(feed, target);
          found.push(...listed);
          pollStats.set(feed.id, {
            feedId: feed.id,
            name: feed.name,
            at: new Date().toISOString(),
            ok: true,
            found: listed.length,
            error: null,
          });
        } catch (err) {
          // One feed being down must not stop the others from being checked.
          log.warn({ err, feed: feed.name, target: target.packageName }, "source poll failed");
          pollStats.set(feed.id, {
            feedId: feed.id,
            name: feed.name,
            at: new Date().toISOString(),
            ok: false,
            found: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      let discovered = 0;
      for (const item of dedupe(found)) {
        const existing = await prisma.appVersion.findUnique({
          where: {
            appTargetId_version_arch: {
              appTargetId: target.id,
              version: item.version,
              arch: item.arch,
            },
          },
        });

        if (!existing) {
          const created = await prisma.appVersion.create({
            data: {
              appTargetId: target.id,
              version: item.version,
              buildCode: item.buildCode,
              source: item.source,
              feedId: item.feedId,
              arch: item.arch,
              remoteUrl: item.remoteUrl,
              filename: item.filename,
              sizeBytes: BigInt(item.sizeBytes),
              md5: item.md5,
              publishedAt: item.publishedAt,
              approved: target.autoApprove,
            },
          });
          discovered += 1;
          bus.publish({ kind: "version", versionId: created.id });
          log.info(
            { target: target.packageName, version: item.version, feedId: item.feedId },
            "new version discovered",
          );
        } else if (existing.status !== "READY" && existing.source !== "MANUAL") {
          // Refresh metadata while it is still just a pointer — a feed
          // occasionally re-uploads a file with a new size or hash, and a
          // build first seen on a feed that has since been disabled needs to
          // move to whichever one still lists it.
          await prisma.appVersion.update({
            where: { id: existing.id },
            data: {
              feedId: item.feedId,
              remoteUrl: item.remoteUrl,
              filename: item.filename,
              sizeBytes: BigInt(item.sizeBytes),
              md5: item.md5 ?? existing.md5,
              buildCode: item.buildCode ?? existing.buildCode,
              publishedAt: item.publishedAt ?? existing.publishedAt,
            },
          });
        }
      }

      if (discovered > 0) log.info({ target: target.packageName, discovered }, "poll complete");

      try {
        await runAutoUpdate(target.id);
      } catch (err) {
        log.error({ err, target: target.packageName }, "auto-update check failed");
      }
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Ticks every `CHECK_INTERVAL_MS` and polls once `sourcePollMinutes` (read
 * live from Settings on every check) has actually elapsed, rather than
 * setting a fixed interval up front — so changing the interval from the
 * dashboard takes effect without a hub restart.
 */
async function maybeTick() {
  const settings = await getHubSettings();
  const intervalMs = settings.sourcePollMinutes * 60_000;
  if (Date.now() - lastPolledAt < intervalMs) return;
  await pollAllSources().catch((err) => log.error({ err }, "source poll failed"));
}

export function startPolling() {
  if (timer) return;
  timer = setInterval(() => void maybeTick(), CHECK_INTERVAL_MS);
  log.info("source polling started");
  // Give the hub a moment to finish booting before the first network call.
  setTimeout(() => void pollAllSources().catch(() => undefined), 10_000);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
