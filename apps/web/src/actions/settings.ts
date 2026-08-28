"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import {
  generateToken,
  hashToken,
  type HubSettingsValues,
  prisma,
  tokenPrefix,
  updateHubSettings as updateHubSettingsInDb,
} from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import type { ActionState } from "./rollouts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * How often to read one index, in minutes.
 *
 * Falls back to the old fleet-wide default rather than rejecting: a stale form
 * that posts nothing should leave a source on a sane cadence, not on zero.
 */
function pollMinutes(formData: FormData): number {
  const parsed = Number(formData.get("pollMinutes"));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 15;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Fleet-wide operational knobs — max concurrent jobs, stall timeout, and so on. */
export async function updateHubSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();

  const int = (name: string, min: number) => {
    const parsed = Number(formData.get(name));
    if (!Number.isFinite(parsed) || parsed < min) return null;
    return Math.floor(parsed);
  };

  const maxConcurrentJobs = int("maxConcurrentJobs", 1);
  const jobStallTimeoutSeconds = int("jobStallTimeoutSeconds", 1);
  // Floored against the heartbeat below, since that is now configurable: a
  // shorter interval cannot produce more points, it just stores every beat.
  const metricsSampleSeconds = int("metricsSampleSeconds", 1);
  // 0 is meaningful here — it turns health recording off and drops what is
  // already stored on the next prune.
  const metricsRetentionDays = int("metricsRetentionDays", 0);
  const heartbeatSeconds = int("heartbeatSeconds", 5);
  const agentUpdateConcurrency = int("agentUpdateConcurrency", 1);
  // Three missed 20-second heartbeats is the floor that stops a box flapping
  // offline on one dropped beat.
  const deviceOfflineTimeoutSeconds = int("deviceOfflineTimeoutSeconds", 30);

  if (
    maxConcurrentJobs === null ||
    jobStallTimeoutSeconds === null ||
    metricsSampleSeconds === null ||
    metricsRetentionDays === null ||
    agentUpdateConcurrency === null ||
    deviceOfflineTimeoutSeconds === null ||
    heartbeatSeconds === null
  ) {
    return {
      error:
        "Every field needs a whole number — 1 or more, except the history retention. The heartbeat starts at 5 and the offline timeout at 30.",
    };
  }

  // Two of these are really measured in heartbeats, and the numbers only mean
  // anything against it. Letting them through unchecked is how a fleet ends up
  // flapping between online and offline on one missed beat, which looks like a
  // network fault and is really a form that allowed nonsense.
  if (deviceOfflineTimeoutSeconds < heartbeatSeconds * 3) {
    return {
      error: `The offline timeout has to allow at least three missed heartbeats — ${heartbeatSeconds * 3}s or more at a ${heartbeatSeconds}s heartbeat. Otherwise one dropped beat marks a box offline.`,
    };
  }
  if (metricsSampleSeconds < heartbeatSeconds) {
    return {
      error: `The health sample interval cannot be shorter than the ${heartbeatSeconds}s heartbeat — there is no extra data to store between beats.`,
    };
  }

  const patch: Partial<HubSettingsValues> = {
    maxConcurrentJobs,
    jobStallTimeoutSeconds,
    metricsSampleSeconds,
    metricsRetentionDays,
    heartbeatSeconds,
    agentUpdateConcurrency,
    deviceOfflineTimeoutSeconds,
  };
  await updateHubSettingsInDb(patch);

  // The hub holds its own copy and no longer re-reads on a timer, so it is
  // told rather than left to notice. The reply is the confirmation: if it does
  // not come, the values are still saved but the hub is running on the old
  // ones, and that has to be said rather than left to be discovered.
  let told = true;
  try {
    await hub.refreshSettings();
  } catch {
    told = false;
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "settings.hub",
      meta: { ...patch, hubNotified: told },
    },
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message: told
      ? "Saved."
      : "Saved, but the hub could not be told, it is still running on the old values. Restart it, or save again once it is back.",
  };
}

