import {
  type InstallMode,
  type JobState,
  type LogLevel,
  type RolloutStatus,
  prisma,
} from "@magnemite/db";
import { bus } from "../bus.js";
import { log } from "../log.js";
import { confirmScanning, resumeAfterInstall, rotomEnabled } from "./rotom.js";

/** States the agent moves through while it is actually working on a job. */
export const ACTIVE_STATES: JobState[] = [
  "DISPATCHED",
  "DOWNLOADING",
  "EXTRACTING",
  "INSTALLING",
  "VERIFYING",
];

export const TERMINAL_STATES: JobState[] = ["SUCCESS", "FAILED", "CANCELLED", "SKIPPED"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export async function logJobEvent(
  jobId: string,
  message: string,
  opts: { level?: LogLevel; phase?: JobState } = {},
) {
  await prisma.jobEvent.create({
    data: { jobId, message, level: opts.level ?? "INFO", phase: opts.phase ?? null },
  });
}

function publishJob(job: { id: string; rolloutId: string; deviceId: string }) {
  bus.publish({ kind: "job", jobId: job.id, rolloutId: job.rolloutId, deviceId: job.deviceId });
}

/**
 * Progress report from the agent. Ignored once the job is terminal, so a
 * message that crosses paths with a cancel can't resurrect it.
 */
export async function applyProgress(
  jobId: string,
  state: JobState,
  progress: number,
  message?: string | null,
) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (isTerminal(job.state)) return;

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      state,
      progress: Math.max(0, Math.min(100, progress)),
      heartbeatAt: new Date(),
      startedAt: job.startedAt ?? new Date(),
    },
  });

  if (message) await logJobEvent(jobId, message, { phase: state });
  publishJob(updated);
}

/**
 * Put the box back into Rotom's scanning pool now that the job is over, and —
 * when the install worked — check that the scanner actually came back. That
 * check runs detached: it takes minutes, and nothing downstream waits on it.
 */
async function releaseRotom(
  job: { id: string; deviceId: string; rolloutId: string },
  outcome: "success" | "failed",
) {
  if (!rotomEnabled()) return;

  await resumeAfterInstall(job.deviceId, job.id, { restartApp: outcome === "success" }).catch(
    (err) => log.warn({ err, jobId: job.id }, "rotom resume failed"),
  );

  if (outcome !== "success") return;

  void (async () => {
    const scanning = await confirmScanning(job.deviceId).catch(() => null);
    if (scanning === null) return;
    if (scanning) {
      await logJobEvent(job.id, "scanner reconnected to rotom");
    } else {
      await logJobEvent(
        job.id,
        "installed, but the scanner has not reappeared in rotom — check the box",
        { level: "WARN" },
      );
    }
    publishJob(job);
  })();
}

export type JobOutcome = {
  ok: boolean;
  installMode?: InstallMode | null;
  dataWiped?: boolean;
  installedVersion?: string | null;
  error?: string | null;
};

/**
 * Final word from the agent. On failure the job goes back to QUEUED while it
 * still has attempts left, so a box that dropped its uplink mid-download gets
 * picked up again on the next tick instead of needing a human.
 */
export async function completeJob(jobId: string, outcome: JobOutcome) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { rollout: true },
  });
  if (!job || isTerminal(job.state)) return;

  const dataWiped = outcome.dataWiped ?? job.dataWiped;

  if (outcome.ok) {
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        state: "SUCCESS",
        progress: 100,
        finishedAt: new Date(),
        installMode: outcome.installMode ?? job.installMode,
        dataWiped,
        lastError: null,
      },
    });
    await logJobEvent(jobId, `installed ${outcome.installedVersion ?? job.toVersion}`, {
      phase: "SUCCESS",
    });
    publishJob(updated);
  } else {
    const canRetry = job.attempt < job.rollout.maxAttempts;
    const updated = await prisma.job.update({
      where: { id: jobId },
      data: {
        state: canRetry ? "QUEUED" : "FAILED",
        progress: 0,
        lastError: outcome.error ?? "unknown error",
        dataWiped,
        installMode: outcome.installMode ?? job.installMode,
        finishedAt: canRetry ? null : new Date(),
      },
    });
    await logJobEvent(jobId, outcome.error ?? "job failed", {
      level: "ERROR",
      phase: canRetry ? "QUEUED" : "FAILED",
    });
    if (canRetry) {
      await logJobEvent(
        jobId,
        `re-queued for attempt ${job.attempt + 1}/${job.rollout.maxAttempts}`,
        { phase: "QUEUED" },
      );
    }
    publishJob(updated);
  }

  // A job that is going round again keeps the box parked in Rotom — putting it
  // back into the pool only to pull it out seconds later would be churn.
  const goingAgain = !outcome.ok && job.attempt < job.rollout.maxAttempts;
  if (!goingAgain) await releaseRotom(job, outcome.ok ? "success" : "failed");

  await recomputeRollout(job.rolloutId);
}

