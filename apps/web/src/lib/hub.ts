import "server-only";

/**
 * Client for the hub's /internal API. Reads go straight to the database from
 * the server components; this is only for the things that need a live socket or
 * the scheduler — starting a rollout, cancelling a job, rebooting a box.
 */
const HUB_URL = process.env.HUB_URL ?? "http://localhost:3001";
const SECRET = process.env.HUB_INTERNAL_SECRET ?? "";

export class HubError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${HUB_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-magnemite-secret": SECRET,
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch (err) {
    throw new HubError(
      `The hub is not reachable at ${HUB_URL}. Is the hub container running? (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new HubError(
      typeof payload.error === "string" ? payload.error : `hub: HTTP ${res.status}`,
    );
  }
  return payload as T;
}

export type CreateRolloutInput = {
  appVersionId: string;
  deviceIds?: string[];
  forceClean?: boolean;
  /** Override the device group's hooks for this rollout only. */
  preInstallHook?: string | null;
  postInstallHook?: string | null;
  canaryCount?: number;
  soakMinutes?: number;
  maxConcurrency?: number | null;
  maxAttempts?: number;
  skipUpToDate?: boolean;
  createdById?: string | null;
  note?: string | null;
};

/** Mirrors the shape built by the hub's services/health.ts. */
export type IntegrationState = "OK" | "DEGRADED" | "DOWN" | "OFF";

export type IntegrationCheck = {
  key: string;
  label: string;
  summary: string;
  state: IntegrationState;
  latencyMs: number | null;
  facts: { label: string; value: string }[];
  detail: string | null;
  link: string | null;
};

export type HubHealth = {
  checkedAt: string;
  overall: IntegrationState;
  checks: IntegrationCheck[];
};

export const hub = {
  status: () =>
    call<{ online: number; onlineDeviceIds: string[]; maxConcurrentJobs: number }>(
      "/internal/status",
    ),
  createRollout: (input: CreateRolloutInput) =>
    call<{ id: string; jobs: number }>("/internal/rollouts", input),
  cancelRollout: (id: string) => call(`/internal/rollouts/${id}/cancel`),
  resumeRollout: (id: string) => call(`/internal/rollouts/${id}/resume`),
  retryFailed: (id: string) => call<{ retried: number }>(`/internal/rollouts/${id}/retry-failed`),
  retryJob: (id: string) => call(`/internal/jobs/${id}/retry`),
  cancelJob: (id: string) => call(`/internal/jobs/${id}/cancel`),
  rebootDevice: (id: string) => call(`/internal/devices/${id}/reboot`),
  /**
   * Ask a box for its logs. This one waits: the hub holds the request open
   * until the zip lands, so the caller comes straight back with something to
   * download. Two minutes at worst, and then it fails.
   */
  collectDeviceLogs: (id: string, requestedById: string | null) =>
    call<{ bundleId: string }>(`/internal/devices/${id}/logs`, { requestedById }),
  /** Run a command on the box, as root, and get back what it printed. */
  execOnDevice: (id: string, command: string, timeoutSeconds?: number) =>
    call<{ ok: boolean; output: string; error: string | null }>(`/internal/devices/${id}/exec`, {
      command,
      timeoutSeconds,
    }),
  /** Rotom-side control: restart the scanner, or take a box in/out of the pool. */
  rotomDeviceAction: (id: string, action: "restart" | "reboot" | "enable" | "disable") =>
    call(`/internal/devices/${id}/rotom/${action}`),
  rotomSync: () => call<{ seen: number; matched: number }>("/internal/rotom/sync"),
  /** Push a changed watched-package list to every connected box. */
  refreshTrackedPackages: () => call<{ sent: number }>("/internal/tracked-packages/refresh"),
  cacheVersion: (id: string) => call(`/internal/versions/${id}/cache`),
  pruneVersions: (keepLatest?: number) =>
    call<{ removed: number }>("/internal/versions/prune", { keepLatest }),
  pollSources: () => call("/internal/sources/poll"),
  /** Integration probes for the Status page. `force` skips the hub's cache. */
  health: (force = false) => call<HubHealth>("/internal/health", { force }),
};

export const HUB_BASE_URL = HUB_URL;
export const HUB_SECRET = SECRET;
