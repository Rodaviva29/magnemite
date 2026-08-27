"use server";

import { revalidatePath } from "next/cache";
import { generateToken, hashToken, prisma, tokenPrefix } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import type { ActionState } from "./rollouts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Auto-update policy for one app target. */
export async function updateAutoUpdate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const id = String(formData.get("appTargetId") ?? "");
  if (!id) return { error: "Missing app target." };

  const windowStart = String(formData.get("windowStart") ?? "").trim();
  const windowEnd = String(formData.get("windowEnd") ?? "").trim();
  if (windowStart && !TIME_RE.test(windowStart)) return { error: "Start time must be HH:MM." };
  if (windowEnd && !TIME_RE.test(windowEnd)) return { error: "End time must be HH:MM." };
  if (Boolean(windowStart) !== Boolean(windowEnd)) {
    return { error: "Set both ends of the window, or neither." };
  }

  const int = (name: string, fallback: number) => {
    const parsed = Number(formData.get(name));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
  };

  await prisma.appTarget.update({
    where: { id },
    data: {
      autoUpdateEnabled: formData.get("autoUpdateEnabled") === "on",
      autoApprove: formData.get("autoApprove") === "on",
      canaryCount: int("canaryCount", 1),
      soakMinutes: int("soakMinutes", 30),
      maxAttempts: Math.max(1, int("maxAttempts", 3)),
      windowStart: windowStart || null,
      windowEnd: windowEnd || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "settings.autoUpdate",
      targetType: "AppTarget",
      targetId: id,
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
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

/** Same shape the hub validates uploads against. */
const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

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

  await prisma.sourceFeed.update({
    where: { id },
    data: {
      indexUrl,
      baseUrl: baseUrl || null,
      enabled: formData.get("enabled") === "on",
      ...(Number.isFinite(parsedPriority) && parsedPriority > 0
        ? { priority: Math.floor(parsedPriority) }
        : {}),
    },
  });

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
  return { ok: true, message: "Saved." };
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
