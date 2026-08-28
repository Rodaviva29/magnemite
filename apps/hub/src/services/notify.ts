import { type MonitorLevel, type MonitorSignal, prisma } from "@magnemite/db";
import { getMonitorSettings } from "./hubSettings.js";
import { env } from "../env.js";
import { log } from "../log.js";

/**
 * Outbound alerts, which until now Magnemite had none of.
 *
 * The rule this file exists to enforce is that **notifying never breaks
 * remediation**. A Discord outage, a revoked webhook, a rate limit — none of
 * those are reasons to stop restarting a dead scanner, so nothing here throws
 * into the engine and every failure is a log line and a `notified: false` on
 * the event that was supposed to go out. A silent hour then has an
 * explanation sitting in the events table rather than being a mystery.
 */

const LEVEL_RANK: Record<MonitorLevel, number> = { INFO: 0, WARN: 1, CRITICAL: 2 };

/** Discord's embed colours, as the integers its API wants. */
const LEVEL_COLOUR: Record<MonitorLevel, number> = {
  INFO: 0x3b_82_f6,
  WARN: 0xf5_9e_0b,
  CRITICAL: 0xef_44_44,
};

const LEVEL_ICON: Record<MonitorLevel, string> = {
  INFO: "✅",
  WARN: "⚠️",
  CRITICAL: "🔴",
};

export type AlertInput = {
  deviceId: string;
  deviceName: string;
  groupName: string | null;
  signal: MonitorSignal;
  level: MonitorLevel;
  message: string;
  action: string | null;
  actionOk: boolean | null;
  detail: string | null;
};

function parseLevel(value: string): MonitorLevel {
  return value === "INFO" || value === "WARN" || value === "CRITICAL" ? value : "WARN";
}

/**
 * Has this box already been announced for this signal recently?
 *
 * Read off the events table rather than an in-memory map on purpose: the
 * dedupe window outlives a hub restart, and a deploy is exactly the moment a
 * fleet reconnects at once and would otherwise announce everything twice.
 */
async function announcedRecently(
  deviceId: string,
  signal: MonitorSignal,
  minutes: number,
): Promise<boolean> {
  if (minutes <= 0) return false;

  const since = new Date(Date.now() - minutes * 60_000);
  const previous = await prisma.monitorEvent.findFirst({
    where: { deviceId, signal, notified: true, at: { gte: since } },
    select: { id: true },
  });
  return previous !== null;
}

/**
 * Send one alert, and say whether it went.
 *
 * The return value is what the caller stores as `notified`, so "suppressed by
 * the level filter" and "Discord refused it" both come back as false — the
 * difference is in the log, and in whether an operator finds the webhook
 * field empty when they go looking.
 */
export async function notify(alert: AlertInput): Promise<boolean> {
  const settings = await getMonitorSettings();
  if (!settings.discordWebhookUrl) return false;
  if (LEVEL_RANK[alert.level] < LEVEL_RANK[parseLevel(settings.discordMinLevel)]) return false;

  if (await announcedRecently(alert.deviceId, alert.signal, settings.alertDedupeMinutes)) {
    log.debug({ device: alert.deviceName, signal: alert.signal }, "alert deduped");
    return false;
  }

  return post(settings.discordWebhookUrl, buildPayload(alert, settings.discordMentionRoleId));
}

/**
 * The link back to the box, so an alert is one click from doing something.
 *
 * `/devices/:id` is a dashboard page, so it is built on the dashboard's origin
 * -- not `MAGNEMITE_PUBLIC_URL`, which is the address the *boxes* use. Where
 * the two are separate hosts (Coolify) that domain is Caddy, which answers
 * `/files/*`, `/ws/device`, `/api/enroll` and `/healthz` and 404s the rest.
 * The fallback is for the single-domain deployments, where they are the same.
 */
function deviceUrl(deviceId: string): string {
  const base = env.MAGNEMITE_DASHBOARD_URL ?? env.MAGNEMITE_PUBLIC_URL;
  return `${base.replace(/\/$/, "")}/devices/${deviceId}`;
}

function buildPayload(alert: AlertInput, mentionRoleId: string): unknown {
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Device", value: `[${alert.deviceName}](${deviceUrl(alert.deviceId)})`, inline: true },
    { name: "Group", value: alert.groupName ?? "—", inline: true },
  ];

  if (alert.action && alert.action !== "NOTIFY_ONLY") {
    fields.push({
      name: "Action",
      // Whether it worked is the second half of the sentence, and the half an
      // operator is actually deciding on: a failed restart needs a person.
      value: `${alert.action}${alert.actionOk === null ? "" : alert.actionOk ? " ✓" : " ✗ failed"}`,
      inline: true,
    });
  }
  if (alert.detail) {
    // Fenced, because a detail is usually a line of log or command output and
    // Discord would otherwise render its punctuation as markdown.
    fields.push({ name: "Detail", value: `\`\`\`\n${clamp(alert.detail, 900)}\n\`\`\`` });
  }

  return {
    // Only CRITICAL pings. A role mention on every warning is how a channel
    // gets muted, which costs the alert that mattered.
    content: mentionRoleId && alert.level === "CRITICAL" ? `<@&${mentionRoleId}>` : undefined,
    embeds: [
      {
        title: `${LEVEL_ICON[alert.level]} ${alert.deviceName} — ${alert.message}`,
        color: LEVEL_COLOUR[alert.level],
        fields,
        footer: { text: `Magnemite · ${alert.signal}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function post(webhookUrl: string, payload: unknown): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;

      // Discord says exactly how long to wait, and a fleet that just came back
      // from a deploy can hit this legitimately. One retry, then give up —
      // there is another beat along shortly.
      if (res.status === 429 && attempt === 0) {
        const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
        const waitMs = Math.min((body?.retry_after ?? 1) * 1000, 5_000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      log.warn({ status: res.status }, "discord webhook refused an alert");
      return false;
    } catch (err) {
      log.warn({ err }, "discord webhook unreachable");
      return false;
    }
  }
  return false;
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Prove the webhook before anyone trusts it.
 *
 * Deliberately bypasses the level filter and the dedupe window: someone
 * pressing a button called "Send test alert" wants to see a message, not to
 * discover thirty minutes later that one was suppressed.
 */
export async function sendTestAlert(): Promise<{ ok: boolean; error: string | null }> {
  const settings = await getMonitorSettings();
  if (!settings.discordWebhookUrl) {
    return { ok: false, error: "No Discord webhook URL is set." };
  }

  const ok = await post(
    settings.discordWebhookUrl,
    buildPayload(
      {
        deviceId: "test",
        deviceName: "Test alert",
        groupName: null,
        signal: "AGENT_OFFLINE",
        level: "INFO",
        message: "monitoring is wired up",
        action: null,
        actionOk: null,
        detail: "This is what a real alert will look like.",
      },
      "",
    ),
  );
  return {
    ok,
    error: ok ? null : "Discord did not accept the message. Check the webhook URL.",
  };
}
