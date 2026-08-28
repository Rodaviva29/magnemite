"use client";

import { useActionState, useState, useTransition } from "react";
import { Binoculars, MessageSquare, Send } from "lucide-react";
import { sendTestAlert, updateMonitorSettings } from "@/actions/monitoring";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { Select } from "@/components/ui/select";
import { NumberField, SettingGroup } from "@/components/settings/setting-fields";
import { LEVEL_OPTIONS } from "@/lib/monitor-vocabulary";
import type { MonitorSettingsRow } from "@/components/settings/monitoring-section";

/**
 * The monitoring knobs, on the Hub tab rather than beside the rules.
 *
 * They are tuning, not policy: ceilings, graces and intervals, all of them
 * measured against numbers that were already here — the pass runs once per
 * heartbeat, and `AGENT_OFFLINE` fires on the offline timeout two cards up.
 * Kept next to what they are measured against, the couplings explain
 * themselves; a tab away, each one had to be restated in a hint.
 *
 * The Monitoring tab keeps what an operator actually edits day to day: the
 * switch, and the rules.
 *
 * Still their own forms, and still the `monitor.` group in the one `Setting`
 * table — same page, separate saves, so a half-typed ceiling cannot take the
 * heartbeat down with it.
 */

export function MonitorTuningCard({
  settings,
  disabled,
}: {
  settings: MonitorSettingsRow;
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

          {/* No heartbeat or offline readout here any more: both are real
              fields on the Hub settings card directly above, and a disabled
              copy of a number a screen away from its input reads as a second
              knob. What the pass is measured against is the heartbeat — once
              per beat, because a pass reads what the boxes last said and they
              say it once per beat. */}
          <SettingGroup title="Timing">
            <NumberField
              name="rotomSyncSeconds"
              label="Ask Rotom every"
              value={settings.rotomSyncSeconds}
              min={10}
              disabled={disabled}
              onValueChange={setRotomSync}
              hint="One request for the whole fleet, and only with the integration switched on in .env."
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
              hint="Past it, the box gets one critical alert."
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
              hint="Set 0 to keep data history forever."
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

export function MonitorDiscordCard({
  settings,
  disabled,
}: {
  settings: MonitorSettingsRow;
  disabled: boolean;
}) {
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
