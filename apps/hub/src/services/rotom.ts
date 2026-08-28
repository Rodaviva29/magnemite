import { prisma } from "@magnemite/db";
import { bus } from "../bus.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { getMonitorSettings } from "./hubSettings.js";

/**
 * RotomNG integration.
 *
 * Rotom is the thing that actually knows whether a box is scanning, which
 * makes it a health signal Magnemite cannot produce on its own — a box can be
 * online, heartbeating, and handing Rotom nothing.
 *
 * That is now the whole of it. Rotom used to be wired into installs as well:
 * the box was disabled before one and re-enabled after, and "did the update
 * work" was answered by it reappearing with live workers. That coupling is
 * gone. It made every rollout depend on a second service being reachable and
 * agreeing, and the install pipeline has its own verification. What is left is
 * three things, all read-only or operator-driven:
 *
 *  - `syncDevices` keeps each box's scanning state current, on the interval
 *    set in Settings → Hub;
 *  - monitoring reads that state as the `ROTOM_DISCONNECTED` signal, and can
 *    `restart` a scanner as a remediation;
 *  - the device page offers the same actions by hand.
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

/**
 * BasicAuth for a reverse proxy sitting in front of Rotom, from
 * `ROTOM_BASIC_USERNAME` / `ROTOM_BASIC_PASSWORD`.
 *
 * This is a separate axis from `ROTOM_SECRET`, not an alternative spelling of
 * it: the proxy checks `Authorization`, Rotom checks `X-Rotom-Secret`, and a
 * Rotom published behind a gated proxy checks both. Whatever is set gets sent,
 * so all three shapes work without a mode flag to get wrong.
 *
 * A username with no password is a real configuration (BasicAuth allows an
 * empty password), so only a missing username means "not configured".
 */
export function rotomBasicAuthHeader(): string | null {
  const username = env.ROTOM_BASIC_USERNAME;
  if (!username) return null;
  const password = env.ROTOM_BASIC_PASSWORD ?? "";
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
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
  const basic = rotomBasicAuthHeader();
  if (basic) headers["Authorization"] = basic;
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
        // Rotom has no single "healthy" field; the composite is
        // enabled && is_connected && can_be_used. These two are the half that
        // was not stored, and without them a box somebody disabled in Rotom on
        // purpose is indistinguishable from one Rotom lost — which is the
        // difference between an alert worth having and an alert about a
        // decision that was already made. Absent means true for `enabled`,
        // since a Rotom too old to report it has no way to be disabled either.
        rotomEnabled: rotomDevice.enabled ?? true,
        rotomCanBeUsed: Boolean(rotomDevice.can_be_used),
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
    await prisma.device.update({
      where: { id: device.id },
      data: { rotomConnected: false, rotomCanBeUsed: false },
    });
    bus.publish({ kind: "device", deviceId: device.id });
  }

  log.debug({ seen: devices.length, matched: matchedIds.size }, "rotom sync");
  return { seen: devices.length, matched: matchedIds.size };
}

// ---------------------------------------------------------------------------
// The sync loop
// ---------------------------------------------------------------------------

/**
 * How often the interval itself is reconsidered. The same shape the source
 * poller uses, and for the same reason: the period is a live setting, so a
 * fixed `setInterval` set up at boot would keep the old one until a restart.
 */
const CHECK_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;
let lastSyncedAt = 0;

async function maybeSync() {
  // Behind `void maybeSync()`, so anything that escapes here — reading the
  // settings included — would be an unhandled rejection.
  try {
    const settings = await getMonitorSettings();
    if (Date.now() - lastSyncedAt < settings.rotomSyncSeconds * 1000) return;
    lastSyncedAt = Date.now();
    await syncDevices();
  } catch (err) {
    log.error({ err }, "rotom sync failed");
  }
}

export function startRotomSync(): void {
  if (timer) return;
  // The timer runs whether or not Rotom is configured: `syncDevices` returns
  // immediately when it is not, and starting it unconditionally means turning
  // the integration on is one restart rather than a special case here.
  timer = setInterval(() => void maybeSync(), CHECK_INTERVAL_MS);
  if (!rotomEnabled()) return;

  log.info({ url: env.ROTOM_URL }, "rotom integration enabled");
  // Once up front, so the Scanner column is populated on a fresh hub rather
  // than after the first interval.
  void maybeSync();
}

export function stopRotomSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
