"use client";

import { useState, useTransition, useActionState } from "react";
import { Package, Trash2 } from "lucide-react";
import { deleteAppTarget, updateAppTarget } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type AppTargetRow = {
  id: string;
  displayName: string;
  packageName: string;
  autoUpdateEnabled: boolean;
  autoApprove: boolean;
  canaryCount: number;
  soakMinutes: number;
  maxAttempts: number;
  retryBackoffSeconds: number;
  updateCooldownMinutes: number;
  windowStart: string | null;
  windowEnd: string | null;
  /** Feeds this target is polled from. */
  sourceIds: string[];
};

export type FeedChoice = { id: string; name: string; enabled: boolean };

/** What a target starts life with, which is what the empty card stands in with. */
const PLACEHOLDER: AppTargetRow = {
  id: "placeholder",
  displayName: "",
  packageName: "",
  autoUpdateEnabled: false,
  autoApprove: false,
  canaryCount: 1,
  soakMinutes: 30,
  retryBackoffSeconds: 60,
  maxAttempts: 3,
  updateCooldownMinutes: 0,
  windowStart: null,
  windowEnd: null,
  sourceIds: [],
};

/**
 * One app target, whole.
 *
 * What it is, where its builds come from and how they reach the fleet used to
 * be two cards with two Save buttons, which made a single decision — "track
 * this app, from here, on these terms" — read as two unrelated ones. It is one
 * card and one Save now, in the order the questions actually come: which app,
 * which sources, then what happens when a new build shows up.
 */
