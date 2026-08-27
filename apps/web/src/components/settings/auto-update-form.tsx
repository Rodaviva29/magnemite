"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateAutoUpdate } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type AutoUpdateTarget = {
  id: string;
  displayName: string;
  packageName: string;
  autoUpdateEnabled: boolean;
  autoApprove: boolean;
  canaryCount: number;
  soakMinutes: number;
  maxAttempts: number;
  windowStart: string | null;
  windowEnd: string | null;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function AutoUpdateForm({
  target,
  disabled,
}: {
  target: AutoUpdateTarget;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateAutoUpdate, {});
  const [enabled, setEnabled] = useState(target.autoUpdateEnabled);
  const [autoApprove, setAutoApprove] = useState(target.autoApprove);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-update · {target.displayName}</CardTitle>
        <CardDescription>
          When a newer approved version appears at either source, the hub caches it and rolls it out
          on its own. One rollout at a time per app, never a downgrade.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="appTargetId" value={target.id} />

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <Label htmlFor={`auto-${target.id}`}>Automatic rollouts</Label>
              <p className="text-xs text-muted-foreground">
                Off means new versions are only ever discovered and cached; you start the rollout.
              </p>
            </div>
            <Switch
              id={`auto-${target.id}`}
              name="autoUpdateEnabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <Label htmlFor={`approve-${target.id}`}>Approve new versions automatically</Label>
              <p className="text-xs text-muted-foreground">
                Off means a human ticks approve on the Versions page before auto-update will touch a
                build.
              </p>
            </div>
            <Switch
              id={`approve-${target.id}`}
              name="autoApprove"
              checked={autoApprove}
              onCheckedChange={setAutoApprove}
              disabled={disabled}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`canary-${target.id}`}>Canary devices</Label>
              <Input
                id={`canary-${target.id}`}
                name="canaryCount"
                type="number"
                min={0}
                defaultValue={target.canaryCount}
                disabled={disabled}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`soak-${target.id}`}>Soak minutes</Label>
              <Input
                id={`soak-${target.id}`}
                name="soakMinutes"
                type="number"
                min={0}
                defaultValue={target.soakMinutes}
                disabled={disabled}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`attempts-${target.id}`}>Attempts per device</Label>
              <Input
                id={`attempts-${target.id}`}
                name="maxAttempts"
                type="number"
                min={1}
                defaultValue={target.maxAttempts}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`start-${target.id}`}>Window start (HH:MM)</Label>
              <Input
                id={`start-${target.id}`}
                name="windowStart"
                placeholder="03:00"
                defaultValue={target.windowStart ?? ""}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`end-${target.id}`}>Window end (HH:MM)</Label>
              <Input
                id={`end-${target.id}`}
                name="windowEnd"
                placeholder="06:00"
                defaultValue={target.windowEnd ?? ""}
                disabled={disabled}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Leave both blank to let automatic rollouts dispatch at any hour. The window only gates
            automatic rollouts; a manual one always starts immediately.
          </p>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state.message ? <p className="text-sm text-success">{state.message}</p> : null}

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
