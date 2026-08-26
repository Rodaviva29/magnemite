"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import type { ActionState } from "./rollouts";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Pull the .apkm onto the VPS. Devices only ever download from here. */
export async function cacheVersion(versionId: string): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.cacheVersion(versionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath("/versions");
  return { ok: true, message: "Download started." };
}

export async function setVersionApproval(
  versionId: string,
  approved: boolean,
): Promise<ActionState> {
  const user = await requireOperator();
  await prisma.appVersion.update({ where: { id: versionId }, data: { approved } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: approved ? "version.approve" : "version.unapprove",
      targetType: "AppVersion",
      targetId: versionId,
    },
  });
  revalidatePath("/versions");
  return { ok: true };
}

export async function pollSources(): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.pollSources();
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath("/versions");
  return { ok: true, message: "Checking both sources." };
}

export async function pruneVersions(keepLatest: number): Promise<ActionState> {
  await requireOperator();
  try {
    const { removed } = await hub.pruneVersions(keepLatest);
    revalidatePath("/versions");
    return { ok: true, message: `Freed ${removed} cached bundle(s).` };
  } catch (err) {
    return { error: toMessage(err) };
  }
}