export function AppTargetCard({
  target,
  feeds,
  disabled,
}: {
  /** Null before any target exists: the card shows what one buys you, greyed out. */
  target: AppTargetRow | null;
  feeds: FeedChoice[];
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateAppTarget, {});
  // Removal answers back — rollout history blocks it — so unlike the other
  // sections this delete cannot be fire-and-forget.
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const values = target ?? PLACEHOLDER;
  const [enabled, setEnabled] = useState(values.autoUpdateEnabled);
  const [autoApprove, setAutoApprove] = useState(values.autoApprove);

  // No target means nothing on this card can be touched, whatever the role.
  const locked = disabled || target === null;
  // The policy needs a target *and* the automatic path switched on.
  const policyLocked = locked || !enabled;

  return (
    <Card className={cn(target === null && "opacity-70")}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{target?.displayName || "App target"}</span>
          </CardTitle>
          <CardDescription>
            {target === null
              ? "Add a target below and this is what you get to set: the package to track, the sources its builds are discovered at, and whether the hub rolls them out on its own."
              : "The package this fleet tracks, where its builds are discovered, and how they reach the boxes."}
          </CardDescription>
        </div>

        {target !== null && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        ) : null}
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="appTargetId" value={values.id} />

          {/* --- what ------------------------------------------------------ */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`pkg-${values.id}`}>Package name</Label>
              <Input
                id={`pkg-${values.id}`}
                name="packageName"
                defaultValue={values.packageName}
                placeholder="com.nianticlabs.pokemongo"
                className="font-mono text-xs"
                disabled={locked}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={`name-${values.id}`}>Display name</Label>
              <Input
                id={`name-${values.id}`}
                name="displayName"
                defaultValue={values.displayName}
                placeholder="Pokémon GO"
                disabled={locked}
                required
              />
            </div>
          </div>

          {/* --- where from ------------------------------------------------ */}
          <Section title="Version sources" hint="Which indexes are polled for this package.">
            {feeds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sources configured yet, add one under Version sources first.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {feeds.map((feed) => (
                  <label
                    key={feed.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border border-border p-3 text-sm",
                      !locked && "cursor-pointer hover:bg-subtle",
                    )}
                  >
                    <Checkbox
                      name="sourceIds"
                      value={feed.id}
                      defaultChecked={values.sourceIds.includes(feed.id)}
                      disabled={locked}
                    />
                    <span className="min-w-0 flex-1 truncate">{feed.name}</span>
                    {/* A disabled feed stays tickable: disabling it is a pause
                        on the feed, not a decision about this target. */}
                    {!feed.enabled ? (
                      <span className="shrink-0 text-xs text-muted-foreground">paused</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </Section>

          {/* --- what happens next ----------------------------------------- */}
          <Section
            title="Auto-update"
            hint="When a newer approved version appears at one of those sources, the hub caches it and rolls it out on its own. One rollout at a time per app, never a downgrade."
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <Label htmlFor={`auto-${values.id}`}>Automatic rollouts</Label>
                  <p className="text-xs text-muted-foreground">
                    Off means new versions are only ever discovered and cached; you start the
                    rollout.
                  </p>
                </div>
                <Switch
                  id={`auto-${values.id}`}
                  name="autoUpdateEnabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={locked}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <Label htmlFor={`approve-${values.id}`}>Approve new versions automatically</Label>
                  <p className="text-xs text-muted-foreground">
                    Off means a human ticks approve on the Versions page before auto-update will
                    touch a build.
                  </p>
                </div>
                <Switch
                  id={`approve-${values.id}`}
                  name="autoApprove"
                  checked={autoApprove}
                  onCheckedChange={setAutoApprove}
                  disabled={locked}
                />
              </div>
            </div>

            {/* Dimmed as a block, so it reads as one thing the switch above
                governs rather than five fields that happened to grey out. */}
            <div
              className={cn("flex flex-col gap-4 transition-opacity", policyLocked && "opacity-50")}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`canary-${values.id}`}>Canary devices</Label>
                  <Input
                    id={`canary-${values.id}`}
                    name="canaryCount"
                    type="number"
                    min={0}
                    defaultValue={values.canaryCount}
                    disabled={policyLocked}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`soak-${values.id}`}>Soak minutes</Label>
                  <Input
                    id={`soak-${values.id}`}
                    name="soakMinutes"
                    type="number"
                    min={0}
                    defaultValue={values.soakMinutes}
                    disabled={policyLocked}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`attempts-${values.id}`}>Attempts per device</Label>
                  <Input
                    id={`attempts-${values.id}`}
                    name="maxAttempts"
                    type="number"
                    min={1}
                    defaultValue={values.maxAttempts}
                    disabled={policyLocked}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`backoff-${values.id}`}>Retry backoff (s)</Label>
                  <Input
                    id={`backoff-${values.id}`}
                    name="retryBackoffSeconds"
                    type="number"
                    min={0}
                    defaultValue={values.retryBackoffSeconds}
                    disabled={policyLocked}
                  />
                </div>

                {/* Per app, not per fleet: how soon this one may ship again is
                    a property of the app. A scanner people watch all day and a
                    launcher nobody notices do not want the same restraint. */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`cooldown-${values.id}`}>Cooldown (min)</Label>
                  <Input
                    id={`cooldown-${values.id}`}
                    name="updateCooldownMinutes"
                    type="number"
                    min={0}
                    defaultValue={values.updateCooldownMinutes}
                    disabled={policyLocked}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`start-${values.id}`}>Window start (HH:MM)</Label>
                  <Input
                    id={`start-${values.id}`}
                    name="windowStart"
                    placeholder="03:00"
                    defaultValue={values.windowStart ?? ""}
                    disabled={policyLocked}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`end-${values.id}`}>Window end (HH:MM)</Label>
                  <Input
                    id={`end-${values.id}`}
                    name="windowEnd"
                    placeholder="06:00"
                    defaultValue={values.windowEnd ?? ""}
                    disabled={policyLocked}
                  />
                </div>
              </div>

              {/* One line that explains the greying, so it is not read as a bug. */}
              <p className="-mt-1 text-xs text-muted-foreground">
                {target === null
                  ? "No app target yet — nothing here can be set until one exists."
                  : !enabled
                    ? "Only automatic rollouts use these. Turn the switch above on to set them; a manual rollout takes its canary, soak and attempts from the fleet page instead."
                    : "The cooldown is how long after one automatic rollout finishes before another may start — 0 ships a new build as soon as it is discovered. Leave both window fields blank to let automatic rollouts dispatch at any hour; the window only gates automatic ones, a manual rollout always starts immediately."}
              </p>
            </div>
          </Section>

          {/* A failed removal reports inside its own dialog, which stays open
              for exactly that reason, so it is not repeated here. */}
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          {!locked ? (
            <div className="flex justify-end">
              <SaveButton state={state} />
            </div>
          ) : null}
        </form>
      </CardContent>

      {target !== null ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Remove ${target.displayName}?`}
          description={
            <>
              Every version discovered for it is deleted with it, and the fleet stops tracking{" "}
              <span className="font-mono text-xs">{target.packageName}</span>. The boxes keep the
              app they already have installed.
            </>
          }
          confirmLabel="Remove target"
          pending={removing}
          error={removeError}
          onConfirm={() => {
            startRemoving(async () => {
              const result = await deleteAppTarget(target.id);
              setRemoveError(result.error ?? null);
              // Left open on failure so the reason is read where the decision
              // was made, rather than behind a closed dialog.
              if (!result.error) setConfirmOpen(false);
            });
          }}
        >
          {/* The rollout history is what actually blocks this, and finding
              that out only after clicking Remove is worth pre-empting. */}
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted-foreground">
            A target that has already shipped a rollout cannot be removed — the rollout pins the
            version it installed.
          </p>
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

/** A labelled band inside the card, so one long form still reads as three questions. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
