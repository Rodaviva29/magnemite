"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createAppTarget } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FeedChoice } from "@/components/settings/app-target-card";

export function CreateAppTargetForm({ feeds }: { feeds: FeedChoice[] }) {
  const [state, formAction] = useActionState<ActionState, FormData>(createAppTarget, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          Add an app target
        </CardTitle>
        <CardDescription>
          A package this fleet tracks versions for, and the sources its builds are discovered at.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-target-package">Package name</Label>
              <Input
                id="new-target-package"
                name="packageName"
                placeholder="com.nianticlabs.pokemongo"
                className="font-mono text-xs"
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="new-target-display">Display name</Label>
              <Input id="new-target-display" name="displayName" placeholder="Pokémon GO" required />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Version sources</Label>
            {feeds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sources configured yet. Add one under Version sources first — a target with none
                is never polled, so there would be nothing to discover.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {feeds.map((feed) => (
                    <label
                      key={feed.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border p-3 text-sm hover:bg-subtle"
                    >
                      {/* Ticked by default: a target that polls nothing is the
                          one setup nobody wants, and unticking is the rarer
                          choice than remembering to tick. */}
                      <Checkbox name="sourceIds" value={feed.id} defaultChecked />
                      <span className="min-w-0 flex-1 truncate">{feed.name}</span>
                      {!feed.enabled ? (
                        <span className="shrink-0 text-xs text-muted-foreground">paused</span>
                      ) : null}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Only these are polled for this package. A source can serve several targets.
                </p>
              </>
            )}
          </div>

          {/* Right, where every other submit on this page is: the eye leaves a
              form at its last field, not back at the left margin. */}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="secondary" disabled={feeds.length === 0}>
              <Plus className="h-4 w-4" />
              Add target
            </Button>
          </div>

          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          {state.ok && state.message ? (
            <p className="text-xs text-muted-foreground">{state.message}</p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
