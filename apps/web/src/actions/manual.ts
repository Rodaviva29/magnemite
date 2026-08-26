"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";

export type ManualInstallInput = {
  appVersionId: string;
  deviceIds: string[];
  preInstallHook: string | null;
  postInstallHook: string | null;
  forceClean: boolean;
  skipUpToDate: boolean;
  maxConcurrency: number | null;
  note: string | null;
};

export type ManualInstallResult = { rolloutId?: string; error?: string };

/**
 * Install an uploaded build on a chosen set of boxes.
 *
 * It is a normal rollout — same jobs, same retries, same page to watch it on.
 * What is different is where the artifact came from and that the hooks travel
 * with the rollout instead of coming off the device's group.
 */
export async function startManualInstall(input: ManualInstallInput): Promise<ManualInstallResult> {
  const user = await requireOperator();

  if (!input.appVersionId) return { error: "Upload or pick a build first." };
  if (input.deviceIds.length === 0) return { error: "Pick at least one device." };

  let rolloutId: string;
  try {
    const result = await hub.createRollout({
      appVersionId: input.appVersionId,
      deviceIds: input.deviceIds,
      forceClean: input.forceClean,
      skipUpToDate: input.skipUpToDate,
      preInstallHook: input.preInstallHook,
      postInstallHook: input.postInstallHook,
      maxConcurrency: input.maxConcurrency,
      createdById: user.id,
      note: input.note,
    });
    rolloutId = result.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "rollout.manual",
      targetType: "Rollout",
      targetId: rolloutId,
      meta: { appVersionId: input.appVersionId, devices: input.deviceIds.length },
    },
  });

  revalidatePath("/");
  revalidatePath("/rollouts");
  revalidatePath("/manual");
  return { rolloutId };
}

/**
 * Forget an uploaded build. The artifact stays on disk — `Free old bundles` on
 * the Versions page is what reclaims space — but it stops being offered here.
 */
export async function deleteManualVersion(appVersionId: string): Promise<{ error?: string }> {
  await requireOperator();

  const version = await prisma.appVersion.findUnique({
    where: { id: appVersionId },
    include: { _count: { select: { rollouts: true } } },
  });
  if (!version) return { error: "That build no longer exists." };
  if (version.source !== "MANUAL") return { error: "Only uploaded builds can be removed here." };
  if (version._count.rollouts > 0) {
    return { error: "This build has rollouts pointing at it — cancel or keep them instead." };
  }

  await prisma.appVersion.delete({ where: { id: appVersionId } });
  revalidatePath("/manual");
  return {};
}
