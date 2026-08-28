import {
  getHubSettings as readHubSettings,
  getMonitorSettings as readMonitorSettings,
  type HubSettingsValues,
  type MonitorSettingsValues,
} from "@magnemite/db";
import { log } from "../log.js";

/**
 * The hub's copy of the fleet-wide settings.
 *
 * The scheduler reads these on every tick *and* on every nudge — a job
 * finishing, a box reconnecting — so during a rollout this is the hottest read
 * in the system, for a handful of numbers that change about never. That is why
 * the hub caches, and why nothing else does: the dashboard reads them once per
 * page render and has no such pressure.
 *
 * Held until something says it is stale, rather than re-read on a timer. Two
 * things clear it, and between them they cover everything that can change the
 * values:
 *
 *   the dashboard   writes them, then rings /internal/settings
 *   a restart       starts with nothing and reads on first use
 *
 * What that leaves is a value changed straight in the database by hand with no
 * restart after. That one needs a restart, or one Save from the dashboard to
 * ring the bell — a manual change with a manual fix, which is not worth a
 * query every few seconds forever.
 */
let cache: HubSettingsValues | null = null;
let monitorCache: MonitorSettingsValues | null = null;

export async function getHubSettings(): Promise<HubSettingsValues> {
  if (cache) return { ...cache };
  const values = await readHubSettings();
  cache = values;
  return { ...values };
}

/**
 * The monitoring knobs, held the same way and for the same reason: the
 * evaluation pass reads all of them, and most are ceilings it has to check
 * before it is allowed to touch a box.
 */
export async function getMonitorSettings(): Promise<MonitorSettingsValues> {
  if (monitorCache) return { ...monitorCache };
  const values = await readMonitorSettings();
  monitorCache = values;
  return { ...values };
}

/**
 * Drop both copies, so the next read goes to the database.
 *
 * One bell for both groups: the dashboard rings it after any save, and a
 * cache that is dropped when it did not need to be costs one query.
 */
export function invalidateHubSettingsCache(): void {
  cache = null;
  monitorCache = null;
  log.info("hub settings cache dropped");
}
