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
      // Only the agent knows the box's LAN address; keep whatever we had if an
      // older agent does not report one.
      localIp: opts.info.localIp ?? undefined,
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
  // Only the agent knows whether it sent the whole inventory or just the
  // tracked apps, and it says so. Counting packages would be wrong the moment
  // a second app is tracked.
  const isInventory = metrics.packagesComplete === true;

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      lastSeenAt: new Date(),
      status: "ONLINE",
      freeBytes: toBigInt(metrics.freeBytes),
      totalBytes: toBigInt(metrics.totalBytes),
      uptimeSeconds: metrics.uptimeSeconds ?? null,
      // Undefined rather than null when absent: an older agent that does not
      // send these must not wipe what a newer one already reported.
      loadAvg1: metrics.loadAvg1 ?? undefined,
      loadAvg5: metrics.loadAvg5 ?? undefined,
      loadAvg15: metrics.loadAvg15 ?? undefined,
      cpuCount: metrics.cpuCount ?? undefined,
      memTotalBytes: toBigInt(metrics.memTotalBytes) ?? undefined,
      memAvailableBytes: toBigInt(metrics.memAvailableBytes) ?? undefined,
      ...(isInventory ? { packagesSyncedAt: new Date() } : {}),
    },
  });

  // Every box in the fleet beats every 20 seconds, so this runs constantly:
  // read the rows once and write only the ones that actually changed, rather
  // than firing an upsert per package per beat.
  const existing = await prisma.devicePackage.findMany({
    where: { deviceId },
    select: { packageName: true, versionName: true, versionCode: true, installed: true },
  });
  const current = new Map(existing.map((row) => [row.packageName, row]));

  for (const pkg of metrics.packages) {
    const versionCode = toBigInt(pkg.versionCode);
    const was = current.get(pkg.packageName);

    // The inventory has no versionName — only `pm list` ran, not dumpsys — so
    // a missing one keeps whatever the tracked read last established.
    const versionName = pkg.versionName ?? was?.versionName ?? null;

    if (
      was &&
      was.versionName === versionName &&
      was.versionCode === (versionCode ?? was.versionCode) &&
      was.installed === pkg.installed
    ) {
      continue;
    }

    const data = {
      versionName,
      versionCode: versionCode ?? was?.versionCode ?? null,
      installed: pkg.installed,
    };
    await prisma.devicePackage.upsert({
      where: { deviceId_packageName: { deviceId, packageName: pkg.packageName } },
      update: data,
      create: { deviceId, packageName: pkg.packageName, ...data },
    });
  }

  // Something the box no longer has is worth showing as gone, but only an
  // inventory is evidence of that.
  if (isInventory) {
    const reported = new Set(metrics.packages.map((p) => p.packageName));
    const vanished = existing
      .filter((row) => row.installed && !reported.has(row.packageName))
      .map((row) => row.packageName);

    if (vanished.length > 0) {
      await prisma.devicePackage.updateMany({
        where: { deviceId, packageName: { in: vanished } },
        data: { installed: false },
      });
    }
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
