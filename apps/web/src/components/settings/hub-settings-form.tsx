"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateHubSettings } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type HubSettingsRow = {
  maxConcurrentJobs: number;
  jobStallTimeoutSeconds: number;
  sourcePollMinutes: number;
  updateCooldownMinutes: number;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

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
        <CardTitle>Hub settings</CardTitle>
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
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.ok && state.message ? (
            <p className="text-sm text-success">{state.message}</p>
          ) : null}

          {!disabled ? (
            <div className="flex justify-end">
              <Save />
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
