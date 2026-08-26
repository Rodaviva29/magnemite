import { prisma } from "@magnemite/db";
import { bus } from "../bus.js";
import { env } from "../env.js";
import { log } from "../log.js";

/**
 * RotomNG integration.
 *
 * Rotom is the thing that actually knows whether a box is scanning, so it is
 * worth more here than a status widget:
 *
 *  - before an install the box is `disable`d in Rotom, so the controller stops
 *    handing it accounts instead of losing work mid-session;
 *  - afterwards it is `enable`d and the app `restart`ed, which replaces the
 *    hand-written post-install hook most people would otherwise need;
 *  - "did the update work" is then answered by the box reappearing in Rotom
 *    with live workers, not by `pm` having printed Success.
 *
 * API reference: https://github.com/UnownHash/RotomNG/blob/main/docs/RotomNG-API.md
 */

export type RotomDevice = {
  id: string;
  origin: string;
  version?: string;
  public_ip?: string;
  worker_count?: number;
  worker_in_use_count?: number;
  last_connected_at_ms?: number;
  last_seen_at_ms?: number;
  enabled?: boolean;
  is_connected?: boolean;
  can_be_used?: boolean;
  is_in_use?: boolean;
  last_memory?: { free?: number; mitm?: number; start?: number };
};

export type RotomAction =
  | "restart" // restart the scanner app
  | "reboot" // reboot the box
  | "disable"
  | "enable"
  | "disconnect"
  | "delete";

export function rotomEnabled(): boolean {
  return env.ROTOM_ENABLED && Boolean(env.ROTOM_URL);
}

function apiUrl(path: string): string {
  const base = (env.ROTOM_URL ?? "").replace(/\/$/, "");
  // Tolerate ROTOM_URL being given with or without the /api suffix.
  const root = base.endsWith("/api") ? base : `${base}/api`;
  return `${root}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.ROTOM_SECRET) headers["X-Rotom-Secret"] = env.ROTOM_SECRET;
  if (init?.body) headers["Content-Type"] = "application/json";

  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string>) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`rotom ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function listDevices(): Promise<RotomDevice[]> {
  const body = await request<{ devices?: RotomDevice[] }>("/device");
  return body.devices ?? [];
}

export async function getDevice(rotomDeviceId: string): Promise<RotomDevice | null> {
  try {
    const body = await request<{ device?: RotomDevice } | RotomDevice>(
      `/device/${encodeURIComponent(rotomDeviceId)}`,
    );
    // The single-device endpoint has been seen both wrapped and bare.
    if (body && typeof body === "object" && "device" in body) return body.device ?? null;
    return (body as RotomDevice) ?? null;
  } catch {
    return null;
  }
}

export async function deviceAction(rotomDeviceId: string, action: RotomAction): Promise<boolean> {
  try {
    await request(`/device/${encodeURIComponent(rotomDeviceId)}/action/${action}`, {
      method: "PUT",
    });
    return true;
  } catch (err) {
    log.warn({ err, rotomDeviceId, action }, "rotom action failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Syncing
// ---------------------------------------------------------------------------

/**
 * Match a Rotom device to one of ours. `origin` is whatever the box was
 * configured to call itself, so try the obvious identities first and only then
 * fall back to the public IP — and only when it is unambiguous.
 */
function matchDevice(
  rotom: RotomDevice,
  ours: {
    id: string;
    name: string;
    serial: string;
    publicIp: string | null;
    rotomOrigin: string | null;
  }[],
): string | null {
  const origin = rotom.origin;
  const byOrigin =
    ours.find((d) => d.rotomOrigin === origin) ??
    ours.find((d) => d.name === origin) ??
    ours.find((d) => d.serial === origin) ??
    ours.find((d) => d.name.toLowerCase() === origin?.toLowerCase());
  if (byOrigin) return byOrigin.id;

  if (rotom.public_ip) {
    const byIp = ours.filter((d) => d.publicIp === rotom.public_ip);
    // Several boxes behind one NAT share a public IP, so this only decides it
    // when exactly one candidate exists.
    if (byIp.length === 1) return byIp[0]!.id;
  }
  return null;
}

export async function syncDevices(): Promise<{ seen: number; matched: number }> {
  if (!rotomEnabled()) return { seen: 0, matched: 0 };

  let devices: RotomDevice[];
  try {
    devices = await listDevices();
  } catch (err) {
    log.warn({ err, url: env.ROTOM_URL }, "rotom poll failed");
    return { seen: 0, matched: 0 };
  }

  const ours = await prisma.device.findMany({
    select: { id: true, name: true, serial: true, publicIp: true, rotomOrigin: true },
  });

  const matchedIds = new Set<string>();
  for (const rotomDevice of devices) {
    const deviceId = matchDevice(rotomDevice, ours);
    if (!deviceId) continue;
    matchedIds.add(deviceId);

    await prisma.device.update({
      where: { id: deviceId },
      data: {
        rotomOrigin: rotomDevice.origin,
        rotomDeviceId: rotomDevice.id,
        rotomConnected: Boolean(rotomDevice.is_connected),
        rotomWorkerCount: rotomDevice.worker_count ?? null,
        rotomLastSeenAt: rotomDevice.last_seen_at_ms ? new Date(rotomDevice.last_seen_at_ms) : null,
      },
    });
    bus.publish({ kind: "device", deviceId });
  }

  // A box Rotom no longer lists is not scanning, whatever we last recorded.
  const stale = await prisma.device.findMany({
    where: { rotomConnected: true, id: { notIn: [...matchedIds] } },
    select: { id: true },
  });
  for (const device of stale) {
    await prisma.device.update({ where: { id: device.id }, data: { rotomConnected: false } });
    bus.publish({ kind: "device", deviceId: device.id });
  }

  log.debug({ seen: devices.length, matched: matchedIds.size }, "rotom sync");
  return { seen: devices.length, matched: matchedIds.size };
}

// ---------------------------------------------------------------------------
// Install lifecycle
// ---------------------------------------------------------------------------

/**
 * Take the box out of the scanning pool before an install. Returns true when
 * Rotom accepted it, so the caller knows whether there is anything to undo.
 */
export async function pauseForInstall(deviceId: string, jobId: string): Promise<boolean> {
  if (!rotomEnabled()) return false;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { rotomDeviceId: true },
  });
  if (!device?.rotomDeviceId) return false;

  const ok = await deviceAction(device.rotomDeviceId, "disable");
  if (ok) {
    await prisma.device.update({ where: { id: deviceId }, data: { rotomDisabledBy: jobId } });
  }
  return ok;
}

/**
 * Put the box back to work: re-enable it and restart the scanner onto the
 * freshly installed build.
 */
export async function resumeAfterInstall(
  deviceId: string,
  jobId: string,
  opts: { restartApp: boolean },
): Promise<boolean> {
  if (!rotomEnabled()) return false;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { rotomDeviceId: true, rotomDisabledBy: true },
  });
  if (!device?.rotomDeviceId) return false;
  // Only undo what this job did, so two jobs cannot re-enable each other's box.
  if (device.rotomDisabledBy && device.rotomDisabledBy !== jobId) return false;

  const enabled = await deviceAction(device.rotomDeviceId, "enable");
  if (opts.restartApp) await deviceAction(device.rotomDeviceId, "restart");

  await prisma.device.update({ where: { id: deviceId }, data: { rotomDisabledBy: null } });
  return enabled;
}

