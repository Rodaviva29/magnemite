"use client";

import { useActionState, useState, useTransition } from "react";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { createGroup, deleteGroup, updateGroup } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";

export type GroupRow = {
  id: string;
  name: string;
  preInstallHook: string | null;
  postInstallHook: string | null;
  maxConcurrency: number | null;
  deviceCount: number;
};

export function GroupsSection({ groups, disabled }: { groups: GroupRow[]; disabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          Device groups
        </CardTitle>
        <CardDescription>
          Hooks run as root on the box, around the install. The usual pair is stopping the scanner
          before and starting it again after. Without that, the app is killed mid-scan.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No groups yet. A box enrolling with none configured lands in a group named "default",
            created automatically.
          </p>
        ) : null}

        {groups.map((group) => (
          <GroupForm key={group.id} group={group} disabled={disabled} />
        ))}

        {!disabled ? <CreateGroupForm /> : null}
      </CardContent>
    </Card>
  );
}

function GroupForm({ group, disabled }: { group: GroupRow; disabled: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateGroup, {});
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <input type="hidden" name="groupId" value={group.id} />

      <div className="flex items-center justify-between">
        <h3 className="font-medium">{group.name}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {group.deviceCount} device{group.deviceCount === 1 ? "" : "s"}
          </span>
          {!disabled ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`pre-${group.id}`}>Pre-install hook</Label>
          <Textarea
            id={`pre-${group.id}`}
            name="preInstallHook"
            defaultValue={group.preInstallHook ?? ""}
            placeholder="am force-stop com.nianticlabs.pokemongo"
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`post-${group.id}`}>Post-install hook</Label>
          <Textarea
            id={`post-${group.id}`}
            name="postInstallHook"
            defaultValue={group.postInstallHook ?? ""}
            placeholder="monkey -p com.nianticlabs.pokemongo 1"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 md:max-w-64">
        <Label htmlFor={`conc-${group.id}`}>Concurrent updates in this group</Label>
        <Input
          id={`conc-${group.id}`}
          name="maxConcurrency"
          type="number"
          min={1}
          placeholder="no limit"
          defaultValue={group.maxConcurrency ?? ""}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          For a site on a thin uplink: caps how many of its boxes download at once, under this
          fleet.
        </p>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      {!disabled ? (
        <div className="flex justify-end">
          <SaveButton state={state} size="sm" />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${group.name}?`}
        description={
          group.deviceCount === 0
            ? "Nothing is in this group, so nothing else changes."
            : `${group.deviceCount} device${group.deviceCount === 1 ? "" : "s"} will lose this group.`
        }
        pending={pending}
        error={removeError}
        onConfirm={() => {
          startTransition(async () => {
            const result = await deleteGroup(group.id);
            setRemoveError(result.error ?? null);
            if (!result.error) setConfirmOpen(false);
          });
        }}
      >
        {/* The devices themselves are untouched — worth saying, because
            "remove the group" reads like it might take them with it. */}
        {group.deviceCount > 0 ? (
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted-foreground">
            The devices are not deleted. They keep running and can be put in another group
            afterward; until then they have none, and fall back to the fleet-wide settings.
          </p>
        ) : null}
      </ConfirmDialog>
    </form>
  );
}

function CreateGroupForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createGroup, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-group">New group</Label>
        <Input id="new-group" name="name" placeholder="lisbon-site" className="w-56" />
      </div>
      <Button type="submit" variant="outline">
        <Plus />
        Create
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
