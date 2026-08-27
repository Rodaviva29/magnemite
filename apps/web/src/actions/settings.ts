"use server";

import { revalidatePath } from "next/cache";
import { generateToken, hashToken, prisma, tokenPrefix } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
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