/** Pre/post-install hooks and the concurrency cap for one device group. */
export async function updateGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperator();
  const id = String(formData.get("groupId") ?? "");
  if (!id) return { error: "Missing group." };

  const rawConcurrency = String(formData.get("maxConcurrency") ?? "").trim();
  const parsed = Number(rawConcurrency);
  const maxConcurrency =
    rawConcurrency === ""
      ? null
      : Number.isFinite(parsed) && parsed > 0
        ? Math.floor(parsed)
        : null;

  await prisma.deviceGroup.update({
    where: { id },
    data: {
      preInstallHook: String(formData.get("preInstallHook") ?? "").trim() || null,
      postInstallHook: String(formData.get("postInstallHook") ?? "").trim() || null,
      maxConcurrency,
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

export async function createGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOperator();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the group a name." };

  const existing = await prisma.deviceGroup.findUnique({ where: { name } });
  if (existing) return { error: `A group called "${name}" already exists.` };

  await prisma.deviceGroup.create({ data: { name } });
  revalidatePath("/settings");
  return { ok: true, message: `Created "${name}".` };
}

/**
 * Devices in the group are not deleted — `Device.groupId` just goes back to
 * null, so they simply have no group until reassigned.
 */
export async function deleteGroup(id: string): Promise<ActionState> {
  const user = await requireOperator();
  const group = await prisma.deviceGroup.findUnique({ where: { id }, select: { name: true } });
  if (!group) return { error: "That group is already gone." };

  await prisma.deviceGroup.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "deviceGroup.delete",
      targetType: "DeviceGroup",
      targetId: id,
      meta: { name: group.name },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: `Removed "${group.name}".` };
}

/** Same shape the hub validates uploads against. */
const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** Creates a new app target with default auto-update policy, off by default. */
export async function createAppTarget(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const packageName = String(formData.get("packageName") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!packageName || !PACKAGE_NAME.test(packageName)) {
    return { error: "Package name looks wrong — expected something like com.example.app." };
  }
  if (!displayName) return { error: "Give it a display name." };

  const existing = await prisma.appTarget.findUnique({ where: { packageName } });
  if (existing) return { error: `"${packageName}" is already configured.` };

  const feedIds = formData.getAll("sourceIds").map(String).filter(Boolean);
  if (feedIds.length === 0) {
    return { error: "Pick at least one version source — a target with none is never polled." };
  }
  // Guard against a stale form naming a feed that has since been removed:
  // `createMany` on the join would fail on the foreign key with nothing useful
  // to show.
  const feeds = await prisma.sourceFeed.findMany({
    where: { id: { in: feedIds } },
    select: { id: true },
  });
  if (feeds.length !== feedIds.length) {
    return { error: "One of those version sources no longer exists — reload and try again." };
  }

  const target = await prisma.appTarget.create({
    data: {
      packageName,
      displayName,
      sources: { create: feeds.map((feed) => ({ feedId: feed.id })) },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "appTarget.create",
      targetType: "AppTarget",
      targetId: target.id,
      meta: { packageName, displayName, feedIds },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/versions");
  revalidatePath("/");
  return { ok: true, message: `Created "${displayName}".` };
}

/**
 * Everything about one app target: what it is, where it is polled from, and
 * how its rollouts start.
 *
 * One action because it is one card and one Save. Changing the package name
 * only changes what Magnemite polls and installs — the versions each box has
 * already reported are keyed by the old package string and stay where they
 * are, so the fleet columns go quiet until the boxes report the new one.
 */
export async function updateAppTarget(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const id = String(formData.get("appTargetId") ?? "");
  if (!id) return { error: "Missing app target." };

  const packageName = String(formData.get("packageName") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!packageName || !PACKAGE_NAME.test(packageName)) {
    return { error: "Package name looks wrong — expected something like com.example.app." };
  }
  if (!displayName) return { error: "Give it a display name." };

  const clash = await prisma.appTarget.findUnique({ where: { packageName } });
  if (clash && clash.id !== id) return { error: `"${packageName}" is already configured.` };

  const feedIds = formData.getAll("sourceIds").map(String).filter(Boolean);
  if (feedIds.length === 0) {
    return { error: "Pick at least one version source — a target with none is never polled." };
  }
  const feeds = await prisma.sourceFeed.findMany({
    where: { id: { in: feedIds } },
    select: { id: true },
  });
  if (feeds.length !== feedIds.length) {
    return { error: "One of those version sources no longer exists — reload and try again." };
  }

  // A disabled field submits nothing at all, and the card greys the policy out
  // whenever automatic rollouts are off. Absence therefore has to mean "leave
  // this as it was": read as a value, an unsent canary count is `Number(null)`
  // — zero, not the default — so turning the switch off would quietly reset
  // the policy that turning it back on is supposed to restore.
  const sent = (name: string) => formData.get(name) !== null;

  const data: Prisma.AppTargetUpdateInput = {
    packageName,
    displayName,
    // Switches are the exception: an unticked one sends nothing either, and
    // there absence is the value.
    autoUpdateEnabled: formData.get("autoUpdateEnabled") === "on",
    autoApprove: formData.get("autoApprove") === "on",
  };

  const int = (name: string, fallback: number) => {
    const parsed = Number(formData.get(name));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  };

  if (sent("canaryCount")) data.canaryCount = int("canaryCount", 1);
  if (sent("soakMinutes")) data.soakMinutes = int("soakMinutes", 30);
  if (sent("maxAttempts")) data.maxAttempts = Math.max(1, int("maxAttempts", 3));
  if (sent("retryBackoffSeconds")) data.retryBackoffSeconds = int("retryBackoffSeconds", 60);
  // Used to be one number for the whole fleet in Settings → Hub. 0 is a real
  // value here — it means ship as soon as a build is discovered — which is why
  // it goes through the same `sent` guard as the rest of the policy.
  if (sent("updateCooldownMinutes")) data.updateCooldownMinutes = int("updateCooldownMinutes", 0);

  if (sent("windowStart") || sent("windowEnd")) {
    const windowStart = String(formData.get("windowStart") ?? "").trim();
    const windowEnd = String(formData.get("windowEnd") ?? "").trim();
    if (windowStart && !TIME_RE.test(windowStart)) return { error: "Start time must be HH:MM." };
    if (windowEnd && !TIME_RE.test(windowEnd)) return { error: "End time must be HH:MM." };
    if (Boolean(windowStart) !== Boolean(windowEnd)) {
      return { error: "Set both ends of the window, or neither." };
    }
    data.windowStart = windowStart || null;
    data.windowEnd = windowEnd || null;
  }

  // The pairing is replaced wholesale: the form posts the full set every time,
  // so anything missing from it was unticked. Versions already discovered keep
  // pointing at the feed that listed them.
  await prisma.$transaction([
    prisma.appTargetSource.deleteMany({ where: { appTargetId: id, feedId: { notIn: feedIds } } }),
    prisma.appTargetSource.createMany({
      data: feeds.map((feed) => ({ appTargetId: id, feedId: feed.id })),
      skipDuplicates: true,
    }),
    prisma.appTarget.update({ where: { id }, data }),
  ]);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "appTarget.update",
      targetType: "AppTarget",
      targetId: id,
      meta: { packageName, displayName, feedIds },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/versions");
  revalidatePath("/");
  return { ok: true, message: "Saved." };
}

/**
 * Remove the app target, and every version discovered for it.
 *
 * Versions cascade with the target, but a rollout pins the version it shipped
 * (`onDelete: Restrict`), so the database refuses outright once there is any
 * history. That is worth saying plainly rather than surfacing as a foreign key
 * error from a delete that looked like it should work.
 */
export async function deleteAppTarget(id: string): Promise<ActionState> {
  const user = await requireOperator();
  const target = await prisma.appTarget.findUnique({
    where: { id },
    select: { displayName: true, packageName: true },
  });
  if (!target) return { error: "That app target is already gone." };

  const rollouts = await prisma.rollout.count({ where: { appVersion: { appTargetId: id } } });
  if (rollouts > 0) {
    return {
      error: `"${target.displayName}" has ${rollouts} rollout${rollouts === 1 ? "" : "s"} behind it. Removing it would take the versions they shipped, so it cannot be deleted while that history exists.`,
    };
  }

  await prisma.appTarget.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "appTarget.delete",
      targetType: "AppTarget",
      targetId: id,
      meta: { packageName: target.packageName, displayName: target.displayName },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/versions");
  revalidatePath("/");
  return { ok: true, message: `Removed "${target.displayName}".` };
}

/**
 * Watch a package's version across the fleet.
 *
 * Magnemite does not update these — it only asks each box what it has — so
 * this is a column in the fleet table, not an app target. Adding one puts it
 * in the list the agents report on every heartbeat, and the hub pushes that
 * list out immediately so the column fills in without waiting for reconnects.
 */
export async function createWatchedPackage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const packageName = String(formData.get("packageName") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();

  if (!PACKAGE_NAME.test(packageName)) {
    return { error: "That is not a package name — try com.example.app." };
  }

  const existing = await prisma.watchedPackage.findUnique({ where: { packageName } });
  if (existing) return { error: `${packageName} is already watched.` };

  const last = await prisma.watchedPackage.findFirst({ orderBy: { position: "desc" } });
  const watched = await prisma.watchedPackage.create({
    data: { packageName, label: label || null, position: (last?.position ?? 0) + 1 },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "watchedPackage.create",
      targetType: "WatchedPackage",
      targetId: watched.id,
      meta: { packageName },
    },
  });

  // Best effort: a hub that is down does not stop the column existing, and
  // every box picks the list up when it next connects anyway.
  const pushed = await hub
    .refreshTrackedPackages()
    .then((result) => result.sent)
    .catch(() => null);

  revalidatePath("/settings");
  revalidatePath("/");
  return {
    ok: true,
    message:
      pushed === null
        ? `Watching ${packageName}. Boxes will report it as they reconnect.`
        : `Watching ${packageName} — ${pushed} box${pushed === 1 ? "" : "es"} told to report it.`,
  };
}

export async function deleteWatchedPackage(id: string): Promise<ActionState> {
  const user = await requireOperator();
  const watched = await prisma.watchedPackage.findUnique({
    where: { id },
    select: { packageName: true },
  });
  if (!watched) return { error: "That package is already gone." };

  await prisma.watchedPackage.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "watchedPackage.delete",
      targetType: "WatchedPackage",
      targetId: id,
      meta: { packageName: watched.packageName },
    },
  });

  await hub.refreshTrackedPackages().catch(() => undefined);

  revalidatePath("/settings");
  revalidatePath("/");
  return { ok: true, message: `Stopped watching ${watched.packageName}.` };
}

