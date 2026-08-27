import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@magnemite/db";
import { env } from "../env.js";
import { log } from "../log.js";
import { connectionCount } from "../registry.js";
import { agentTargetVersion, agentUpdatesInFlight } from "./agentRelease.js";
import { listDevices, rotomEnabled } from "./rotom.js";
import { getPollStats } from "./sources/poller.js";
import { compareVersions } from "./sources/types.js";

/**
 * "Is every moving part still talking to us" — one probe per integration,
 * answered live rather than read out of the database.
 *
 * `OFF` is deliberately not a failure: a fleet with no Rotom and no GitHub
 * repo is a perfectly healthy fleet, and painting those cards red would only
 * teach people to ignore the page.
 */
export type IntegrationState = "OK" | "DEGRADED" | "DOWN" | "OFF";

export type IntegrationFact = { label: string; value: string };

export type IntegrationCheck = {
  key: string;
  label: string;
  /** One line under the title, always present. */
  summary: string;
  state: IntegrationState;
  /** Round trip of the probe itself, when the probe made a call. */
  latencyMs: number | null;
  facts: IntegrationFact[];
  /** Error text when something failed, for the operator to act on. */
  detail: string | null;
  /** Where to go to look at the thing itself. */
  link: string | null;
};

export type HubHealth = {
  checkedAt: string;
  /** The worst state among the checks that are not OFF. */
  overall: IntegrationState;
  checks: IntegrationCheck[];
};

/**
 * Probes are cached. The dashboard re-renders on every fleet event, and
 * GitHub's hourly budget is not something to spend on repaints — the page's
 * own "Check again" button is what forces a fresh round.
 */
const CACHE_MS = 30_000;
let cached: { at: number; value: HubHealth } | null = null;

const RANK: Record<IntegrationState, number> = { OK: 0, OFF: 0, DEGRADED: 1, DOWN: 2 };

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = Date.now();
  const value = await fn();
  return { ms: Date.now() - started, value };
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function checkHub(): IntegrationCheck {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const agentTarget = agentTargetVersion();
  const updating = agentUpdatesInFlight();

  return {
    key: "hub",
    label: "Hub",
    summary: `Running for ${hours > 0 ? `${hours}h ` : ""}${minutes}m`,
    state: "OK",
    latencyMs: null,
    facts: [
      { label: "Device sockets", value: String(connectionCount()) },
      { label: "Concurrent installs", value: String(env.MAX_CONCURRENT_JOBS) },
      { label: "Source poll", value: `every ${env.SOURCE_POLL_MINUTES} min` },
      { label: "Artifacts served by", value: env.SERVE_ARTIFACTS ? "hub (Node)" : "edge (Caddy)" },
      {
        label: "Agent target",
        value: agentTarget
          ? `${agentTarget}${updating > 0 ? ` · ${updating} updating` : ""}`
          : "auto-update off",
      },
    ],
    detail: null,
    link: null,
  };
}

async function checkDatabase(): Promise<IntegrationCheck> {
  try {
    const { ms } = await timed(() => prisma.$queryRaw`SELECT 1`);
    const [devices, versions, jobs] = await Promise.all([
      prisma.device.count(),
      prisma.appVersion.count(),
      prisma.job.count(),
    ]);

    return {
      key: "database",
      label: "Database",
      summary: `Postgres answering in ${ms} ms`,
      state: ms > 500 ? "DEGRADED" : "OK",
      latencyMs: ms,
      facts: [
        { label: "Devices", value: String(devices) },
        { label: "Versions", value: String(versions) },
        { label: "Jobs", value: String(jobs) },
      ],
      detail: null,
      link: null,
    };
  } catch (err) {
    return {
      key: "database",
      label: "Database",
      summary: "Postgres is not answering",
      state: "DOWN",
      latencyMs: null,
      facts: [],
      detail: message(err),
      link: null,
    };
  }
}

async function checkArtifacts(): Promise<IntegrationCheck> {
  try {
    const entries = await fs.readdir(env.ARTIFACT_DIR);
    const bundles = entries.filter((name) => name.endsWith(".apkm"));

    let bytes = 0;
    for (const name of bundles) {
      const stat = await fs.stat(path.join(env.ARTIFACT_DIR, name)).catch(() => null);
      if (stat) bytes += stat.size;
    }

    const stats = await fs.statfs(env.ARTIFACT_DIR).catch(() => null);
    const free = stats ? Number(stats.bavail) * Number(stats.bsize) : null;
    // One bundle is ~170 MB and a rollout may cache several, so under 5 GB the
    // next download is the one that fails.
    const low = free !== null && free < 5 * 1024 ** 3;

    return {
      key: "artifacts",
      label: "Artifact storage",
      summary: low
        ? `Only ${gb(free)} left on the artifacts volume`
        : `${bundles.length} bundle${bundles.length === 1 ? "" : "s"} cached${
            free !== null ? `, ${gb(free)} free` : ""
          }`,
      state: low ? "DEGRADED" : "OK",
      latencyMs: null,
      facts: [
        { label: "Directory", value: env.ARTIFACT_DIR },
        { label: "Cached bundles", value: String(bundles.length) },
        { label: "On disk", value: gb(bytes) },
        ...(free !== null ? [{ label: "Free space", value: gb(free) }] : []),
      ],
      detail: null,
      link: null,
    };
  } catch (err) {
    return {
      key: "artifacts",
      label: "Artifact storage",
      summary: `${env.ARTIFACT_DIR} is not readable`,
      state: "DOWN",
      latencyMs: null,
      facts: [{ label: "Directory", value: env.ARTIFACT_DIR }],
      detail: message(err),
      link: null,
    };
  }
}

