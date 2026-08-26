import { prisma } from "@magnemite/db";
import { log } from "../log.js";
import { cacheVersion } from "./artifacts.js";
import { createRollout } from "./rollouts.js";
import { nudge } from "./scheduler.js";
import { compareVersions } from "./sources/types.js";

const ACTIVE_ROLLOUT_STATUSES = ["PENDING", "CANARY", "SOAKING", "RUNNING", "PAUSED"] as const;

/**
 * Decide whether the newest approved version deserves an automatic rollout.
 *
 * Deliberately conservative: one rollout per target at a time, never a
 * downgrade, and nothing moves until the artifact is actually cached on the
 * VPS. The dispatch-time window check in the scheduler is what keeps an
 * out-of-hours rollout from waking the fleet at 3am.
 */
export async function runAutoUpdate(appTargetId: string) {
  const target = await prisma.appTarget.findUnique({ where: { id: appTargetId } });
  if (!target || !target.enabled || !target.autoUpdateEnabled) return null;

  const active = await prisma.rollout.count({
    where: {
      appVersion: { appTargetId },
      status: { in: [...ACTIVE_ROLLOUT_STATUSES] },
    },
  });
  if (active > 0) return null;

  const candidates = await prisma.appVersion.findMany({
    where: { appTargetId, approved: true, status: { in: ["DISCOVERED", "CACHING", "READY"] } },
  });
  if (candidates.length === 0) return null;

  // Prefer the configured source when both mirror the same version.
  const sorted = [...candidates].sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    const aPreferred = a.source === target.preferredSource ? 0 : 1;
    const bPreferred = b.source === target.preferredSource ? 0 : 1;
    return aPreferred - bPreferred;
  });
  const latest = sorted[0];
  if (!latest) return null;

  // Anything the fleet is already running, or ahead of, is not an update.
  const installed = await prisma.devicePackage.findMany({
    where: { packageName: target.packageName, device: { approved: true } },
    select: { versionName: true },
  });
  const behind = installed.filter(
    (p) => !p.versionName || compareVersions(latest.version, p.versionName) > 0,
  );
  if (behind.length === 0) return null;

  if (latest.status !== "READY") {
    log.info(
      { version: latest.version, source: latest.source },
      "auto-update: caching artifact before rollout",
    );
    await cacheVersion(latest.id);
  }

  const rollout = await createRollout({
    appVersionId: latest.id,
    mode: "AUTO",
    canaryCount: target.canaryCount,
    soakMinutes: target.soakMinutes,
    maxConcurrency: target.maxConcurrency,
    maxAttempts: target.maxAttempts,
    skipUpToDate: true,
    note: `auto-update to ${latest.version} (${latest.source.toLowerCase()})`,
  });

  log.info(
    { rolloutId: rollout.id, version: latest.version, devices: behind.length },
    "auto-update rollout created",
  );
  nudge();
  return rollout;
}
