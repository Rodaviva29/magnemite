"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import type { ActionState } from "./rollouts";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function setDeviceApproval(deviceId: string, approved: boolean): Promise<ActionState> {
  const user = await requireOperator();
  await prisma.device.update({ where: { id: deviceId }, data: { approved } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: approved ? "device.approve" : "device.unapprove",
      targetType: "Device",
      targetId: deviceId,
    },
  });
  revalidatePath("/");
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true };
}

export async function renameDevice(deviceId: string, name: string): Promise<ActionState> {
  await requireOperator();
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name cannot be empty." };
  await prisma.device.update({ where: { id: deviceId }, data: { name: trimmed } });
  revalidatePath("/");
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true };
}

export async function setDeviceGroup(deviceId: string, groupId: string): Promise<ActionState> {
  await requireOperator();
  await prisma.device.update({
    where: { id: deviceId },
    data: { groupId: groupId || null },
  });
  revalidatePath("/");
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true };
}

export async function rebootDevice(deviceId: string): Promise<ActionState> {
  const user = await requireOperator();
  try {
    await hub.rebootDevice(deviceId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.reboot",
      targetType: "Device",
      targetId: deviceId,
    },
  });
  return { ok: true, message: "Reboot sent." };
}

/**
 * Run a command on the box and return what it printed.
 *
 * This is a root shell on someone's living-room hardware, so it is operators
 * only and every invocation goes in the audit log with the command itself —
 * the same footing as the pre/post-install hooks, which have always been able
 * to run anything.
 */
export async function execOnDevice(
  deviceId: string,
  command: string,
): Promise<ActionState & { output?: string; failed?: boolean }> {
  const user = await requireOperator();
  const trimmed = command.trim();
  if (!trimmed) return { error: "Nothing to run." };

  let result: { ok: boolean; output: string; error: string | null };
  try {
    result = await hub.execOnDevice(deviceId, trimmed);
  } catch (err) {
    return { error: toMessage(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.exec",
      targetType: "Device",
      targetId: deviceId,
      meta: { command: trimmed, ok: result.ok },
    },
  });

  return {
    ok: true,
    failed: !result.ok,
    output: result.output,
    message: result.ok ? "Command ran." : (result.error ?? "The command failed."),
  };
}

/**
 * Collect the box's logs and hand back the bundle to download.
 *
 * The call blocks while the box zips and uploads — usually a few seconds — so
 * the caller gets either a bundle id it can send the browser to, or the reason
 * there is none. Nothing to poll.
 */
export async function collectDeviceLogs(
  deviceId: string,
): Promise<ActionState & { bundleId?: string }> {
  const user = await requireOperator();
  let bundleId: string;
  try {
    ({ bundleId } = await hub.collectDeviceLogs(deviceId, user.id));
  } catch (err) {
    return { error: toMessage(err) };
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.logs",
      targetType: "Device",
      targetId: deviceId,
      meta: { bundleId },
    },
  });

  return { ok: true, bundleId };
}

/**
 * Rotom-side control. `restart` is the useful one day to day: it kicks the
 * scanner app without rebooting the whole box.
 */
export async function rotomDeviceAction(
  deviceId: string,
  action: "restart" | "reboot" | "enable" | "disable",
): Promise<ActionState> {
  const user = await requireOperator();
  try {
    await hub.rotomDeviceAction(deviceId, action);
  } catch (err) {
    return { error: toMessage(err) };
  }
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: `rotom.${action}`,
      targetType: "Device",
      targetId: deviceId,
    },
  });
  revalidatePath(`/devices/${deviceId}`);
  return { ok: true, message: `Rotom: ${action} sent.` };
}

export async function syncRotom(): Promise<ActionState> {
  await requireOperator();
  try {
    const { seen, matched } = await hub.rotomSync();
    revalidatePath("/");
    return { ok: true, message: `Rotom knows ${seen} device(s); ${matched} matched.` };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

/**
 * Removing a device drops its token, so the box goes quiet until it is
 * re-enrolled. Its job history goes with it.
 */
export async function deleteDevice(deviceId: string): Promise<ActionState> {
  const user = await requireOperator();
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return { error: "Device not found." };

  await prisma.device.delete({ where: { id: deviceId } });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "device.delete",
      targetType: "Device",
      targetId: deviceId,
      meta: { serial: device.serial, name: device.name },
    },
  });
  revalidatePath("/");
  return { ok: true };
}