/** Operator pressed retry on a job that had already given up. */
export async function retryJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (!isTerminal(job.state) && job.state !== "QUEUED") return job;

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      state: "QUEUED",
      progress: 0,
      // Reset the counter: a manual retry is a fresh decision, not a
      // continuation of the automatic attempts that already gave up.
      attempt: 0,
      lastError: null,
      queuedAt: new Date(),
      dispatchedAt: null,
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    },
  });
  await logJobEvent(jobId, "retry requested by operator", { phase: "QUEUED" });
  publishJob(updated);
  await recomputeRollout(job.rolloutId);
  return updated;
}

export async function retryFailedJobs(rolloutId: string) {
  const failed = await prisma.job.findMany({
    where: { rolloutId, state: "FAILED" },
    select: { id: true },
  });
  for (const job of failed) await retryJob(job.id);
  return failed.length;
}

export async function cancelJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || isTerminal(job.state)) return job;

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: { state: "CANCELLED", finishedAt: new Date() },
  });
  await logJobEvent(jobId, "cancelled", { phase: "CANCELLED" });
  publishJob(updated);
  await releaseRotom(job, "failed");
  await recomputeRollout(job.rolloutId);
  return updated;
}

/**
 * Re-queue jobs whose agent went quiet. Covers the box that was unplugged
 * mid-install and the socket that died without a close frame.
 */
export async function requeueStalled(stallTimeoutSeconds: number) {
  const cutoff = new Date(Date.now() - stallTimeoutSeconds * 1000);
  const stalled = await prisma.job.findMany({
    where: {
      state: { in: ACTIVE_STATES },
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, dispatchedAt: { lt: cutoff } }],
    },
    include: { rollout: true },
  });

  for (const job of stalled) {
    const canRetry = job.attempt < job.rollout.maxAttempts;
    await prisma.job.update({
      where: { id: job.id },
      data: {
        state: canRetry ? "QUEUED" : "FAILED",
        progress: 0,
        lastError: `agent went silent for over ${stallTimeoutSeconds}s in ${job.state}`,
        finishedAt: canRetry ? null : new Date(),
      },
    });
    await logJobEvent(job.id, `stalled in ${job.state}, ${canRetry ? "re-queued" : "failed"}`, {
      level: "WARN",
    });
    publishJob(job);
    if (!canRetry) await releaseRotom(job, "failed");
    await recomputeRollout(job.rolloutId);
  }

  if (stalled.length) log.warn({ count: stalled.length }, "re-queued stalled jobs");
  return stalled.length;
}

/**
 * Roll the per-job outcomes up into the rollout state machine:
 * canary finishes -> soak -> full fleet -> done, with a failed canary
 * parking the rollout instead of pushing a bad build to 200 boxes.
 */
export async function recomputeRollout(rolloutId: string) {
  const rollout = await prisma.rollout.findUnique({
    where: { id: rolloutId },
    include: { jobs: { select: { state: true, isCanary: true } } },
  });
  if (!rollout) return;
  if (["COMPLETED", "CANCELLED"].includes(rollout.status)) return;

  const jobs = rollout.jobs;
  const canary = jobs.filter((j) => j.isCanary);
  const allDone = jobs.every((j) => isTerminal(j.state));

  let status: RolloutStatus = rollout.status;
  const data: { status?: RolloutStatus; canaryPassedAt?: Date; finishedAt?: Date } = {};

  if (rollout.status === "CANARY" && canary.length > 0) {
    const canaryDone = canary.every((j) => isTerminal(j.state));
    if (canaryDone) {
      const canaryFailed = canary.some((j) => j.state === "FAILED");
      if (canaryFailed) {
        status = "PAUSED";
      } else if (canary.some((j) => j.state === "SUCCESS")) {
        data.canaryPassedAt = new Date();
        status = rollout.soakMinutes > 0 ? "SOAKING" : "RUNNING";
      }
    }
  }

  if (allDone && !["PAUSED"].includes(status)) {
    status = "COMPLETED";
    data.finishedAt = new Date();
  }

  if (status !== rollout.status || Object.keys(data).length > 0) {
    await prisma.rollout.update({ where: { id: rolloutId }, data: { ...data, status } });
    bus.publish({ kind: "rollout", rolloutId });
  }
}