/**
 * Add a version source.
 *
 * Any index in the shape the UnownHash mirror publishes works, which is why
 * this is a URL in the dashboard rather than an integration in the code. A
 * feed whose entries carry absolute `url` fields needs no base URL; one that
 * lists bare filenames does, and the Status page says so when it is missing.
 */
export async function createSourceFeed(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const name = String(formData.get("name") ?? "").trim();
  const indexUrl = String(formData.get("indexUrl") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();

  if (!name) return { error: "Give the source a name." };
  if (!isHttpUrl(indexUrl)) return { error: "The index URL must be http(s)." };
  if (baseUrl && !isHttpUrl(baseUrl)) return { error: "The base URL must be http(s)." };

  const existing = await prisma.sourceFeed.findUnique({ where: { name } });
  if (existing) return { error: `A source called "${name}" already exists.` };

  const parsedPriority = Number(formData.get("priority"));
  const last = await prisma.sourceFeed.findFirst({ orderBy: { priority: "desc" } });

  const feed = await prisma.sourceFeed.create({
    data: {
      name,
      indexUrl,
      baseUrl: baseUrl || null,
      pollMinutes: pollMinutes(formData),
      // New sources go last, so adding one never changes where existing
      // builds are downloaded from.
      priority:
        Number.isFinite(parsedPriority) && parsedPriority > 0
          ? Math.floor(parsedPriority)
          : (last?.priority ?? 0) + 100,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "sourceFeed.create",
      targetType: "SourceFeed",
      targetId: feed.id,
      meta: { name, indexUrl },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/status");
  return { ok: true, message: `Added "${name}". It is polled on the next cycle.` };
}

export async function updateSourceFeed(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const id = String(formData.get("feedId") ?? "");
  if (!id) return { error: "Missing source." };

  const indexUrl = String(formData.get("indexUrl") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  if (!isHttpUrl(indexUrl)) return { error: "The index URL must be http(s)." };
  if (baseUrl && !isHttpUrl(baseUrl)) return { error: "The base URL must be http(s)." };

  const parsedPriority = Number(formData.get("priority"));
  const enabled = formData.get("enabled") === "on";
  const minutes = pollMinutes(formData);

  const before = await prisma.sourceFeed.findUnique({
    where: { id },
    select: { indexUrl: true, baseUrl: true, enabled: true },
  });
  if (!before) return { error: "That source is already gone." };

  await prisma.sourceFeed.update({
    where: { id },
    data: {
      indexUrl,
      baseUrl: baseUrl || null,
      enabled,
      pollMinutes: minutes,
      ...(Number.isFinite(parsedPriority) && parsedPriority > 0
        ? { priority: Math.floor(parsedPriority) }
        : {}),
    },
  });

  // Where a build is downloaded from is built from these two, and it is stored
  // on the version at discovery time. Editing them and leaving every known
  // build pointing at the old URL is the kind of change that looks like it did
  // nothing — so re-poll now rather than at the top of the next interval,
  // which rewrites those URLs (and un-fails anything that failed on the old
  // one). Priority is not in here: it only decides ties between feeds and
  // changes no URL.
  const rePoint =
    before.indexUrl !== indexUrl ||
    (before.baseUrl ?? "") !== baseUrl ||
    (!before.enabled && enabled);

  // A hub that is down must not make the save look like it failed: the setting
  // is stored either way, and the scheduled poll will catch up.
  let polled = true;
  if (rePoint) {
    try {
      await hub.pollSources();
    } catch {
      polled = false;
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "sourceFeed.update",
      targetType: "SourceFeed",
      targetId: id,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/status");
  revalidatePath("/versions");
  return {
    ok: true,
    message: rePoint
      ? polled
        ? "Saved — re-checking the source now, which repoints the builds it already found."
        : "Saved, but the hub could not be reached to re-check now. Known builds keep their old URLs until the next poll."
      : "Saved.",
  };
}

/**
 * Remove a source.
 *
 * Builds it discovered stay: the .apkm may be cached and a rollout may be
 * pointing at it, so the rows simply lose their feed. What stops is the
 * polling.
 */
export async function deleteSourceFeed(id: string): Promise<ActionState> {
  const user = await requireOperator();
  const feed = await prisma.sourceFeed.findUnique({ where: { id }, select: { name: true } });
  if (!feed) return { error: "That source is already gone." };

  await prisma.sourceFeed.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "sourceFeed.delete",
      targetType: "SourceFeed",
      targetId: id,
      meta: { name: feed.name },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/status");
  return { ok: true, message: `Removed "${feed.name}".` };
}

/**
 * Mints an enrollment token. The plaintext is returned once and never stored —
 * only its hash goes in the database.
 */
export async function createEnrollmentToken(
  _prev: ActionState & { token?: string },
  formData: FormData,
): Promise<ActionState & { token?: string }> {
  const user = await requireOperator();
  const label = String(formData.get("label") ?? "").trim() || "untitled";
  const rawMaxUses = String(formData.get("maxUses") ?? "").trim();
  const parsedUses = Number(rawMaxUses);

  const token = generateToken();
  await prisma.enrollmentToken.create({
    data: {
      label,
      tokenHash: hashToken(token),
      prefix: tokenPrefix(token),
      autoApprove: formData.get("autoApprove") === "on",
      maxUses: rawMaxUses === "" ? null : Number.isFinite(parsedUses) ? parsedUses : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "enrollmentToken.create",
      meta: { label },
    },
  });

  revalidatePath("/settings");
  return { ok: true, token, message: "Copy this now — it is not shown again." };
}

export async function revokeEnrollmentToken(id: string): Promise<ActionState> {
  await requireOperator();
  await prisma.enrollmentToken.update({ where: { id }, data: { revoked: true } });
  revalidatePath("/settings");
  return { ok: true };
}
