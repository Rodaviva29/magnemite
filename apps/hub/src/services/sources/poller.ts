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

/** What one pass actually did, so a manual check can report more than "ok". */
export type PollSummary = {
  /** False when a poll was already running, so this call did nothing itself. */
  ran: boolean;
  targets: number;
  /** Distinct feeds actually reached, across every target. */
  feeds: number;
  /** Builds the feeds listed for these targets, before de-duplication. */
  listed: number;
  discovered: number;
  errors: { feed: string; error: string }[];
};

export async function pollAllSources(): Promise<PollSummary> {
  // A poll already under way is doing this call's work for it. Saying so is
  // better than a silent no-op that looks like a dead button.
  if (inFlight) return { ran: false, targets: 0, feeds: 0, listed: 0, discovered: 0, errors: [] };
  inFlight = true;
  lastPolledAt = Date.now();

  const feedsSeen = new Set<string>();
  // Keyed by feed: the same feed is polled once per target, and one broken
  // feed should be reported once rather than once per app.
  const errors = new Map<string, { feed: string; error: string }>();
  let discoveredTotal = 0;
  let listedTotal = 0;
  let targetCount = 0;

  // Built up across the whole pass and written to `pollStats` at the end. A
  // feed is polled once per target, so writing as we go meant the last target
  // decided what the Status page showed — a fleet whose last target matches
  // nothing made every feed report "0 versions listed" however much it had
  // actually returned.
  const pass = new Map<string, SourcePollStat>();

  const record = (feed: { id: string; name: string }, found: number, error: string | null) => {
    const seen = pass.get(feed.id);
    pass.set(feed.id, {
      feedId: feed.id,
      name: feed.name,
      at: new Date().toISOString(),
      // One target failing is the feed failing, whatever the others did.
      ok: (seen?.ok ?? true) && error === null,
      found: (seen?.found ?? 0) + found,
      error: error ?? seen?.error ?? null,
    });
  };

  try {
    // Manual targets exist only to hold uploads: nothing to poll, and no
    // auto-update policy to run against them.
    const targets = await prisma.appTarget.findMany({
      where: { enabled: true, manual: false },
      include: { sources: { include: { feed: true } } },
    });

    targetCount = targets.length;

    for (const target of targets) {
      // Each target is polled from the feeds it was given, not from every feed
      // that exists — a feed is an index of many apps, and two targets rarely
      // want the same set. Disabling a feed skips it everywhere without
      // unpairing it from anything.
      const feeds = target.sources
        .map((link) => link.feed)
        .filter((feed) => feed.enabled)
        // `dedupe` keeps the first sighting of a build, so priority order is
        // what makes the lowest-priority feed the one whose URL is downloaded.
        .sort((a, b) => a.priority - b.priority);

      if (feeds.length === 0) {
        log.warn(
          { target: target.packageName },
          "no enabled version sources selected — nothing to poll",
        );
        continue;
      }

      const found: DiscoveredVersion[] = [];

      for (const feed of feeds) {
        try {
          const listed = await pollFeed(feed, target);
          found.push(...listed);
          feedsSeen.add(feed.id);
          listedTotal += listed.length;
          record(feed, listed.length, null);
        } catch (err) {
          // One feed being down must not stop the others from being checked.
          const message = err instanceof Error ? err.message : String(err);
          log.warn({ err, feed: feed.name, target: target.packageName }, "source poll failed");
          errors.set(feed.id, { feed: feed.name, error: message });
          record(feed, 0, message);
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
        } else if (existing.status === "READY" && existing.source !== "MANUAL") {
          // A cached build is already on disk, so its URL, size and hashes
          // describe that file and must not be rewritten from the index.
          //
          // Attribution is the exception. Deleting a source nulls it
          // (`onDelete: SetNull`) and the version reads as "unknown feed" from
          // then on — permanently, because this whole branch used to skip
          // READY rows outright. Adding the source back puts the name on it
          // again at the next poll. Only when it is missing: re-pointing a
          // cached artifact at a feed it was not downloaded from would be a
          // worse lie than "unknown".
          if (existing.feedId === null) {
            await prisma.appVersion.update({
              where: { id: existing.id },
              data: { feedId: item.feedId },
            });
            bus.publish({ kind: "version", versionId: existing.id });
            log.info(
              { target: target.packageName, version: item.version, feedId: item.feedId },
              "cached build re-attributed to its source",
            );
          }
        } else if (existing.source !== "MANUAL") {
          // Refresh metadata while it is still just a pointer — a feed
          // occasionally re-uploads a file with a new size or hash, and a
          // build first seen on a feed that has since been disabled needs to
          // move to whichever one still lists it.
          //
          // A download that failed, failed against the URL it had at the time.
          // Once that URL changes — a corrected base URL, or another feed
          // picking the build up — the verdict no longer applies, so it goes
          // back to merely discovered rather than sitting there with an error
          // about a URL it no longer points at. Only when the URL actually
          // moved: re-clearing it every poll would hide a build that is
          // genuinely broken behind an endless retry.
          const repointed = existing.remoteUrl !== item.remoteUrl;
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
              ...(repointed && existing.status === "FAILED"
                ? { status: "DISCOVERED" as const, error: null, cacheProgress: 0 }
                : {}),
            },
          });
          if (repointed && existing.status === "FAILED") {
            bus.publish({ kind: "version", versionId: existing.id });
            log.info(
              { target: target.packageName, version: item.version, url: item.remoteUrl },
              "failed build repointed at a new URL",
            );
          }
        }
      }

      discoveredTotal += discovered;
      if (discovered > 0) log.info({ target: target.packageName, discovered }, "poll complete");

      try {
        await runAutoUpdate(target.id);
      } catch (err) {
        log.error({ err, target: target.packageName }, "auto-update check failed");
      }
    }
    for (const [feedId, stat] of pass) pollStats.set(feedId, stat);

    return {
      ran: true,
      targets: targetCount,
      feeds: feedsSeen.size,
      listed: listedTotal,
      discovered: discoveredTotal,
      errors: [...errors.values()],
    };
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
  // Everything in here is behind `void maybeTick()`, so a rejection that
  // escaped — reading the settings included, not just the poll itself — would
  // be an unhandled one.
  try {
    const settings = await getHubSettings();
    const intervalMs = settings.sourcePollMinutes * 60_000;
    if (Date.now() - lastPolledAt < intervalMs) return;
    await pollAllSources();
  } catch (err) {
    log.error({ err }, "source poll failed");
  }
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
