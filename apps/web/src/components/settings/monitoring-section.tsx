"use client";

import { useActionState, useState, useTransition } from "react";
import {
  Activity,
  ChevronDown,
  MessageSquare,
  Plus,
  Send,
  Siren,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  createMonitorRule,
  deleteMonitorRule,
  runMonitorNow,
  sendTestAlert,
  updateMonitorRule,
  updateMonitorSettings,
} from "@/actions/monitoring";
import type { ActionState } from "@/actions/rollouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { RelativeTime } from "@/components/relative-time";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type MonitorSettingsRow = {
  enabled: boolean;
  unreachableAlertSeconds: number;
  rotomStaleSeconds: number;
  rebootGraceSeconds: number;
  startupGraceSeconds: number;
  maxActionsPerDeviceHour: number;
  maxRebootsPerDeviceDay: number;
  alertDedupeMinutes: number;
  eventRetentionDays: number;
  discordWebhookUrl: string;
  discordMinLevel: string;
  discordMentionRoleId: string;
};

export type MonitorStepRow = {
  atFailure: number;
  action: string;
  command: string | null;
};

export type MonitorRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  signal: string;
  packageName: string | null;
  groupId: string | null;
  threshold: number;
  cooldownSeconds: number;
  windowStart: string | null;
  windowEnd: string | null;
  notifyLevel: string;
  notify: boolean;
  probe: {
    kind: string;
    target: string;
    expect: string | null;
    lines: number;
    failAt: number;
    successPattern: string | null;
    maxRatio: number | null;
    maxAgeSeconds: number | null;
    timeoutSeconds: number;
  } | null;
  steps: MonitorStepRow[];
};

export type MonitorEventRow = {
  id: string;
  at: string;
  deviceName: string;
  signal: string;
  level: string;
  message: string;
  action: string | null;
  actionOk: boolean | null;
  detail: string | null;
  notified: boolean;
};

export type GroupChoice = { id: string; name: string };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const SIGNAL_OPTIONS = [
  { value: "SERVICE_DOWN", label: "Service is down" },
  { value: "APP_NOT_FOREGROUND", label: "App is not in focus" },
  { value: "APP_ANR", label: "App is not responding" },
  { value: "HEALTH_CHECK_FAILED", label: "Health check is failing" },
  { value: "LOOP_STALLED", label: "Loop has stalled" },
  { value: "AGENT_OFFLINE", label: "Box is unreachable" },
  { value: "ROTOM_DISCONNECTED", label: "Rotom lost the box" },
];

const ACTION_OPTIONS = [
  { value: "NOTIFY_ONLY", label: "Only tell me" },
  { value: "RESTART_APP", label: "Restart the app" },
  { value: "KILL_APP", label: "Kill the app" },
  { value: "CLEAR_CACHE_RESTART", label: "Clear the cache and restart" },
  { value: "SEND_KEYEVENT", label: "Send ENTER" },
  { value: "START_SERVICE", label: "Start the service" },
  { value: "SHELL", label: "Run a command" },
  { value: "REBOOT", label: "Reboot the box" },
  { value: "ROTOM_RESTART", label: "Restart the scanner in Rotom" },
];

const LEVEL_OPTIONS = [
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warning" },
  { value: "CRITICAL", label: "Critical" },
];

const PROBE_OPTIONS = [
  { value: "none", label: "No probe" },
  { value: "shell", label: "Shell command" },
  { value: "logMatch", label: "Pattern in a log" },
  { value: "http", label: "HTTP endpoint" },
];

/** Signals the box has to answer for, so an old agent simply cannot report them. */
const AGENT_SIGNALS = new Set([
  "APP_NOT_FOREGROUND",
  "APP_ANR",
  "HEALTH_CHECK_FAILED",
  "LOOP_STALLED",
]);

