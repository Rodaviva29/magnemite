"use server";

import { revalidatePath } from "next/cache";
import {
  type MonitorAction,
  type MonitorLevel,
  type MonitorSettingsValues,
  type MonitorSignal,
  type Prisma,
  prisma,
  updateMonitorSettings as updateMonitorSettingsInDb,
  getHubSettings,
} from "@magnemite/db";
import { requireOperator } from "@/lib/session";
import { hub } from "@/lib/hub";
import type { ActionState } from "./rollouts";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const SIGNALS = new Set<string>([
  "AGENT_OFFLINE",
  "SERVICE_DOWN",
  "APP_NOT_FOREGROUND",
  "APP_ANR",
  "HEALTH_CHECK_FAILED",
  "LOOP_STALLED",
  "ROTOM_DISCONNECTED",
]);

const ACTIONS = new Set<string>([
  "NOTIFY_ONLY",
  "RESTART_APP",
  "KILL_APP",
  "CLEAR_CACHE_RESTART",
  "SEND_KEYEVENT",
  "START_SERVICE",
  "SHELL",
  "REBOOT",
  "ROTOM_RESTART",
]);

const LEVELS = new Set<string>(["INFO", "WARN", "CRITICAL"]);

/**
 * Tell the hub, best effort.
 *
 * A failure here is never an error: the values *are* saved. What it means is
 * that the hub is still running on the old ones, which has to be said rather
 * than left to be discovered — the same convention the hub settings form uses.
 */
async function tellHub(alsoBroadcast: boolean): Promise<boolean> {
  try {
    await hub.refreshSettings();
    // A changed rule changes what each box is told to probe, and that rides
    // the `welcome`. Without this, switching a rule on would do nothing until
    // every box happened to reconnect.
    if (alsoBroadcast) await hub.refreshTrackedPackages();
    return true;
  } catch {
    return false;
  }
}

