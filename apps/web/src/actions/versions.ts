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

  let result: Awaited<ReturnType<typeof hub.pollSources>>;
  try {
    // The hub runs the poll before answering, so this waits for real work and
    // comes back with what was found rather than "started".
    result = await hub.pollSources();
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath("/versions");

  if (!result.ran) {
    return { ok: true, message: "A check was already running — it will finish on its own." };
  }

  const checked = `Checked ${result.feeds} source${result.feeds === 1 ? "" : "s"} across ${result.targets} app${result.targets === 1 ? "" : "s"}`;
  // "Nothing new" on its own reads identically whether the feeds returned 40
  // builds you already had or nothing at all, which is the difference between
  // working and broken. So the count of what was listed comes first.
  const listed = `${result.listed} build${result.listed === 1 ? "" : "s"} listed`;
  const found =
    result.discovered === 0
      ? "none of them new"
      : `${result.discovered} new version${result.discovered === 1 ? "" : "s"}`;

  if (result.errors.length > 0) {
    // A feed that is down is the thing worth reading, so it wins the message
    // over the count that did work.
    const failed = result.errors.map((e) => `${e.feed} (${e.error})`).join("; ");
    return { ok: true, message: `${checked} — ${listed}, ${found}. Failed: ${failed}` };
  }

  return { ok: true, message: `${checked} — ${listed}, ${found}.` };
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