/**
 * Wait for the box to show up in Rotom again with a live worker. This is the
 * end-to-end proof that the update left a working scanner behind.
 */
export async function confirmScanning(
  deviceId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean | null> {
  if (!rotomEnabled()) return null;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { rotomDeviceId: true },
  });
  if (!device?.rotomDeviceId) return null;

  const timeout = opts.timeoutMs ?? 5 * 60_000;
  const interval = opts.intervalMs ?? 20_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const rotomDevice = await getDevice(device.rotomDeviceId);
    if (rotomDevice?.is_connected && (rotomDevice.worker_count ?? 0) > 0) {
      await prisma.device.update({
        where: { id: deviceId },
        data: { rotomConnected: true, rotomWorkerCount: rotomDevice.worker_count ?? null },
      });
      bus.publish({ kind: "device", deviceId });
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

/**
 * Safety net: re-enable any box we disabled for a job that is no longer
 * running. Without this, a hub restart mid-install would leave the box parked
 * out of the scanning pool indefinitely.
 */
export async function releaseOrphanedDevices(): Promise<number> {
  if (!rotomEnabled()) return 0;

  const parked = await prisma.device.findMany({
    where: { rotomDisabledBy: { not: null } },
    select: { id: true, rotomDeviceId: true, rotomDisabledBy: true, name: true },
  });
  if (parked.length === 0) return 0;

  let released = 0;
  for (const device of parked) {
    const job = await prisma.job.findUnique({
      where: { id: device.rotomDisabledBy! },
      select: { state: true },
    });
    const stillRunning =
      job &&
      ["QUEUED", "DISPATCHED", "DOWNLOADING", "EXTRACTING", "INSTALLING", "VERIFYING"].includes(
        job.state,
      );
    if (stillRunning) continue;

    if (device.rotomDeviceId) await deviceAction(device.rotomDeviceId, "enable");
    await prisma.device.update({ where: { id: device.id }, data: { rotomDisabledBy: null } });
    released += 1;
    log.warn({ device: device.name }, "re-enabled a box left disabled in rotom");
  }
  return released;
}