function savedMessage(told: boolean): string {
  return told
    ? "Saved."
    : "Saved, but the hub could not be told, so it is still running on the old values. Restart it, or save again once it is back.";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The master switch, the timings, the ceilings and the Discord webhook. */
export async function updateMonitorSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();

  const int = (name: string, min: number) => {
    const parsed = Number(formData.get(name));
    if (!Number.isFinite(parsed) || parsed < min) return null;
    return Math.floor(parsed);
  };

  const unreachableAlertSeconds = int("unreachableAlertSeconds", 30);
  // One HTTP request for the whole fleet at once, against somebody else's
  // service. 10s is as tight as is polite.
  const rotomSyncSeconds = int("rotomSyncSeconds", 10);
  // Floored against the Rotom sync interval below, not by a constant: 120 was
  // two of the 60s the sync used to be fixed at, and it stopped meaning that
  // the moment the interval became a setting.
  const rotomStaleSeconds = int("rotomStaleSeconds", 1);
  const rebootGraceSeconds = int("rebootGraceSeconds", 60);
  const startupGraceSeconds = int("startupGraceSeconds", 0);
  const maxActionsPerDeviceHour = int("maxActionsPerDeviceHour", 1);
  const maxRebootsPerDeviceDay = int("maxRebootsPerDeviceDay", 1);
  const alertDedupeMinutes = int("alertDedupeMinutes", 0);
  const eventRetentionDays = int("eventRetentionDays", 0);

  if (
    unreachableAlertSeconds === null ||
    rotomSyncSeconds === null ||
    rotomStaleSeconds === null ||
    rebootGraceSeconds === null ||
    startupGraceSeconds === null ||
    maxActionsPerDeviceHour === null ||
    maxRebootsPerDeviceDay === null ||
    alertDedupeMinutes === null ||
    eventRetentionDays === null
  ) {
    return {
      error:
        "Every field needs a whole number. The Rotom sync starts at 10 seconds, the reboot grace at 60, and the two ceilings at 1.",
    };
  }

  const webhook = String(formData.get("discordWebhookUrl") ?? "").trim();
  if (webhook && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhook)) {
    return {
      error:
        "That does not look like a Discord webhook. Copy it from the channel's Integrations settings — it starts with https://discord.com/api/webhooks/.",
    };
  }

  const level = String(formData.get("discordMinLevel") ?? "WARN");
  if (!LEVELS.has(level)) return { error: "Pick a minimum severity." };

  // The same kind of coupling the hub settings already enforce, and for the
  // same reason: these numbers only mean anything against each other, and
  // letting a nonsense combination through produces a fleet that looks broken
  // when it is the form that allowed it.
  const hubSettings = await getHubSettings();
  if (unreachableAlertSeconds < hubSettings.deviceOfflineTimeoutSeconds) {
    return {
      error: `The unreachable delay has to be at least the ${hubSettings.deviceOfflineTimeoutSeconds}s offline timeout — otherwise a box is alerted about before it is even marked offline.`,
    };
  }
  // Two sync intervals, because a box can never be fresher than the last time
  // anyone asked Rotom about it. Anything tighter alerts on the sync's own lag.
  // Both numbers come out of this one form now, so the check is against what
  // was just typed rather than against whatever is stored elsewhere.
  if (rotomStaleSeconds < rotomSyncSeconds * 2) {
    return {
      error: `Asking Rotom every ${rotomSyncSeconds}s means the stale delay has to be at least ${rotomSyncSeconds * 2}s — anything tighter alerts on the sync's own lag rather than on a box.`,
    };
  }

  const patch: Partial<MonitorSettingsValues> = {
    enabled: formData.get("enabled") === "on",
    unreachableAlertSeconds,
    rotomSyncSeconds,
    rotomStaleSeconds,
    rebootGraceSeconds,
    startupGraceSeconds,
    maxActionsPerDeviceHour,
    maxRebootsPerDeviceDay,
    alertDedupeMinutes,
    eventRetentionDays,
    discordWebhookUrl: webhook,
    discordMinLevel: level,
    discordMentionRoleId: String(formData.get("discordMentionRoleId") ?? "").trim(),
  };
  await updateMonitorSettingsInDb(patch);

  const told = await tellHub(false);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "settings.monitoring",
      // The webhook is a credential — anyone who has it can post to the
      // channel — so the audit log records that it changed, not what to.
      meta: { ...patch, discordWebhookUrl: webhook ? "set" : "", hubNotified: told },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: savedMessage(told) };
}

/**
 * The master switch, on its own.
 *
 * It sits above everything else on the tab and answers one question — is any
 * of this running — so it saves on the flick rather than through the form that
 * owns the numbers below it. Writing only `enabled` is what makes that safe:
 * the patch is partial, so nothing else in the group is touched by a switch
 * somebody flicked while a number below was half-edited.
 */
export async function setMonitorEnabled(enabled: boolean): Promise<ActionState> {
  const user = await requireOperator();
  await updateMonitorSettingsInDb({ enabled });

  const told = await tellHub(false);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "settings.monitoring",
      meta: { enabled, hubNotified: told },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: savedMessage(told) };
}

