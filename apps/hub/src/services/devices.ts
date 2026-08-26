import type { deviceInfoSchema, deviceMetricsSchema } from "@magnemite/protocol";
import type { z } from "zod";
import { prisma } from "@magnemite/db";
import { bus } from "../bus.js";
import { log } from "../log.js";

type DeviceInfo = z.infer<typeof deviceInfoSchema>;
type DeviceMetrics = z.infer<typeof deviceMetricsSchema>;

function toBigInt(value: number | string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(typeof value === "number" ? Math.trunc(value) : value);
  } catch {
    return null;
  }
}

export async function markOnline(
  deviceId: string,
  opts: { agentVersion: string; publicIp: string | null; info: DeviceInfo },
) {
  await prisma.device.update({
    where: { id: deviceId },
    data: {
      status: "ONLINE",
      lastSeenAt: new Date(),
      agentVersion: opts.agentVersion,
      publicIp: opts.publicIp,
      manufacturer: opts.info.manufacturer ?? undefined,
      model: opts.info.model ?? undefined,
      androidVersion: opts.info.androidVersion ?? undefined,
      sdkInt: opts.info.sdkInt ?? undefined,
      abi: opts.info.abi ?? undefined,
    },
  });
  bus.publish({ kind: "device", deviceId });
}

export async function markOffline(deviceId: string) {
  await prisma.device
    .update({ where: { id: deviceId }, data: { status: "OFFLINE" } })
    .catch(() => undefined);
  bus.publish({ kind: "device", deviceId });
}

export async function applyMetrics(deviceId: string, metrics: DeviceMetrics) {
  await prisma.device.update({
    where: { id: deviceId },
    data: {
      lastSeenAt: new Date(),
      status: "ONLINE",
      freeBytes: toBigInt(metrics.freeBytes),
      totalBytes: toBigInt(metrics.totalBytes),
      uptimeSeconds: metrics.uptimeSeconds ?? null,
    },
  });

  for (const pkg of metrics.packages) {
    const data = {
      versionName: pkg.versionName ?? null,
      versionCode: toBigInt(pkg.versionCode),
      installed: pkg.installed,
    };
    await prisma.devicePackage.upsert({
      where: { deviceId_packageName: { deviceId, packageName: pkg.packageName } },
      update: data,
      create: { deviceId, packageName: pkg.packageName, ...data },
    });
  }

  bus.publish({ kind: "device", deviceId });
}

/**
 * Safety net for sockets that die without a close frame — a box losing power
 * mid-heartbeat leaves the TCP connection hanging until the OS times it out.
 */
export async function sweepOffline(timeoutSeconds: number) {
  const cutoff = new Date(Date.now() - timeoutSeconds * 1000);
  const stale = await prisma.device.findMany({
    where: { status: "ONLINE", OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null }] },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  await prisma.device.updateMany({
    where: { id: { in: stale.map((d) => d.id) } },
    data: { status: "OFFLINE" },
  });
  for (const d of stale) bus.publish({ kind: "device", deviceId: d.id });
  log.info({ count: stale.length }, "marked devices offline");
  return stale.length;
}

/** Packages the agent should report on every heartbeat. */
export async function trackedPackages(): Promise<string[]> {
  const targets = await prisma.appTarget.findMany({
    where: { enabled: true },
    select: { packageName: true },
  });
  return targets.map((t) => t.packageName);
}
