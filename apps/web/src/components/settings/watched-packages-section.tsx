"use client";

import { useActionState, useTransition } from "react";
import { Columns3, Plus, Trash2 } from "lucide-react";
import { createWatchedPackage, deleteWatchedPackage } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type WatchedPackageRow = {
  id: string;
  packageName: string;
  label: string | null;
  /** How many boxes have reported a version for it so far. */
  reporting: number;
};

/**
 * Apps to show a version column for.
 *
 * Distinct from the app targets above: Magnemite never installs these, it only
 * asks each box what it has. The scanner is the reason it exists — "which
 * boxes are on which build of Aegis" is the same question the fleet table
 * already answers for Pokémon GO.
 */
export function WatchedPackagesSection({
  packages,
  deviceCount,
  disabled,
}: {
  packages: WatchedPackageRow[];
  deviceCount: number;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createWatchedPackage, {});
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Columns3 className="h-4 w-4 text-muted-foreground" />
          Fleet columns
        </CardTitle>
        <CardDescription>
          Extra packages to show the installed version of, one column each. Nothing here is updated
          by Magnemite — each box simply reports what it has on every heartbeat, and the column is
          sortable and searchable like the rest.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No extra columns. Add a package name to see its version across the fleet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {packages.map((watched) => (
              <div
                key={watched.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {watched.label || watched.packageName.split(".").pop()}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {watched.packageName}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {watched.reporting} of {deviceCount} reporting
                  </span>
                  {!disabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          await deleteWatchedPackage(watched.id);
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {!disabled ? (
          <form action={formAction} className="flex flex-col gap-3 border-t border-border pt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="watched-package">Package name</Label>
                <Input
                  id="watched-package"
                  name="packageName"
                  placeholder="com.pokemod.aegis"
                  className="font-mono text-xs"
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="watched-label">Column header (optional)</Label>
                <Input id="watched-label" name="label" placeholder="aegis" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Boxes that are online are told immediately; the rest report when they reconnect.
              </p>
              <Button type="submit" size="sm" variant="secondary">
                <Plus className="h-4 w-4" />
                Add column
              </Button>
            </div>

            {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
            {state.ok && state.message ? (
              <p className="text-xs text-muted-foreground">{state.message}</p>
            ) : null}
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