function labelFor(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/**
 * The rules and the knobs behind them.
 *
 * What this tab deliberately does *not* hold is the record of what the rules
 * did — that lives on the Monitoring page in the main nav, because it answers
 * an operational question rather than a configuration one, and because a feed
 * that grows all day does not belong in Settings.
 */
export function MonitoringSection({
  settings,
  heartbeatSeconds,
  rules,
  groups,
  deviceCount,
  capableCount,
  disabled,
}: {
  settings: MonitorSettingsRow;
  /** From Settings → Hub. Shown here, not set here — see the readout below. */
  heartbeatSeconds: number;
  rules: MonitorRuleRow[];
  groups: GroupChoice[];
  deviceCount: number;
  /** Boxes on an agent new enough to run the probes. */
  capableCount: number;
  disabled: boolean;
}) {
  return (
    <>
      <SettingsCard settings={settings} heartbeatSeconds={heartbeatSeconds} disabled={disabled} />
      <DiscordCard settings={settings} disabled={disabled} />
      <RulesCard
        rules={rules}
        groups={groups}
        enabled={settings.enabled}
        deviceCount={deviceCount}
        capableCount={capableCount}
        disabled={disabled}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Card 1 — the switch and the ceilings
// ---------------------------------------------------------------------------

function SettingsCard({
  settings,
  heartbeatSeconds,
  disabled,
}: {
  settings: MonitorSettingsRow;
  heartbeatSeconds: number;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateMonitorSettings, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Siren className="h-4 w-4 text-muted-foreground" />
          Monitoring
        </CardTitle>
        <CardDescription>
          Watches every approved box and acts when one stops working. The ceilings below are what
          keep a rule that turns out to be wrong from restarting a fleet all night.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div className="min-w-0">
              <Label htmlFor="monitoring-enabled">Act on what it sees</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Off, nothing is probed and nothing is touched. Rules can be written and reviewed
                either way.
              </p>
            </div>
            <Switch
              id="monitoring-enabled"
              name="enabled"
              defaultChecked={settings.enabled}
              disabled={disabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Shown, not set. A pass reads what the boxes last said and they
                say it once per beat, so the heartbeat is the only cadence that
                makes sense — faster re-reads the same reading, slower is just
                lag. Here so the number is visible next to the ones measured
                against it, without pretending it belongs to this form. */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="heartbeat-readout">Pass interval (seconds)</Label>
              <Input
                id="heartbeat-readout"
                type="number"
                value={heartbeatSeconds}
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                Every box is looked at once per heartbeat. Set in{" "}
                <a href="#hub" className="underline underline-offset-2">
                  Settings → Hub
                </a>
                , because it is the boxes&rsquo; own beat and several other numbers are measured
                against it.
              </p>
            </div>
            <Field
              name="unreachableAlertSeconds"
              label="Unreachable after (seconds)"
              value={settings.unreachableAlertSeconds}
              min={30}
              disabled={disabled}
              hint="How long a box may be gone before that is worth saying. Longer than the offline timeout, which only decides when it is marked offline."
            />
            <Field
              name="rotomStaleSeconds"
              label="Rotom stale after (seconds)"
              value={settings.rotomStaleSeconds}
              min={120}
              disabled={disabled}
              hint="How long since Rotom last saw a box before that counts as disconnected. The Rotom sync itself runs once a minute."
            />
            <Field
              name="rebootGraceSeconds"
              label="Grace after a reboot (seconds)"
              value={settings.rebootGraceSeconds}
              min={60}
              disabled={disabled}
              hint="Nothing touches a box for this long after Magnemite rebooted it. Without it, the box coming back slowly reads as a fault and it is rebooted again."
            />
            <Field
              name="startupGraceSeconds"
              label="Grace after a hub restart (seconds)"
              value={settings.startupGraceSeconds}
              min={0}
              disabled={disabled}
              hint="A restart drops every device socket at once and the fleet reconnects over the next few seconds. Nothing acts until that has settled."
            />
            <Field
              name="maxActionsPerDeviceHour"
              label="Max actions per box per hour"
              value={settings.maxActionsPerDeviceHour}
              min={1}
              disabled={disabled}
              hint="The circuit breaker. Past it, the box gets one critical alert and is then left alone."
            />
            <Field
              name="maxRebootsPerDeviceDay"
              label="Max reboots per box per day"
              value={settings.maxRebootsPerDeviceDay}
              min={1}
              disabled={disabled}
              hint="The same, for the expensive half of the ladder."
            />
            <Field
              name="alertDedupeMinutes"
              label="Repeat an alert after (minutes)"
              value={settings.alertDedupeMinutes}
              min={0}
              disabled={disabled}
              hint="The same signal on the same box is not announced again inside this. The action still happens; only the message is held."
            />
            <Field
              name="eventRetentionDays"
              label="Keep history for (days)"
              value={settings.eventRetentionDays}
              min={0}
              disabled={disabled}
              hint="How long the activity below is kept. 0 keeps it forever."
            />
          </div>

          <Outcome state={state} />
          {!disabled ? (
            <div className="flex justify-end">
              <SaveButton state={state} />
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  name,
  label,
  value,
  min,
  hint,
  disabled,
}: {
  name: string;
  label: string;
  value: number;
  min: number;
  hint: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        min={min}
        defaultValue={value}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The one outcome a save button cannot show: saved, but the hub could not be
 * told, so it is still running on the old values.
 */
function Outcome({ state }: { state: ActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok && state.message && state.message !== "Saved.") {
    return <p className="text-sm text-warning">{state.message}</p>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Card 2 — Discord
// ---------------------------------------------------------------------------

function DiscordCard({ settings, disabled }: { settings: MonitorSettingsRow; disabled: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateMonitorSettings, {});
  const [test, setTest] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          Discord
        </CardTitle>
        <CardDescription>
          Where alerts go. A webhook that stops working never stops the remediation — a box is still
          restarted, the message simply does not arrive, and the activity below says so.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* The settings action takes the whole group, so this form carries the
            other card's values as hidden fields rather than clearing them. */}
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="enabled" value={settings.enabled ? "on" : ""} />
          <input
            type="hidden"
            name="unreachableAlertSeconds"
            value={settings.unreachableAlertSeconds}
          />
          <input type="hidden" name="rotomStaleSeconds" value={settings.rotomStaleSeconds} />
          <input type="hidden" name="rebootGraceSeconds" value={settings.rebootGraceSeconds} />
          <input type="hidden" name="startupGraceSeconds" value={settings.startupGraceSeconds} />
          <input
            type="hidden"
            name="maxActionsPerDeviceHour"
            value={settings.maxActionsPerDeviceHour}
          />
          <input
            type="hidden"
            name="maxRebootsPerDeviceDay"
            value={settings.maxRebootsPerDeviceDay}
          />
          <input type="hidden" name="alertDedupeMinutes" value={settings.alertDedupeMinutes} />
          <input type="hidden" name="eventRetentionDays" value={settings.eventRetentionDays} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="discordWebhookUrl">Webhook URL</Label>
            <Input
              id="discordWebhookUrl"
              name="discordWebhookUrl"
              type="url"
              placeholder="https://discord.com/api/webhooks/…"
              defaultValue={settings.discordWebhookUrl}
              disabled={disabled}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              From the channel&rsquo;s Integrations settings. Empty turns notifications off and
              leaves the rules running.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="discordMinLevel">Announce at least</Label>
              <Select
                id="discordMinLevel"
                name="discordMinLevel"
                options={LEVEL_OPTIONS}
                defaultValue={settings.discordMinLevel}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Anything below this is acted on quietly and recorded, but not sent.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="discordMentionRoleId">Role to ping (optional)</Label>
              <Input
                id="discordMentionRoleId"
                name="discordMentionRoleId"
                placeholder="123456789012345678"
                defaultValue={settings.discordMentionRoleId}
                disabled={disabled}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Pinged on critical alerts only. A mention on every warning is how a channel gets
                muted, which costs the alert that mattered.
              </p>
            </div>
          </div>

          <Outcome state={state} />
          {test.error ? <p className="text-sm text-destructive">{test.error}</p> : null}
          {test.ok ? <p className="text-sm text-success">{test.message}</p> : null}

          {!disabled ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => setTest(await sendTestAlert()));
                }}
              >
                <Send className="h-4 w-4" />
                Send test alert
              </Button>
              <SaveButton state={state} />
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Card 3 — the rules
// ---------------------------------------------------------------------------

function RulesCard({
  rules,
  groups,
  enabled,
  deviceCount,
  capableCount,
  disabled,
}: {
  rules: MonitorRuleRow[];
  groups: GroupChoice[];
  enabled: boolean;
  deviceCount: number;
  capableCount: number;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const needsAgent = rules.some((rule) => rule.enabled && AGENT_SIGNALS.has(rule.signal));
  const behind = deviceCount - capableCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-muted-foreground" />
          Rules
        </CardTitle>
        <CardDescription>
          Each rule is a signal, how many bad readings in a row it takes to count, and a ladder of
          what to do about it — soft first, hard second. A rule scoped to a group replaces the
          fleet-wide one for that group rather than adding to it.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!enabled && rules.some((rule) => rule.enabled) ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            Monitoring is switched off above, so none of these are running.
          </p>
        ) : null}

        {needsAgent && behind > 0 ? (
          <p className="rounded-md border border-border bg-subtle p-3 text-xs text-muted-foreground">
            {behind} of {deviceCount} boxes run an agent from before monitoring existed. Rules that
            need the box to look at itself skip those rather than reading their silence as a fault —
            they update themselves in due course.
          </p>
        ) : null}

        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} groups={groups} disabled={disabled} />
            ))}
          </div>
        )}

        {!disabled ? (
          <div className="border-t border-border pt-5">
            {adding ? (
              <RuleForm
                groups={groups}
                action={createMonitorRule}
                submitLabel="Create rule"
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Add a rule
              </Button>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  groups,
  disabled,
}: {
  rule: MonitorRuleRow;
  groups: GroupChoice[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ladder = [...rule.steps]
    .sort((a, b) => a.atFailure - b.atFailure)
    .map((step) => `${step.atFailure} → ${labelFor(ACTION_OPTIONS, step.action)}`)
    .join(" · ");

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{rule.name}</span>
              {rule.enabled ? null : <Badge variant="secondary">Off</Badge>}
              {rule.groupId ? (
                <Badge variant="secondary">
                  {groups.find((group) => group.id === rule.groupId)?.name ?? "group"}
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {labelFor(SIGNAL_OPTIONS, rule.signal)}
              {rule.threshold > 1 ? ` after ${rule.threshold} in a row` : ""} · {ladder}
            </span>
          </span>
        </button>

        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
            aria-label={`Remove ${rule.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove "${rule.name}"?`}
        description="The rule and its counters go. The history it already wrote stays."
        pending={pending}
        error={removeError}
        onConfirm={() => {
          startTransition(async () => {
            const result = await deleteMonitorRule(rule.id);
            setRemoveError(result.error ?? null);
            if (!result.error) setConfirmOpen(false);
          });
        }}
      />

      {open ? (
        <div className="border-t border-border p-3">
          <RuleForm
            rule={rule}
            groups={groups}
            action={updateMonitorRule}
            submitLabel="Save rule"
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One rule, create and edit alike.
 *
 * Shared so the two cannot drift — a rule that could be created but not saved
 * again would be a miserable bug to track down, and the server action parses
 * both with the same function for the same reason.
 */
function RuleForm({
  rule,
  groups,
  action,
  submitLabel,
  onCancel,
  disabled = false,
}: {
  rule?: MonitorRuleRow;
  groups: GroupChoice[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, {});
  const [signal, setSignal] = useState(rule?.signal ?? "SERVICE_DOWN");
  const [probeKind, setProbeKind] = useState(rule?.probe?.kind ?? "none");
  const [steps, setSteps] = useState<MonitorStepRow[]>(
    rule?.steps.length
      ? [...rule.steps].sort((a, b) => a.atFailure - b.atFailure)
      : [{ atFailure: 1, action: "NOTIFY_ONLY", command: null }],
  );

  const groupOptions = [
    { value: "", label: "Every box" },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`name-${rule?.id ?? "new"}`}>Name</Label>
          <Input
            id={`name-${rule?.id ?? "new"}`}
            name="name"
            defaultValue={rule?.name}
            placeholder="Scanner offline"
            disabled={disabled}
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`signal-${rule?.id ?? "new"}`}>Watch for</Label>
          <Select
            id={`signal-${rule?.id ?? "new"}`}
            name="signal"
            options={SIGNAL_OPTIONS}
            value={signal}
            onValueChange={setSignal}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`packageName-${rule?.id ?? "new"}`}>Package</Label>
          <Input
            id={`packageName-${rule?.id ?? "new"}`}
            name="packageName"
            defaultValue={rule?.packageName ?? ""}
            placeholder="com.nianticlabs.pokemongo"
            className="font-mono text-xs"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            What the signal and its actions are about. `{"{pkg}"}` in a command becomes this.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`groupId-${rule?.id ?? "new"}`}>Applies to</Label>
          <Select
            id={`groupId-${rule?.id ?? "new"}`}
            name="groupId"
            options={groupOptions}
            defaultValue={rule?.groupId ?? ""}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`threshold-${rule?.id ?? "new"}`}>Bad readings in a row</Label>
          <Input
            id={`threshold-${rule?.id ?? "new"}`}
            name="threshold"
            type="number"
            min={1}
            defaultValue={rule?.threshold ?? 1}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Before the ladder starts. One acts on the first bad reading.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`cooldownSeconds-${rule?.id ?? "new"}`}>Cooldown (seconds)</Label>
          <Input
            id={`cooldownSeconds-${rule?.id ?? "new"}`}
            name="cooldownSeconds"
            type="number"
            min={0}
            defaultValue={rule?.cooldownSeconds ?? 300}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            The least time between two actions from this rule on one box.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`windowStart-${rule?.id ?? "new"}`}>Only act between</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`windowStart-${rule?.id ?? "new"}`}
              name="windowStart"
              placeholder="09:00"
              defaultValue={rule?.windowStart ?? ""}
              disabled={disabled}
            />
            <span className="text-sm text-muted-foreground">and</span>
            <Input
              name="windowEnd"
              placeholder="23:00"
              defaultValue={rule?.windowEnd ?? ""}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Alerts still go out outside it. Not rebooting a box at 3am is a policy; hiding that it
            needs one is not.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`notifyLevel-${rule?.id ?? "new"}`}>Severity</Label>
          <Select
            id={`notifyLevel-${rule?.id ?? "new"}`}
            name="notifyLevel"
            options={LEVEL_OPTIONS}
            defaultValue={rule?.notifyLevel ?? "WARN"}
            disabled={disabled}
          />
        </div>
      </div>

      {/* --- the probe ------------------------------------------------------ */}
      <div className="flex flex-col gap-4 rounded-md border border-border p-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`probeKind-${rule?.id ?? "new"}`}>How to tell</Label>
          <Select
            id={`probeKind-${rule?.id ?? "new"}`}
            name="probeKind"
            options={PROBE_OPTIONS}
            value={probeKind}
            onValueChange={setProbeKind}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {probeKind === "none"
              ? AGENT_SIGNALS.has(signal)
                ? "This signal needs a probe to answer it."
                : "Answered by the hub — no probe runs on the box."
              : "Runs on the box every heartbeat, inside half the beat. Whatever does not finish reports nothing rather than a failure."}
          </p>
        </div>

        {probeKind !== "none" ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`probeTarget-${rule?.id ?? "new"}`}>
                {probeKind === "shell"
                  ? "Command"
                  : probeKind === "http"
                    ? "URL"
                    : "Log file on the box"}
              </Label>
              <Input
                id={`probeTarget-${rule?.id ?? "new"}`}
                name="probeTarget"
                defaultValue={rule?.probe?.target ?? ""}
                placeholder={
                  probeKind === "shell"
                    ? "dumpsys activity services | grep -e MappingService"
                    : probeKind === "http"
                      ? "http://127.0.0.1:8080/health"
                      : "/data/local/tmp/atlas.log"
                }
                className="font-mono text-xs"
                disabled={disabled}
              />
            </div>

            {probeKind !== "http" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`probeExpect-${rule?.id ?? "new"}`}>
                  {probeKind === "shell" ? "Output must match" : "A fault looks like"}
                </Label>
                <Input
                  id={`probeExpect-${rule?.id ?? "new"}`}
                  name="probeExpect"
                  defaultValue={rule?.probe?.expect ?? ""}
                  placeholder={probeKind === "shell" ? "(optional regex)" : "loop has been stalled"}
                  className="font-mono text-xs"
                  disabled={disabled}
                />
              </div>
            ) : null}

            {probeKind === "logMatch" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`probeLines-${rule?.id ?? "new"}`}>Lines to read</Label>
                  <Input
                    id={`probeLines-${rule?.id ?? "new"}`}
                    name="probeLines"
                    type="number"
                    min={1}
                    defaultValue={rule?.probe?.lines ?? 200}
                    disabled={disabled}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`probeFailAt-${rule?.id ?? "new"}`}>
                    Faults before it counts
                  </Label>
                  <Input
                    id={`probeFailAt-${rule?.id ?? "new"}`}
                    name="probeFailAt"
                    type="number"
                    min={1}
                    defaultValue={rule?.probe?.failAt ?? 1}
                    disabled={disabled}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`probeSuccessPattern-${rule?.id ?? "new"}`}>
                    Work getting done looks like
                  </Label>
                  <Input
                    id={`probeSuccessPattern-${rule?.id ?? "new"}`}
                    name="probeSuccessPattern"
                    defaultValue={rule?.probe?.successPattern ?? ""}
                    placeholder="I \| Worker"
                    className="font-mono text-xs"
                    disabled={disabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Some faults are normal under load and only mean something when they
                    outnumber the work beside them.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`probeMaxAgeSeconds-${rule?.id ?? "new"}`}>
                    Stale after (seconds)
                  </Label>
                  <Input
                    id={`probeMaxAgeSeconds-${rule?.id ?? "new"}`}
                    name="probeMaxAgeSeconds"
                    type="number"
                    min={1}
                    defaultValue={rule?.probe?.maxAgeSeconds ?? ""}
                    disabled={disabled}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Also fail when nothing has been written to the log for this long,
                    which is what a stalled loop looks like from outside.
                  </p>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {/* --- the ladder ----------------------------------------------------- */}
      <StepsEditor steps={steps} onChange={setSteps} disabled={disabled} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch name="enabled" defaultChecked={rule?.enabled ?? false} disabled={disabled} />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch name="notify" defaultChecked={rule?.notify ?? true} disabled={disabled} />
            Announce it
          </label>
        </div>

        {!disabled ? (
          <div className="flex gap-2">
            {onCancel ? (
              <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <SaveButton state={state} size="sm">
              {submitLabel}
            </SaveButton>
          </div>
        ) : null}
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok && state.message && state.message !== "Saved." ? (
        <p className="text-xs text-warning">{state.message}</p>
      ) : null}
    </form>
  );
}

function StepsEditor({
  steps,
  onChange,
  disabled,
}: {
  steps: MonitorStepRow[];
  onChange: (steps: MonitorStepRow[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<MonitorStepRow>) => {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div>
        <Label>What to do about it</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          One rung per failure count. A rung already spent is not spent again, so a box that has
          proved a restart does not help is not restarted forever — except the last rung, which
          repeats at the cooldown because there is nothing stronger left to try.
        </p>
      </div>

      {steps.map((step, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
          <Input
            name="stepAtFailure"
            type="number"
            min={1}
            aria-label="After this many failures"
            value={step.atFailure}
            onChange={(event) => update(index, { atFailure: Number(event.target.value) })}
            disabled={disabled}
          />
          <Select
            name="stepAction"
            options={ACTION_OPTIONS}
            value={step.action}
            onValueChange={(value) => update(index, { action: value })}
            disabled={disabled}
            aria-label="Action"
          />
          {!disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // The ladder must keep at least one rung; a rule with none would
              // detect a fault and then do nothing at all with it.
              disabled={steps.length === 1}
              onClick={() => onChange(steps.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : (
            <span />
          )}

          <Input
            name="stepCommand"
            className="font-mono text-xs sm:col-span-3"
            aria-label="Command override"
            placeholder="Leave empty for the default this action runs"
            value={step.command ?? ""}
            onChange={(event) => update(index, { command: event.target.value || null })}
            disabled={disabled}
          />
        </div>
      ))}

      {!disabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            onChange([
              ...steps,
              {
                atFailure: Math.max(...steps.map((step) => step.atFailure), 0) + 1,
                action: "REBOOT",
                command: null,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" />
          Add a rung
        </Button>
      ) : null}
    </div>
  );
}
