"use client";

import { useActionState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { updateHubSettings } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";

export type HubSettingsRow = {
  maxConcurrentJobs: number;
  jobStallTimeoutSeconds: number;
  sourcePollMinutes: number;
  updateCooldownMinutes: number;
  metricsSampleSeconds: number;
  metricsRetentionDays: number;
  heartbeatSeconds: number;
  agentUpdateConcurrency: number;
  deviceOfflineTimeoutSeconds: number;
};

export function HubSettingsForm({
  settings,
  disabled,
}: {
  settings: HubSettingsRow;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateHubSettings, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          Hub settings
        </CardTitle>
        <CardDescription>
          Fleet-wide operational knobs. Changes take effect within a few seconds, no restart needed.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxConcurrentJobs">Max concurrent jobs</Label>
              <Input
                id="maxConcurrentJobs"
                name="maxConcurrentJobs"
                type="number"
                min={1}
                defaultValue={settings.maxConcurrentJobs}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Fleet-wide cap on devices downloading or installing at once.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="jobStallTimeoutSeconds">Job stall timeout (seconds)</Label>
              <Input
                id="jobStallTimeoutSeconds"
                name="jobStallTimeoutSeconds"
                type="number"
                min={1}
                defaultValue={settings.jobStallTimeoutSeconds}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Silence from a box mid-job before it's re-queued.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="sourcePollMinutes">Source poll interval (minutes)</Label>
              <Input
                id="sourcePollMinutes"
                name="sourcePollMinutes"
                type="number"
                min={1}
                defaultValue={settings.sourcePollMinutes}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                How often every enabled version source is checked for new builds.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="updateCooldownMinutes">Auto-update cooldown (minutes)</Label>
              <Input
                id="updateCooldownMinutes"
                name="updateCooldownMinutes"
                type="number"
                min={0}
                defaultValue={settings.updateCooldownMinutes}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Minimum time since an app's last auto-update rollout finished before another one is
                allowed to start. 0 updates as soon as a new version is discovered.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="metricsSampleSeconds">Health sample interval (seconds)</Label>
              <Input
                id="metricsSampleSeconds"
                name="metricsSampleSeconds"
                type="number"
                min={5}
                defaultValue={settings.metricsSampleSeconds}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                How often a box's CPU, memory, storage, temperature and per-app usage are kept for
                the history charts. Cannot be shorter than the heartbeat — there is nothing extra to
                store between beats.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="heartbeatSeconds">Heartbeat interval (seconds)</Label>
              <Input
                id="heartbeatSeconds"
                name="heartbeatSeconds"
                type="number"
                min={5}
                defaultValue={settings.heartbeatSeconds}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                How often each box reports in. Unlike everything else here it lives on the boxes: a
                box adopts it on its next connection, not straight away, and an agent too old to
                read it keeps beating at 20s. The offline timeout and the sample interval are
                measured against it.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="agentUpdateConcurrency">Concurrent agent updates</Label>
              <Input
                id="agentUpdateConcurrency"
                name="agentUpdateConcurrency"
                type="number"
                min={1}
                defaultValue={settings.agentUpdateConcurrency}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                How many boxes may swap their agent binary at once. The whole fleet reconnecting
                after a hub deploy is when this matters.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="deviceOfflineTimeoutSeconds">Device offline timeout (seconds)</Label>
              <Input
                id="deviceOfflineTimeoutSeconds"
                name="deviceOfflineTimeoutSeconds"
                type="number"
                min={30}
                defaultValue={settings.deviceOfflineTimeoutSeconds}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Silence from a box before it is marked offline. Boxes beat every 20 seconds, so this
                is really how many missed beats you will tolerate — raise it for a site on a flaky
                uplink.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="metricsRetentionDays">Health history retention (days)</Label>
              <Input
                id="metricsRetentionDays"
                name="metricsRetentionDays"
                type="number"
                min={0}
                defaultValue={settings.metricsRetentionDays}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                How long those samples are kept before the hub prunes them. 0 turns recording off
                and drops what is already stored.
              </p>
            </div>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {/* The button reports a plain save on its own. This is for the one
              outcome it cannot show: saved, but the hub was not reachable to
              be told, so it is still running on the old numbers. */}
          {state.ok && state.message && state.message !== "Saved." ? (
            <p className="text-sm text-warning">{state.message}</p>
          ) : null}

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
