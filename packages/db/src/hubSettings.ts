import { prisma } from "./index.js";

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
};

const DEFAULTS: HubSettingsValues = {
  maxConcurrentJobs: 10,
  jobStallTimeoutSeconds: 900,
  sourcePollMinutes: 15,
  updateCooldownMinutes: 0,
};

const KEYS = Object.keys(DEFAULTS) as (keyof HubSettingsValues)[];

export async function getHubSettings(): Promise<HubSettingsValues> {
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  const values = { ...DEFAULTS };
  for (const row of rows) {
    if (typeof row.value === "number" && (row.key as keyof HubSettingsValues) in values) {
      values[row.key as keyof HubSettingsValues] = row.value;
    }
  }
  return values;
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
}
