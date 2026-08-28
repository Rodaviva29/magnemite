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
  agentUpdateConcurrency: 5,
  deviceOfflineTimeoutSeconds: 70,
};

const HUB_SETTINGS_KEYS = Object.keys(HUB_SETTINGS_DEFAULTS) as (keyof HubSettingsValues)[];

/**
 * Held until something says it is stale, rather than re-read on a timer.
 *
 * The scheduler reads these on every tick *and* on every nudge — a job
 * finishing, a box reconnecting — so during a rollout this is the hottest read
 * in the system, for a handful of numbers that change about never. A timer
 * here is pure waste: it was set to five seconds, the same as the scheduler's
 * tick, so nearly every read missed and went to the database anyway.
 *
 * Two things clear it instead, which between them cover everything that can
 * actually change the values:
 *
 *   the dashboard   writes them, then tells the hub through /internal/settings
 *   a restart       starts with nothing cached and reads on first use
 *
 * What that leaves is a value changed straight in the database by hand, with
 * no restart after. That one needs a restart, or one Save from the dashboard
 * to ring the bell — a manual change with a manual fix, which is not worth a
 * query every few seconds forever.
 */
let hubSettingsCache: HubSettingsValues | null = null;

export async function getHubSettings(): Promise<HubSettingsValues> {
  if (hubSettingsCache) return { ...hubSettingsCache };

  const rows = await prisma.setting.findMany({ where: { key: { in: HUB_SETTINGS_KEYS } } });
  const values = { ...HUB_SETTINGS_DEFAULTS };
  for (const row of rows) {
    if (typeof row.value === "number" && (row.key as keyof HubSettingsValues) in values) {
      values[row.key as keyof HubSettingsValues] = row.value;
    }
  }

  hubSettingsCache = values;
  return { ...values };
}

/**
 * Drop this process's copy, so the next read goes to the database.
 *
 * Called on the hub when the dashboard says it has written new values. The
 * dashboard's own copy is dropped by `updateHubSettings` itself.
 */
export function invalidateHubSettingsCache(): void {
  hubSettingsCache = null;
}

export async function updateHubSettings(patch: Partial<HubSettingsValues>): Promise<void> {
  const entries = Object.entries(patch) as [keyof HubSettingsValues, number][];
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );
  // So the process that just wrote them re-renders with the new values rather
  // than its own stale copy.
  hubSettingsCache = null;
}

/**
 * Write settings that have no row yet, leaving any that do alone.
 *
 * For values that used to be environment variables: a hub that still has one
 * set adopts it once, so upgrading does not quietly reset a tuned fleet to the
 * defaults. Once the row exists the dashboard owns it and the variable is
 * ignored, which is why this never overwrites.
 */
export async function seedMissingHubSettings(patch: Partial<HubSettingsValues>): Promise<number> {
  const entries = Object.entries(patch) as [keyof HubSettingsValues, number][];
  if (entries.length === 0) return 0;

  const { count } = await prisma.setting.createMany({
    data: entries.map(([key, value]) => ({ key, value })),
    skipDuplicates: true,
  });
  if (count > 0) hubSettingsCache = null;
  return count;
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
