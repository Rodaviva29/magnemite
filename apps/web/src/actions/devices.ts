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