/** Prove the webhook, so nobody finds out it was wrong during an incident. */
export async function sendTestAlert(): Promise<ActionState> {
  await requireOperator();
  try {
    const result = await hub.testAlert();
    if (!result.ok) return { error: result.error ?? "Discord did not accept the message." };
    return { ok: true, message: "Sent — check the channel." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Run a pass now rather than waiting for the next tick. */
export async function runMonitorNow(): Promise<ActionState> {
  await requireOperator();
  try {
    await hub.runMonitor();
    revalidatePath("/settings");
    return { ok: true, message: "Pass finished." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

type ParsedRule = {
  name: string;
  signal: MonitorSignal;
  packageName: string | null;
  groupId: string | null;
  config: Prisma.InputJsonValue;
  threshold: number;
  cooldownSeconds: number;
  windowStart: string | null;
  windowEnd: string | null;
  notifyLevel: MonitorLevel;
  notify: boolean;
  enabled: boolean;
  steps: { atFailure: number; action: MonitorAction; command: string | null }[];
};

/**
 * Read one rule out of a form, or say what is wrong with it.
 *
 * Shared by create and update so the two cannot drift — a rule that could be
 * created but not saved again would be the worst kind of bug to find here.
 */
function parseRule(formData: FormData): ParsedRule | string {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return "Give the rule a name.";

  const signal = String(formData.get("signal") ?? "");
  if (!SIGNALS.has(signal)) return "Pick what the rule watches for.";

  const notifyLevel = String(formData.get("notifyLevel") ?? "WARN");
  if (!LEVELS.has(notifyLevel)) return "Pick a severity.";

  const int = (field: string, min: number, fallback: number) => {
    const parsed = Number(formData.get(field));
    return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback;
  };

  const windowStart = String(formData.get("windowStart") ?? "").trim() || null;
  const windowEnd = String(formData.get("windowEnd") ?? "").trim() || null;
  if ((windowStart && !TIME_RE.test(windowStart)) || (windowEnd && !TIME_RE.test(windowEnd))) {
    return "The window needs times like 09:00 and 17:30.";
  }
  if (Boolean(windowStart) !== Boolean(windowEnd)) {
    return "A window needs both a start and an end, or neither.";
  }

  const packageName = String(formData.get("packageName") ?? "").trim() || null;
  // Three of the signals are about a specific app, and a rule that does not
  // name one would have nothing to force-stop.
  if (!packageName && ["APP_NOT_FOREGROUND", "APP_ANR", "SERVICE_DOWN"].includes(signal)) {
    return "That signal is about a particular app — give it a package name.";
  }

  const steps = parseSteps(formData);
  if (typeof steps === "string") return steps;

  return {
    name,
    signal: signal as MonitorSignal,
    packageName,
    groupId: String(formData.get("groupId") ?? "").trim() || null,
    config: parseConfig(formData),
    threshold: int("threshold", 1, 1),
    cooldownSeconds: int("cooldownSeconds", 0, 300),
    windowStart,
    windowEnd,
    notifyLevel: notifyLevel as MonitorLevel,
    notify: formData.get("notify") === "on",
    enabled: formData.get("enabled") === "on",
    steps,
  };
}

/**
 * The probe, which is the half of a rule that travels to the box.
 *
 * Stored as JSON rather than columns because its shape follows the kind: a
 * shell check has a command and a pattern, a log check has a window and two
 * patterns and a ratio, and modelling all of that as nullable columns would be
 * a table nobody could read.
 */
function parseConfig(formData: FormData): Prisma.InputJsonValue {
  const kind = String(formData.get("probeKind") ?? "").trim();
  const target = String(formData.get("probeTarget") ?? "").trim();
  // "none" is the form's way of saying the hub answers this signal by itself.
  if (!kind || kind === "none" || !target) return {};

  const num = (field: string) => {
    const parsed = Number(formData.get(field));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  return {
    probe: {
      kind,
      target,
      expect: String(formData.get("probeExpect") ?? "").trim() || null,
      lines: num("probeLines") ?? 200,
      failAt: num("probeFailAt") ?? 1,
      successPattern: String(formData.get("probeSuccessPattern") ?? "").trim() || null,
      maxRatio: num("probeMaxRatio"),
      maxAgeSeconds: num("probeMaxAgeSeconds"),
      timeoutSeconds: num("probeTimeoutSeconds") ?? 10,
    },
  };
}

/**
 * The escalation ladder, as parallel arrays out of the form's repeated rows.
 *
 * Deliberately strict about duplicate rungs: two actions at the same failure
 * count would both fire, which is how a box gets restarted and rebooted for
 * one fault.
 */
function parseSteps(formData: FormData): ParsedRule["steps"] | string {
  const failures = formData.getAll("stepAtFailure").map(String);
  const actions = formData.getAll("stepAction").map(String);
  const commands = formData.getAll("stepCommand").map(String);

  const steps: ParsedRule["steps"] = [];
  const seen = new Set<number>();

  for (const [index, raw] of failures.entries()) {
    const action = actions[index];
    if (!action || !ACTIONS.has(action)) continue;

    const atFailure = Number(raw);
    if (!Number.isInteger(atFailure) || atFailure < 1) {
      return "Each step answers a failure count of 1 or more.";
    }
    if (seen.has(atFailure)) {
      return `Two steps both answer failure ${atFailure} — one rung, one action.`;
    }
    seen.add(atFailure);

    steps.push({
      atFailure,
      action: action as MonitorAction,
      command: (commands[index] ?? "").trim() || null,
    });
  }

  if (steps.length === 0) return "A rule needs at least one step, even if it only notifies.";
  return steps;
}

export async function createMonitorRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const parsed = parseRule(formData);
  if (typeof parsed === "string") return { error: parsed };

  const { steps, ...rule } = parsed;
  const position = await prisma.monitorRule.count();
  const created = await prisma.monitorRule.create({
    data: { ...rule, position, steps: { create: steps } },
  });

  const told = await tellHub(rule.enabled);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "monitorRule.create",
      targetType: "MonitorRule",
      targetId: created.id,
      meta: { name: rule.name, signal: rule.signal, enabled: rule.enabled },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: told ? `Created "${rule.name}".` : savedMessage(false) };
}

export async function updateMonitorRule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperator();
  const id = String(formData.get("ruleId") ?? "");
  if (!id) return { error: "Missing rule." };

  const parsed = parseRule(formData);
  if (typeof parsed === "string") return { error: parsed };
  const { steps, ...rule } = parsed;

  // Replace the ladder wholesale rather than diffing it: the rungs are
  // identified by their failure count, which is exactly what an edit changes.
  await prisma.$transaction([
    prisma.monitorStep.deleteMany({ where: { ruleId: id } }),
    prisma.monitorRule.update({
      where: { id },
      data: { ...rule, steps: { create: steps } },
    }),
    // The counters are about the old rule. Keeping them would mean a rule
    // whose threshold just went up acting immediately on failures it counted
    // under the previous one.
    prisma.monitorState.deleteMany({ where: { ruleId: id } }),
  ]);

  const told = await tellHub(true);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "monitorRule.update",
      targetType: "MonitorRule",
      targetId: id,
      meta: { name: rule.name, signal: rule.signal, enabled: rule.enabled },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: savedMessage(told) };
}

/**
 * The switch on a rule's row, without opening it.
 *
 * Turning a rule off is the thing people do most here — a rule that is firing
 * on a fault somebody is already fixing, or one being tried out on a quiet
 * fleet. Making that cost opening the editor and saving fourteen fields back
 * is how a rule gets left running when it should not be.
 */
export async function setMonitorRuleEnabled(id: string, enabled: boolean): Promise<ActionState> {
  const user = await requireOperator();
  const rule = await prisma.monitorRule.findUnique({ where: { id }, select: { name: true } });
  if (!rule) return { error: "That rule is already gone." };

  await prisma.$transaction([
    prisma.monitorRule.update({ where: { id }, data: { enabled } }),
    // The counters are about the rule as it was running. A rule switched back
    // on starts from nothing rather than acting on failures counted while
    // nobody was watching it.
    prisma.monitorState.deleteMany({ where: { ruleId: id } }),
  ]);

  const told = await tellHub(true);
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "monitorRule.update",
      targetType: "MonitorRule",
      targetId: id,
      meta: { name: rule.name, enabled, hubNotified: told },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: savedMessage(told) };
}

export async function deleteMonitorRule(id: string): Promise<ActionState> {
  const user = await requireOperator();
  const rule = await prisma.monitorRule.findUnique({ where: { id }, select: { name: true } });
  if (!rule) return { error: "That rule is already gone." };

  await prisma.monitorRule.delete({ where: { id } });
  await tellHub(true);

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userEmail: user.email,
      action: "monitorRule.delete",
      targetType: "MonitorRule",
      targetId: id,
      meta: { name: rule.name },
    },
  });

  revalidatePath("/settings");
  return { ok: true, message: `Removed "${rule.name}".` };
}
