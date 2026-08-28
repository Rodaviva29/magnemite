import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export * from "@prisma/client";
export { PrismaClient };

// A single client per process. Next.js dev reloads the module graph on every
// edit, which would otherwise open a new pool each time until Postgres runs
// out of connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Issuer Better Auth stamps on email/password accounts. Anything that writes a
 * credential row — the seed, the admin account form — has to use it, because
 * sign-in looks the account up by (issuer, accountId).
 */
export const CREDENTIAL_ISSUER = "local:credential";
export const CREDENTIAL_PROVIDER_ID = "credential";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/// Device and enrollment tokens are 32 random bytes, so a plain sha256 is
/// enough to store them — there is nothing to brute-force. Passwords use
/// bcrypt instead.
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Admin sync
// ---------------------------------------------------------------------------

/**
 * Upserts the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
 *
 * Called on every hub boot, so the login always tracks the env vars — change
 * `ADMIN_PASSWORD` and restart the hub, no seed step needed. Also called from
 * the optional seed script, so `pnpm db:seed` stays in sync with the same
 * logic rather than duplicating it.
 */
export async function syncAdminFromEnv(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "change-me-please";

  // Better Auth keeps credentials on the account row, not the user. The auth
  // config points its hasher at bcrypt precisely so this can create/update the
  // admin without importing Better Auth here.
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: {
      email,
      name: "Admin",
      emailVerified: true,
      role: "ADMIN",
    },
  });

  const passwordHash = await bcrypt.hash(password, 12);
  const credential = await prisma.account.findFirst({
    where: { userId: admin.id, providerId: CREDENTIAL_PROVIDER_ID },
  });

  if (credential) {
    await prisma.account.update({
      where: { id: credential.id },
      data: { password: passwordHash, issuer: CREDENTIAL_ISSUER },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: admin.id,
        issuer: CREDENTIAL_ISSUER,
        providerId: CREDENTIAL_PROVIDER_ID,
        accountId: admin.id,
        password: passwordHash,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Hub settings
// ---------------------------------------------------------------------------

/**
 * Fleet-wide operational knobs, editable from Settings instead of env — see
 * the `Setting` model's own doc comment. Read on every scheduler tick / poll
 * check, so a change here takes effect without restarting the hub.
 */
export type HubSettingsValues = {
  /** Fleet-wide cap on devices downloading/installing at the same time. */
  maxConcurrentJobs: number;
  /** Seconds without a job_progress message before a job is considered stalled. */
  jobStallTimeoutSeconds: number;
  /** How often every enabled source is polled, in minutes. */
  sourcePollMinutes: number;
  /**
   * Minutes since an app target's last AUTO rollout finished before another
   * one is allowed to start. 0 means no cooldown — every discovered update
   * ships as soon as it's found, the historical behavior.
   */
  updateCooldownMinutes: number;
  /**
   * Seconds between stored health samples. Boxes beat every 20 seconds and no
   * chart is read at that resolution, so the hub keeps one beat per interval
   * and drops the rest. Floored at the heartbeat interval — asking for less
   * than 20 just stores every beat.
   */
  metricsSampleSeconds: number;
  /**
   * Days of health history to keep. 0 turns recording off entirely and drops
   * what is already stored on the next prune, for a fleet that would rather
   * not spend the disk.
   */
  metricsRetentionDays: number;
  /**
   * Seconds between heartbeats, which the hub tells every box in its welcome.
   *
   * The one setting here that lives on the far side: a box only learns it on
   * its next connection, and an agent too old to read it keeps beating at 20.
   * Two other values are measured in beats, so raising this without raising
   * them is how a fleet starts flapping between online and offline — the
   * dashboard rejects that combination rather than letting it through.
   */
  heartbeatSeconds: number;
  /**
   * How many boxes may be swapping their agent binary at once. The sibling of
   * `maxConcurrentJobs`, for the other thing the whole fleet does at the same
   * time: reconnecting after a hub deploy.
   */
  agentUpdateConcurrency: number;
  /**
   * Seconds without a heartbeat before a box is marked offline. Boxes beat
   * every 20 seconds, so this is really "how many missed beats" — the default
   * is three of them plus a margin.
   */
  deviceOfflineTimeoutSeconds: number;
};

const HUB_SETTINGS_DEFAULTS: HubSettingsValues = {
  maxConcurrentJobs: 10,
  jobStallTimeoutSeconds: 900,
  sourcePollMinutes: 15,
  updateCooldownMinutes: 0,
  metricsSampleSeconds: 60,
  metricsRetentionDays: 7,
  heartbeatSeconds: 20,
  agentUpdateConcurrency: 5,
  deviceOfflineTimeoutSeconds: 70,
};

/**
 * Fleet-wide settings, in groups.
 *
 * Everything lives in the one `Setting` table, so a group is just a key
 * prefix: the hub knobs are unprefixed, because they were there first and
 * their rows are already written; anything added since carries one.
 *
 * The type check below is the part that matters. It used to be a bare
 * `typeof row.value === "number"`, which was right while every setting was a
 * number and became a silent data-loss bug the moment one was not — a string
 * webhook URL saved perfectly and then vanished on every read. Comparing
 * against the default's own type keeps that honest for whatever gets added
 * next, and doubles as the guard against a row left behind by an older shape.
 */
type SettingValue = number | string | boolean;

function mergeGroup<T extends Record<string, SettingValue>>(
  defaults: T,
  prefix: string,
  rows: { key: string; value: unknown }[],
): T {
  const values = { ...defaults };
  for (const row of rows) {
    const name = row.key.slice(prefix.length);
    if (!(name in defaults)) continue;
    if (typeof row.value !== typeof defaults[name]) continue;
    values[name as keyof T] = row.value as T[keyof T];
  }
  return values;
}

async function readGroup<T extends Record<string, SettingValue>>(
  defaults: T,
  prefix: string,
): Promise<T> {
  const keys = Object.keys(defaults).map((name) => `${prefix}${name}`);
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  return mergeGroup(defaults, prefix, rows);
}

async function writeGroup<T extends Record<string, SettingValue>>(
  patch: Partial<T>,
  prefix: string,
): Promise<void> {
  const entries = Object.entries(patch) as [string, SettingValue][];
  if (entries.length === 0) return;

  await prisma.$transaction(
    entries.map(([name, value]) =>
      prisma.setting.upsert({
        where: { key: `${prefix}${name}` },
        update: { value },
        create: { key: `${prefix}${name}`, value },
      }),
    ),
  );
}

/**
 * Always a read. The caller caches if it has reason to.
 *
 * This used to hold a copy, which was wrong in a way that took a while to
 * show: the dashboard and the hub are separate processes, and inside Next the
 * page and the server action do not reliably share module state either. So a
 * save wrote the new value, cleared the copy it could reach, and the page went
 * on rendering the copy it could not — the setting looked like it reverted to
 * the default while the database held the new number.
 *
 * The hub is the only process with a reason to cache: its scheduler reads
 * these on every tick. It does that in `services/hubSettings.ts`, where it can
 * also be told to drop the copy, which is the piece that makes caching safe.
 */
export async function getHubSettings(): Promise<HubSettingsValues> {
  return readGroup(HUB_SETTINGS_DEFAULTS, "");
}

export async function updateHubSettings(patch: Partial<HubSettingsValues>): Promise<void> {
  await writeGroup(patch, "");
}

// ---------------------------------------------------------------------------
// Monitoring settings
// ---------------------------------------------------------------------------

/**
 * The knobs behind Settings → Monitoring.
 *
 * A separate group from the hub settings above, under a `monitor.` prefix,
 * because these are read by one service rather than by everything and because
 * several of them are not numbers. They are what stands between a useful
 * watchdog and a fleet that reboots itself in a loop, so most of what is here
 * is a ceiling rather than a feature.
 */
export type MonitorSettingsValues = {
  /** The master switch. Off, so upgrading a fleet changes nothing by itself. */
  enabled: boolean;
  /**
   * Seconds a box may be unreachable before it is worth saying so. Distinct
   * from `deviceOfflineTimeoutSeconds`, which only decides when a box is
   * *marked* offline — a box can be offline for a minute during its own
   * reboot without anyone needing to hear about it.
   */
  unreachableAlertSeconds: number;
  /** Seconds since Rotom last saw a box before that counts as disconnected. */
  rotomStaleSeconds: number;
  /**
   * No action on a box for this long after we rebooted it. Without this, a box
   * taking three minutes to come back reads as unreachable and gets rebooted
   * again, forever.
   */
  rebootGraceSeconds: number;
  /**
   * Nothing acts for this long after the hub starts.
   *
   * The hub runs under `tsx watch` in development, so every file save restarts
   * it and drops every device socket at once. Without this, editing this
   * repository reboots the fleet.
   */
  startupGraceSeconds: number;
  /** Circuit breaker: past this, a box is alerted about and left alone. */
  maxActionsPerDeviceHour: number;
  /** The same, for the expensive half of the ladder. */
  maxRebootsPerDeviceDay: number;
  /** The same signal on the same box is not re-announced inside this. */
  alertDedupeMinutes: number;
  /** Days of monitor history to keep. 0 keeps it forever. */
  eventRetentionDays: number;
  /** Empty turns notifications off while leaving remediation running. */
  discordWebhookUrl: string;
  /** INFO, WARN or CRITICAL. Anything below it is acted on but not announced. */
  discordMinLevel: string;
  /** A role to ping on CRITICAL only. Empty pings nobody. */
  discordMentionRoleId: string;
};

const MONITOR_SETTINGS_DEFAULTS: MonitorSettingsValues = {
  enabled: false,
  unreachableAlertSeconds: 300,
  rotomStaleSeconds: 600,
  rebootGraceSeconds: 600,
  startupGraceSeconds: 180,
  maxActionsPerDeviceHour: 4,
  maxRebootsPerDeviceDay: 6,
  alertDedupeMinutes: 30,
  eventRetentionDays: 30,
  discordWebhookUrl: "",
  discordMinLevel: "WARN",
  discordMentionRoleId: "",
};

export const MONITOR_SETTINGS_PREFIX = "monitor.";

export async function getMonitorSettings(): Promise<MonitorSettingsValues> {
  return readGroup(MONITOR_SETTINGS_DEFAULTS, MONITOR_SETTINGS_PREFIX);
}

export async function updateMonitorSettings(patch: Partial<MonitorSettingsValues>): Promise<void> {
  await writeGroup(patch, MONITOR_SETTINGS_PREFIX);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/// Prisma returns BigInt for byte counts, which `JSON.stringify` refuses to
/// serialize and React refuses to render. Every byte count we store fits in a
/// double (a 9 PB device would be a surprise), so widen them on the way out.
export function serialize<T>(value: T): SerializedBigInt<T> {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v)),
  ) as SerializedBigInt<T>;
}

export type SerializedBigInt<T> = T extends bigint
  ? number
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? SerializedBigInt<U>[]
      : T extends object
        ? { [K in keyof T]: SerializedBigInt<T[K]> }
        : T;
