"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { createSourceFeed, deleteSourceFeed, updateSourceFeed } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type SourceFeedRow = {
  id: string;
  name: string;
  indexUrl: string;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
  versionCount: number;
};

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

/**
 * Where builds are discovered.
 *
 * Every source speaks the same index format, so adding one is a URL rather
 * than a code change. Two sources listing the same build is normal and not a
 * duplicate: the build is stored once and the lowest priority decides whose
 * URL the hub downloads.
 */
export function SourcesSection({ feeds, disabled }: { feeds: SourceFeedRow[]; disabled: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Version sources</CardTitle>
        <CardDescription>
          Any index in the shape <code className="font-mono text-xs">mirror.unownhash.com</code>{" "}
          publishes works here — a flat JSON array of builds with{" "}
          <code className="font-mono text-xs">filename</code>,{" "}
          <code className="font-mono text-xs">version</code>,{" "}
          <code className="font-mono text-xs">arch</code> and{" "}
          <code className="font-mono text-xs">size</code>. When two sources list the same build it
          is stored once, and the lowest priority is the one downloaded.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {feeds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sources configured — nothing is being polled, so no new version will ever be
            discovered.
          </p>
        ) : null}

        {feeds.map((feed) => (
          <SourceForm key={feed.id} feed={feed} disabled={disabled} />
        ))}

        {!disabled ? <CreateSourceForm /> : null}
      </CardContent>
    </Card>
  );
}

function SourceForm({ feed, disabled }: { feed: SourceFeedRow; disabled: boolean }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateSourceFeed, {});
  const [pending, startTransition] = useTransition();

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <input type="hidden" name="feedId" value={feed.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{feed.name}</h3>
          {feed.enabled ? null : <Badge variant="secondary">disabled</Badge>}
          <span className="text-xs text-muted-foreground">
            {feed.versionCount} version{feed.versionCount === 1 ? "" : "s"} discovered
          </span>
        </div>

        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              // Removing a source stops the polling; the builds it already
              // found stay, cached artifacts and rollout history included.
              if (!confirm(`Remove "${feed.name}"? Versions it already found are kept.`)) return;
              startTransition(async () => {
                await deleteSourceFeed(feed.id);
              });
            }}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor={`index-${feed.id}`}>Index URL</Label>
          <Input
            id={`index-${feed.id}`}
            name="indexUrl"
            defaultValue={feed.indexUrl}
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`base-${feed.id}`}>Base URL</Label>
          <Input
            id={`base-${feed.id}`}
            name="baseUrl"
            defaultValue={feed.baseUrl ?? ""}
            placeholder="not needed — index has absolute URLs"
            disabled={disabled}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`priority-${feed.id}`}>Priority</Label>
          <Input
            id={`priority-${feed.id}`}
            name="priority"
            type="number"
            min={1}
            defaultValue={feed.priority}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={`enabled-${feed.id}`}
            name="enabled"
            defaultChecked={feed.enabled}
            disabled={disabled}
          />
          <Label htmlFor={`enabled-${feed.id}`} className="text-sm font-normal">
            Poll this source
          </Label>
        </div>

        {!disabled ? <Save /> : null}
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok && state.message ? (
        <p className="text-xs text-muted-foreground">{state.message}</p>
      ) : null}
    </form>
  );
}

function CreateSourceForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createSourceFeed, {});

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-source-name">Name</Label>
          <Input id="new-source-name" name="name" placeholder="Silva" required />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-source-index">Index URL</Label>
          <Input
            id="new-source-index"
            name="indexUrl"
            placeholder="https://example.com/index.json"
            className="font-mono text-xs"
            required
          />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="new-source-base">Base URL (optional)</Label>
          <Input
            id="new-source-base"
            name="baseUrl"
            placeholder="https://example.com/apks/ — only if the index lists bare filenames"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          Added last, so an existing build keeps being downloaded from where it already was.
        </p>
        <Button type="submit" size="sm" variant="secondary">
          <Plus className="h-4 w-4" />
          Add source
        </Button>
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok && state.message ? (
        <p className="text-xs text-muted-foreground">{state.message}</p>
      ) : null}
    </form>
  );
}
