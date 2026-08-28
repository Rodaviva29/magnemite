"use client";

import { useActionState, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  Bell,
  BellOff,
  Binoculars,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  deleteMonitorRule,
  sendTestAlert,
  setMonitorEnabled,
  setMonitorRuleEnabled,
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
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  MonitorRuleDialog,
  type GroupChoice,
  type MonitorRuleRow,
} from "@/components/settings/monitor-rule-dialog";
import { NumberField, SettingGroup, Suffixed } from "@/components/settings/setting-fields";
import { actionMeta, LEVEL_OPTIONS, signalMeta } from "@/lib/monitor-vocabulary";
import { cn } from "@/lib/utils";

export type {
  GroupChoice,
  MonitorRuleRow,
  MonitorStepRow,
} from "@/components/settings/monitor-rule-dialog";

export type MonitorSettingsRow = {
  enabled: boolean;
  unreachableAlertSeconds: number;
  rotomSyncSeconds: number;
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
      {/* The master switch first, on its own: it is the one control here that
          decides whether any of the rest happens, and reading a page of rules
          without knowing that answer is reading it twice. Then the rules —
          what this tab is for — and only then the numbers around them. */}
      <MasterSwitch enabled={settings.enabled} disabled={disabled} />
      <RulesCard
        rules={rules}
        groups={groups}
        enabled={settings.enabled}
        deviceCount={deviceCount}
        capableCount={capableCount}
        disabled={disabled}
      />
      <SettingsCard settings={settings} heartbeatSeconds={heartbeatSeconds} disabled={disabled} />
      <DiscordCard settings={settings} disabled={disabled} />
    </>
  );
}

/**
 * Is any of this running.
 *
 * Saves on the flick rather than through a Save button, for the same reason
 * the switch on a rule row does: it is one boolean, the answer is visible in
 * the control itself, and a switch that needs confirming somewhere else is a
 * switch people leave in the wrong position. Optimistic, and it springs back
 * with the reason if the server disagrees.
 */
function MasterSwitch({ enabled, disabled }: { enabled: boolean; disabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setOn(next);
    setError(null);
    startTransition(async () => {
      const result = await setMonitorEnabled(next);
      if (result.error) {
        setOn(!next);
        setError(result.error);
      } else if (result.message && result.message !== "Saved.") {
        // Saved, but the hub is still running on the old value — the one
        // outcome a switch cannot show by moving.
        setError(result.message);
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              on ? "bg-primary/10 text-primary" : "bg-subtle text-muted-foreground",
            )}
          >
            <Binoculars className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <Label htmlFor="monitoring-enabled" className="text-sm font-semibold">
              Watchdog
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Turn the watchdog on or off. When off, the rules are not run and no alerts are sent.
            </p>
            {error ? <p className="mt-2 text-xs text-warning">{error}</p> : null}
          </div>
        </div>

        <Switch
          id="monitoring-enabled"
          checked={on}
          onCheckedChange={toggle}
          disabled={disabled || pending}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The rules
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
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const needsAgent = rules.some((rule) => rule.enabled && signalMeta(rule.signal).needsAgent);
  const behind = deviceCount - capableCount;
  const on = rules.filter((rule) => rule.enabled).length;

  // Worth a search box only once the list is long enough to have to look
  // through; below that it is a control with nothing to do.
  const searchable = rules.length > 6;
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return rules;
    return rules.filter((rule) =>
      `${rule.name} ${signalMeta(rule.signal).label} ${rule.packageName ?? ""}`
        .toLowerCase()
        .includes(words),
    );
  }, [rules, query]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-muted-foreground" />
            Rules
            {rules.length > 0 ? (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">
                {on} of {rules.length} on
              </span>
            ) : null}
          </CardTitle>
          <CardDescription className="mt-1">
            Each rule is a configurable probe that checks a box's state and takes action if it is
            wrong.
          </CardDescription>
        </div>

        {!disabled ? (
          <Button type="button" size="sm" className="shrink-0" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New rule
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!enabled && on > 0 ? (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            Monitoring is disabled, no rules are run and no alerts are sent.
          </p>
        ) : null}

        {needsAgent && behind > 0 ? (
          <p className="rounded-lg border border-border bg-subtle p-3 text-xs text-muted-foreground">
            {behind} of {deviceCount} boxes run an agent from before monitoring existed. Rules that
            need the box to look at itself skip those rather than reading their silence as a fault —
            they update themselves in due course.
          </p>
        ) : null}

        {searchable ? (
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search rules"
            aria-label="Search rules"
            className="max-w-xs"
          />
        ) : null}

        {rules.length === 0 ? (
          <EmptyRules disabled={disabled} onCreate={() => setCreating(true)} />
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No rule matches that.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((rule) => (
              <RuleRow key={rule.id} rule={rule} groups={groups} disabled={disabled} />
            ))}
          </div>
        )}
      </CardContent>

      {/* Mounted only while open, so an abandoned draft is not what the next
          "New rule" opens on. */}
      {creating ? (
        <MonitorRuleDialog groups={groups} open onOpenChange={() => setCreating(false)} />
      ) : null}
    </Card>
  );
}

