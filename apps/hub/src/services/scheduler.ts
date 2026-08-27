import path from "node:path";
import type { InstallJob } from "@magnemite/protocol";
import { getHubSettings, prisma } from "@magnemite/db";
import { env } from "../env.js";
import { log } from "../log.js";
import { isOnline, sendTo } from "../registry.js";
import { ACTIVE_STATES, logJobEvent, recomputeRollout, requeueStalled } from "./jobs.js";
import { pauseForInstall, releaseOrphanedDevices, rotomEnabled } from "./rotom.js";

const TICK_MS = 5_000;

let running = false;
let timer: NodeJS.Timeout | null = null;
/** Set when a tick is requested while one is already in flight. */
let rerun = false;

export function artifactUrl(artifactPath: string): string {
  return `${env.MAGNEMITE_PUBLIC_URL.replace(/\/$/, "")}/files/${path.basename(artifactPath)}`;
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  log.info("scheduler started");
  void tick();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Ask the scheduler to run now — a device just came online, an operator
 * created a rollout, a job finished. Cheap and safe to call often.
 */
export function nudge() {
  void tick();
}

async function tick() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    const settings = await getHubSettings();
    await promoteSoakingRollouts();
    await requeueStalled(settings.jobStallTimeoutSeconds);
    // A hub restart mid-install would otherwise leave a box disabled in Rotom
    // for good.
    await releaseOrphanedDevices();
    await dispatchQueued(settings.maxConcurrentJobs);
  } catch (err) {
    log.error({ err }, "scheduler tick failed");
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      setImmediate(() => void tick());
    }
  }
}

/** A canary that passed its soak releases the rest of the fleet. */
async function promoteSoakingRollouts() {
  const soaking = await prisma.rollout.findMany({
    where: { status: "SOAKING", canaryPassedAt: { not: null } },
  });
  for (const rollout of soaking) {
    const readyAt = new Date(rollout.canaryPassedAt!.getTime() + rollout.soakMinutes * 60_000);
    if (readyAt <= new Date()) {
      await prisma.rollout.update({ where: { id: rollout.id }, data: { status: "RUNNING" } });
      log.info({ rolloutId: rollout.id }, "soak finished, releasing fleet");
    }
  }
}

/** "HH:MM" window, inclusive of the start, exclusive of the end. Wraps midnight. */
function insideWindow(start: string | null, end: string | null, now = new Date()): boolean {
  if (!start || !end) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (v: string) => {
    const [h = "0", m = "0"] = v.split(":");
    return Number(h) * 60 + Number(m);
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

async function dispatchQueued(maxConcurrentJobs: number) {
  const activeCount = await prisma.job.count({ where: { state: { in: ACTIVE_STATES } } });
  let capacity = maxConcurrentJobs - activeCount;
  if (capacity <= 0) return;

  const candidates = await prisma.job.findMany({
    where: {
      state: "QUEUED",
      rollout: { status: { in: ["CANARY", "RUNNING"] } },
      device: { approved: true },
    },
    include: {
      device: { include: { group: true } },
      rollout: { include: { appVersion: { include: { appTarget: true } } } },
    },
    // Canaries first, then oldest rollout first, so one rollout drains before
    // the next one starts competing for slots.
    orderBy: [{ isCanary: "desc" }, { queuedAt: "asc" }],
    take: 500,
  });
  if (candidates.length === 0) return;

  // Per-group in-flight counts, for sites on a thin uplink.
  const groupActive = new Map<string, number>();
  const activeJobs = await prisma.job.findMany({
    where: { state: { in: ACTIVE_STATES } },
    select: { device: { select: { groupId: true } } },
  });
  for (const j of activeJobs) {
    const gid = j.device.groupId;
    if (gid) groupActive.set(gid, (groupActive.get(gid) ?? 0) + 1);
  }

  const rolloutActive = new Map<string, number>();

  for (const job of candidates) {
    if (capacity <= 0) break;

    // An offline box keeps its job queued; it gets dispatched the moment the
    // agent reconnects, no operator action needed.
    if (!isOnline(job.deviceId)) continue;

    const rollout = job.rollout;
    if (rollout.status === "CANARY" && !job.isCanary) continue;

    const target = rollout.appVersion.appTarget;
    if (rollout.mode === "AUTO" && !insideWindow(target.windowStart, target.windowEnd)) continue;

    const groupId = job.device.groupId;
    const groupLimit = job.device.group?.maxConcurrency ?? null;
    if (groupId && groupLimit !== null && (groupActive.get(groupId) ?? 0) >= groupLimit) continue;

    const rolloutLimit = rollout.maxConcurrency;
    if (rolloutLimit !== null && (rolloutActive.get(rollout.id) ?? 0) >= rolloutLimit) continue;

    const version = rollout.appVersion;
    if (!version.artifactPath || !version.sha256) {
      await logJobEvent(job.id, "artifact is not cached on the server", { level: "ERROR" });
      continue;
    }

    const message: InstallJob = {
      type: "install_job",
      jobId: job.id,
      packageName: target.packageName,
      url: artifactUrl(version.artifactPath),
      sha256: version.sha256,
      sizeBytes: Number(version.sizeBytes),
      version: version.version,
      forceClean: rollout.forceClean,
      // A rollout may carry its own hooks — a manual install of some other
      // app has to stop and start *that* app, not whatever the group stops
      // for the watched one. Falls back to the group when it does not.
      preInstallHook: rollout.preInstallHook ?? job.device.group?.preInstallHook ?? null,
      postInstallHook: rollout.postInstallHook ?? job.device.group?.postInstallHook ?? null,
      extraSplits: [],
      timeoutSeconds: 3600,
    };

    const attempt = job.attempt + 1;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        state: "DISPATCHED",
        attempt,
        dispatchedAt: new Date(),
        heartbeatAt: new Date(),
        progress: 0,
      },
    });

    if (!sendTo(job.deviceId, message)) {
      // The socket died between the online check and the write. Put it back
      // and let the next tick try again.
      await prisma.job.update({
        where: { id: job.id },
        data: { state: "QUEUED", attempt: job.attempt, dispatchedAt: null, heartbeatAt: null },
      });
      continue;
    }

    await logJobEvent(job.id, `dispatched (attempt ${attempt}) → ${version.version}`, {
      phase: "DISPATCHED",
    });

    // Take the box out of Rotom's pool so the controller stops handing it
    // accounts, rather than having a scan die halfway through the install.
    if (rotomEnabled()) {
      const paused = await pauseForInstall(job.deviceId, job.id);
      if (paused) await logJobEvent(job.id, "disabled in rotom for the install");
    }
    capacity -= 1;
    if (groupId) groupActive.set(groupId, (groupActive.get(groupId) ?? 0) + 1);
    rolloutActive.set(rollout.id, (rolloutActive.get(rollout.id) ?? 0) + 1);
    await recomputeRollout(rollout.id);
  }
}
