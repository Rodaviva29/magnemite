"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";

export type ActionState = { ok?: boolean; error?: string; message?: string };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Kick off a rollout from the fleet page. An empty device list means every
 * approved device, which is what the "update all" button sends.
 */
export async function startRollout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireOperator();

  const appVersionId = String(formData.get("appVersionId") ?? "");
  if (!appVersionId) return { error: "Pick a version first." };

  const deviceIds = String(formData.get("deviceIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const number = (name: string, fallback: number) => {
    const raw = formData.get(name);
    const parsed = Number(raw);
    return raw === null || raw === "" || Number.isNaN(parsed) ? fallback : parsed;
  };

  let rolloutId: string;
  try {
    const result = await hub.createRollout({
      appVersionId,
      deviceIds: deviceIds.length > 0 ? deviceIds : undefined,
      forceClean: formData.get("forceClean") === "on",
      // An unticked checkbox sends nothing at all, so absence is what "off"
      // looks like here — the old `!== "off"` test read a missing field as
      // on, which made unticking this do nothing.
      skipUpToDate: formData.get("skipUpToDate") === "on",
      canaryCount: number("canaryCount", 0),
      soakMinutes: number("soakMinutes", 0),
      maxAttempts: number("maxAttempts", 3),
      retryBackoffSeconds: number("retryBackoffSeconds", 60),
      createdById: user.id,
      note: (formData.get("note") as string) || null,
    });
    rolloutId = result.id;
  } catch (err) {
    return { error: toMessage(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "rollout.create",
      targetType: "Rollout",
      targetId: rolloutId,
      meta: { appVersionId, devices: deviceIds.length || "all" },
    },
  });

  revalidatePath("/");
  revalidatePath("/rollouts");
  redirect(`/rollouts/${rolloutId}`);
}

export async function cancelRolloutAction(rolloutId: string): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.cancelRollout(rolloutId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/rollouts/${rolloutId}`);
  revalidatePath("/rollouts");
  return { ok: true };
}

/** Used after a canary failure, when the operator decides to push on anyway. */
export async function resumeRolloutAction(rolloutId: string): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.resumeRollout(rolloutId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/rollouts/${rolloutId}`);
  return { ok: true };
}

export async function retryFailedAction(rolloutId: string): Promise<ActionState> {
  await requireOperator();
  try {
    const { retried } = await hub.retryFailed(rolloutId);
    revalidatePath(`/rollouts/${rolloutId}`);
    return { ok: true, message: `${retried} job(s) re-queued` };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function retryJobAction(jobId: string, rolloutId: string): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.retryJob(jobId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/rollouts/${rolloutId}`);
  return { ok: true };
}

export async function cancelJobAction(jobId: string, rolloutId: string): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.cancelJob(jobId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/rollouts/${rolloutId}`);
  return { ok: true };
}