/**
 * What the poller last did with a source, so a card can say when it last
 * actually ran rather than only whether the API is up right now.
 */
function pollFacts(source: "github" | "mirror"): IntegrationFact[] {
  const stat = getPollStats()[source];
  if (!stat) return [{ label: "Last poll", value: "not since the hub started" }];

  return [
    { label: "Last poll", value: stat.at },
    {
      label: "Last result",
      value: stat.ok ? `${stat.found} version${stat.found === 1 ? "" : "s"} listed` : "failed",
    },
  ];
}

async function checkGithub(): Promise<IntegrationCheck> {
  const targets = await prisma.appTarget.findMany({
    where: { enabled: true, githubRepo: { not: null } },
    select: { githubRepo: true },
  });
  const repos = targets.map((t) => t.githubRepo).filter((r): r is string => Boolean(r));
  const stat = getPollStats().github;

  if (repos.length === 0) {
    return {
      key: "github",
      label: "GitHub releases",
      summary: "No target is watching a GitHub repo",
      state: "OFF",
      latencyMs: null,
      facts: [],
      detail: null,
      link: null,
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "magnemite-hub",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  try {
    // The rate limit endpoint is free: it reports the budget without spending
    // any of it, which is what a status page should cost.
    const { ms, value: res } = await timed(() =>
      fetch("https://api.github.com/rate_limit", { headers, signal: AbortSignal.timeout(10_000) }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = (await res.json()) as {
      rate?: { remaining?: number; limit?: number; reset?: number };
    };
    const remaining = body.rate?.remaining ?? null;
    const limit = body.rate?.limit ?? null;
    const exhausted = remaining === 0;

    return {
      key: "github",
      label: "GitHub releases",
      summary: exhausted
        ? "Rate limit spent — polls find nothing until it resets"
        : `Reachable, ${remaining ?? "?"} of ${limit ?? "?"} calls left this hour`,
      state: exhausted || (stat && !stat.ok) ? "DEGRADED" : "OK",
      latencyMs: ms,
      facts: [
        { label: "Repositories", value: repos.join(", ") },
        { label: "Token", value: env.GITHUB_TOKEN ? "set" : "anonymous (60 calls/hour)" },
        ...(remaining !== null
          ? [{ label: "Calls left", value: `${remaining}/${limit ?? "?"}` }]
          : []),
        ...(body.rate?.reset
          ? [{ label: "Budget resets", value: new Date(body.rate.reset * 1000).toISOString() }]
          : []),
        ...pollFacts("github"),
      ],
      detail: stat && !stat.ok ? stat.error : null,
      link: `https://github.com/${repos[0]}/releases`,
    };
  } catch (err) {
    return {
      key: "github",
      label: "GitHub releases",
      summary: "api.github.com is not reachable from the hub",
      state: "DOWN",
      latencyMs: null,
      facts: [{ label: "Repositories", value: repos.join(", ") }, ...pollFacts("github")],
      detail: message(err),
      link: null,
    };
  }
}

async function checkMirror(): Promise<IntegrationCheck> {
  const target = await prisma.appTarget.findFirst({
    where: { enabled: true, mirrorIndexUrl: { not: null } },
    select: { mirrorIndexUrl: true, packageName: true, arch: true },
  });
  const indexUrl = target?.mirrorIndexUrl ?? null;

  if (!target || !indexUrl) {
    return {
      key: "mirror",
      label: "UnownHash mirror",
      summary: "No target is watching a mirror index",
      state: "OFF",
      latencyMs: null,
      facts: [],
      detail: null,
      link: null,
    };
  }

  try {
    const { ms, value: res } = await timed(() =>
      fetch(indexUrl, {
        headers: { "User-Agent": "magnemite-hub", Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const entries = (await res.json()) as { filename?: string; arch?: string; version?: string }[];
    const ours = entries.filter(
      (e) => e.arch === target.arch && (e.filename ?? "").startsWith(target.packageName),
    );
    // The index is in upload order, not version order, so the last line is
    // not the newest build.
    const newest =
      ours
        .map((e) => e.version)
        .filter((v): v is string => Boolean(v))
        .sort(compareVersions)
        .at(-1) ?? null;

    return {
      key: "mirror",
      label: "UnownHash mirror",
      summary:
        ours.length === 0
          ? `Index is up but lists nothing for ${target.packageName} on ${target.arch}`
          : `${ours.length} build${ours.length === 1 ? "" : "s"} listed for this target`,
      state: ours.length === 0 ? "DEGRADED" : "OK",
      latencyMs: ms,
      facts: [
        { label: "Index", value: indexUrl },
        { label: "Entries", value: `${ours.length} of ${entries.length}` },
        ...(newest ? [{ label: "Newest listed", value: newest }] : []),
        ...pollFacts("mirror"),
      ],
      detail: null,
      link: indexUrl,
    };
  } catch (err) {
    return {
      key: "mirror",
      label: "UnownHash mirror",
      summary: "The mirror index did not answer",
      state: "DOWN",
      latencyMs: null,
      facts: [{ label: "Index", value: indexUrl }, ...pollFacts("mirror")],
      detail: message(err),
      link: indexUrl,
    };
  }
}

async function checkRotom(): Promise<IntegrationCheck> {
  if (!rotomEnabled()) {
    return {
      key: "rotom",
      label: "Rotom",
      summary: "Offline, installs will not pause scanning",
      state: "OFF",
      latencyMs: null,
      facts: [
        { label: "ROTOM_ENABLED", value: String(env.ROTOM_ENABLED) },
        { label: "ROTOM_URL", value: env.ROTOM_URL ?? "not set" },
      ],
      detail: null,
      link: null,
    };
  }

  try {
    const { ms, value: devices } = await timed(() => listDevices());
    const connected = devices.filter((d) => d.is_connected).length;
    const matched = await prisma.device.count({ where: { rotomDeviceId: { not: null } } });
    // Rotom listing boxes that never match one of ours means the origins do
    // not line up, and the install lifecycle then silently does nothing.
    const unmatched = devices.length > 0 && matched === 0;

    return {
      key: "rotom",
      label: "Rotom",
      summary: `${connected} of ${devices.length} scanner${devices.length === 1 ? "" : "s"} connected`,
      state: unmatched ? "DEGRADED" : "OK",
      latencyMs: ms,
      facts: [
        { label: "URL", value: env.ROTOM_URL ?? "—" },
        { label: "Secret", value: env.ROTOM_SECRET ? "set" : "none" },
        { label: "Devices listed", value: String(devices.length) },
        { label: "Matched to our fleet", value: String(matched) },
      ],
      detail: unmatched
        ? "No Rotom device matches one of ours — check each box's origin against its name or serial."
        : null,
      link: env.ROTOM_URL ?? null,
    };
  } catch (err) {
    return {
      key: "rotom",
      label: "Rotom",
      summary: "Enabled, but not answering",
      state: "DOWN",
      latencyMs: null,
      facts: [{ label: "URL", value: env.ROTOM_URL ?? "—" }],
      detail: message(err),
      link: env.ROTOM_URL ?? null,
    };
  }
}

async function checkEdge(): Promise<IntegrationCheck> {
  const base = env.MAGNEMITE_PUBLIC_URL.replace(/\/$/, "");

  try {
    const { ms, value: res } = await timed(() =>
      fetch(`${base}/healthz`, { signal: AbortSignal.timeout(10_000) }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return {
      key: "edge",
      label: "Public edge",
      summary: `The address the boxes use answers in ${ms} ms`,
      state: "OK",
      latencyMs: ms,
      facts: [
        { label: "Public URL", value: base },
        { label: "Artifacts", value: `${base}/files/` },
      ],
      detail: null,
      link: base,
    };
  } catch (err) {
    return {
      key: "edge",
      label: "Public edge",
      summary: "The address the boxes use is not answering from in here",
      state: "DOWN",
      latencyMs: null,
      facts: [{ label: "Public URL", value: base }],
      // Worth spelling out: this URL is handed to every agent, so a failure
      // here is every enrolment and every download failing.
      detail: `${message(err)} — enrolment and artifact downloads use this URL.`,
      link: null,
    };
  }
}

// ---------------------------------------------------------------------------

export async function collectHealth(force = false): Promise<HubHealth> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const checks = await Promise.all([
    Promise.resolve(checkHub()),
    checkDatabase(),
    checkArtifacts(),
    checkGithub(),
    checkMirror(),
    checkRotom(),
    checkEdge(),
  ]);

  const overall = checks.reduce<IntegrationState>(
    (worst, check) => (RANK[check.state] > RANK[worst] ? check.state : worst),
    "OK",
  );

  const value: HubHealth = { checkedAt: new Date().toISOString(), overall, checks };
  cached = { at: Date.now(), value };

  const failing = checks.filter((c) => c.state === "DOWN" || c.state === "DEGRADED");
  if (failing.length > 0) {
    log.warn({ failing: failing.map((c) => `${c.key}:${c.state}`) }, "integration health degraded");
  }

  return value;
}