/**
 * One rule, as much of it as reads at a glance.
 *
 * The whole row opens the editor, which is why the switch and the bin sit above
 * that hit area rather than inside it: turning a rule off is the thing people
 * come here to do most, and it should not cost opening the rule and saving it
 * back.
 */
function RuleRow({
  rule,
  groups,
  disabled,
}: {
  rule: MonitorRuleRow;
  groups: GroupChoice[];
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Optimistic, because the round-trip includes telling the hub, and a switch
  // that sits still for that reads as a switch that did not take.
  const [on, setOn] = useState(rule.enabled);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggling, startToggle] = useTransition();

  const meta = signalMeta(rule.signal);
  const Icon = meta.icon;
  const group = rule.groupId ? groups.find((choice) => choice.id === rule.groupId) : null;

  function toggle(next: boolean) {
    setOn(next);
    setToggleError(null);
    startToggle(async () => {
      const result = await setMonitorRuleEnabled(rule.id, next);
      if (result.error) {
        setOn(!next);
        setToggleError(result.error);
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border transition-colors",
        "hover:border-border-emphasis hover:bg-subtle/50",
        !on && "opacity-70",
      )}
    >
      <div className="relative flex items-start gap-3 p-3">
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            on ? "bg-primary/10 text-primary" : "bg-subtle text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <button
          type="button"
          onClick={() => setEditing(true)}
          // The pseudo-element is the hit area, so the whole row opens the rule
          // while the controls to its right keep their own clicks.
          className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{rule.name}</span>
            {group ? <Badge variant="secondary">{group.name}</Badge> : null}
            <LevelBadge level={rule.notifyLevel} />
            {rule.notify ? (
              <Badge variant="secondary">
                <Bell className="h-3 w-3" />
                Announced
              </Badge>
            ) : (
              <Badge variant="outline">
                <BellOff className="h-3 w-3" />
                Quiet
              </Badge>
            )}
          </span>

          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {meta.label}
            {rule.threshold > 1 ? ` after ${rule.threshold} in a row` : ""}
            {rule.packageName ? ` · ${rule.packageName}` : ""}
            {rule.windowStart ? ` · ${rule.windowStart}–${rule.windowEnd}` : ""}
          </span>

          <Ladder steps={rule.steps} />
        </button>

        {!disabled ? (
          <div className="relative z-10 flex shrink-0 items-center gap-1">
            <Switch
              checked={on}
              onCheckedChange={toggle}
              disabled={toggling}
              aria-label={`${on ? "Disable" : "Enable"} ${rule.name}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setEditing(true)}
              aria-label={`Edit ${rule.name}`}
              className="hidden sm:inline-flex"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
              aria-label={`Remove ${rule.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {/* A switch that sprang back needs to say why, and it is the only thing
          on this row that can fail without a dialog to say it in. */}
      {toggleError ? (
        <p className="border-t border-border px-3 py-2 text-xs text-destructive">{toggleError}</p>
      ) : null}

      {editing ? (
        <MonitorRuleDialog
          rule={rule}
          groups={groups}
          open
          onOpenChange={() => setEditing(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove "${rule.name}"?`}
        description="The rule and its counters go."
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
    </div>
  );
}

/**
 * What a rule is worth saying, always — not only when it is the loud one.
 *
 * Only Critical used to carry a badge, which made a row with none of them
 * ambiguous: a warning and an info rule looked identical, and the level is
 * what the Discord minimum is weighed against.
 */
function LevelBadge({ level }: { level: string }) {
  if (level === "CRITICAL") return <Badge variant="danger">Critical</Badge>;
  if (level === "INFO") return <Badge variant="info">Info</Badge>;
  return <Badge variant="warning">Warning</Badge>;
}

/** The ladder as chips, in the order it is climbed. */
function Ladder({ steps }: { steps: MonitorRuleRow["steps"] }) {
  const sorted = [...steps].sort((a, b) => a.atFailure - b.atFailure);

  return (
    <span className="mt-2 flex flex-wrap items-center gap-1.5">
      {sorted.map((step, index) => {
        const meta = actionMeta(step.action);
        const Icon = meta.icon;
        return (
          <span key={`${step.atFailure}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-xs text-muted-foreground">→</span> : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4",
                // The rung that costs a box ten minutes should not look like
                // the one that force-stops an app.
                meta.hard
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-subtle text-muted-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function EmptyRules({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <Binoculars className="h-6 w-6 text-muted-foreground" />
      <p className="max-w-md text-sm text-muted-foreground">
        No rules yet. A new rule starts switched off — nothing is probed and nothing is touched
        until you turn it on.
      </p>
      {!disabled ? (
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Write the first one
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The switch and the ceilings
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
  // Mirrored out of its own input so the delay below can name its floor while
  // it is being typed, rather than after a save that the server rejects.
  const [rotomSync, setRotomSync] = useState(settings.rotomSyncSeconds);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Binoculars className="h-4 w-4 text-muted-foreground" />
          How it watches
        </CardTitle>
        <CardDescription>
          When a reading counts, and the ceilings that keep a rule which turns out to be wrong from
          restarting a fleet all night.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          {/* The action takes the whole group, and the master switch now lives
              at the top of the tab. Without this, saving a number down here
              would post no `enabled` at all and read as switching monitoring
              off. */}
          <input type="hidden" name="enabled" value={settings.enabled ? "on" : ""} />

          <SettingGroup title="Timing">
            {/* Shown, not set. A pass reads what the boxes last said and they
                say it once per beat, so the heartbeat is the only cadence that
                makes sense — faster re-reads the same reading, slower is just
                lag. Here so the number is visible next to the ones measured
                against it, without pretending it belongs to this form. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="heartbeat-readout">Pass interval</Label>
              <Suffixed suffix="seconds">
                <Input
                  id="heartbeat-readout"
                  type="number"
                  value={heartbeatSeconds}
                  disabled
                  readOnly
                />
              </Suffixed>
              <p className="text-xs text-muted-foreground">
                Every box is looked at once per heartbeat. Set in{" "}
                <a href="#hub" className="underline underline-offset-2">
                  Settings → Hub
                </a>
                , because it is the boxes&rsquo; own beat.
              </p>
            </div>
            <NumberField
              name="unreachableAlertSeconds"
              label="Unreachable after"
              value={settings.unreachableAlertSeconds}
              min={30}
              disabled={disabled}
              hint="How long a box may be gone before that is worth saying. Longer than the offline timeout, which only decides when it is marked offline."
            />
            <NumberField
              name="rotomSyncSeconds"
              label="Ask Rotom every"
              value={settings.rotomSyncSeconds}
              min={10}
              disabled={disabled}
              onValueChange={setRotomSync}
              hint="One request for the whole fleet, and only with the integration switched on in .env. Everything Rotom-shaped is this fresh at best — the Scanner column included."
            />
            <NumberField
              name="rotomStaleSeconds"
              label="Rotom stale after"
              value={settings.rotomStaleSeconds}
              // Two sync intervals: a box can never be known to be fresher
              // than the last time anyone asked Rotom about it.
              min={rotomSync * 2}
              disabled={disabled}
              hint={`How long since Rotom last saw a box before that counts as disconnected. Asking every ${rotomSync}s means anything under ${rotomSync * 2}s alerts on the sync's own lag rather than on a box.`}
            />
          </SettingGroup>

          <SettingGroup title="Grace">
            <NumberField
              name="rebootGraceSeconds"
              label="After a reboot"
              value={settings.rebootGraceSeconds}
              min={60}
              disabled={disabled}
              hint="Nothing touches a box for this long after Magnemite rebooted it. Without it, the box coming back slowly reads as a fault and it is rebooted again."
            />
            <NumberField
              name="startupGraceSeconds"
              label="After a hub restart"
              value={settings.startupGraceSeconds}
              min={0}
              disabled={disabled}
              hint="A restart drops every device socket at once and the fleet reconnects over the next few seconds. Nothing acts until that has settled."
            />
          </SettingGroup>

          <SettingGroup title="Ceilings">
            <NumberField
              name="maxActionsPerDeviceHour"
              label="Actions per box per hour"
              value={settings.maxActionsPerDeviceHour}
              min={1}
              unit="at most"
              disabled={disabled}
              hint="The circuit breaker. Past it, the box gets one critical alert."
            />
            <NumberField
              name="maxRebootsPerDeviceDay"
              label="Reboots per box per day"
              value={settings.maxRebootsPerDeviceDay}
              min={1}
              unit="at most"
              disabled={disabled}
              hint="The same, for the expensive half of the ladder."
            />
          </SettingGroup>

          <SettingGroup title="Noise and history">
            <NumberField
              name="alertDedupeMinutes"
              label="Repeat an alert after"
              value={settings.alertDedupeMinutes}
              min={0}
              unit="minutes"
              disabled={disabled}
              hint="The same signal on the same box is not announced again inside this. The action still happens; only the message is held."
            />
            <NumberField
              name="eventRetentionDays"
              label="Keep history for"
              value={settings.eventRetentionDays}
              min={0}
              unit="days"
              disabled={disabled}
              hint="How long the Monitoring page can look back. 0 keeps it forever."
            />
          </SettingGroup>

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
// Discord
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
          Where alerts go, configured in the channel&rsquo;s Integrations settings. Empty turns
          notifications off and leaves the rules running.
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

          <div className="flex flex-col gap-1.5">
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
            <div className="flex flex-col gap-1.5">
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="discordMentionRoleId">Role to ping (optional)</Label>
              <Input
                id="discordMentionRoleId"
                name="discordMentionRoleId"
                placeholder="123456789012345678"
                defaultValue={settings.discordMentionRoleId}
                disabled={disabled}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">Pinged on critical alerts only.</p>
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
