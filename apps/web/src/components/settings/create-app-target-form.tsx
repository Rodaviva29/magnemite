"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { createAppTarget } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateAppTargetForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createAppTarget, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add an app target</CardTitle>
        <CardDescription>
          The package this fleet tracks versions for. Auto-update policy, canary count and the rest
          are editable afterward, once it exists.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
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

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Starts with auto-update off — turn it on once you've watched a manual rollout succeed.
            </p>
            <Button type="submit" size="sm" variant="secondary">
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
