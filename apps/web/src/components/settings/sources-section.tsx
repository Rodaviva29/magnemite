"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Rss, Trash2 } from "lucide-react";
import { createSourceFeed, deleteSourceFeed, updateSourceFeed } from "@/actions/settings";
import type { ActionState } from "@/actions/rollouts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { SaveButton } from "@/components/ui/save-button";
import { Switch } from "@/components/ui/switch";

export type SourceFeedRow = {
  id: string;
  name: string;
  indexUrl: string;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
  pollMinutes: number;
  versionCount: number;
  /** App targets polled from this feed. */
  targetCount: number;
  /** Targets this feed is the *only* source for — they stop being polled. */
  orphanedTargets: string[];
};

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
        <CardTitle className="flex items-center gap-2">
          <Rss className="h-4 w-4 text-muted-foreground" />
          Version sources
        </CardTitle>
        <CardDescription>
          Any index in the shape <code className="font-mono text-xs">mirror.unownhash.com</code>{" "}
          publishes works here, a flat JSON array of builds with{" "}
          <code className="font-mono text-xs">filename</code>,{" "}
          <code className="font-mono text-xs">version</code>,{" "}
          <code className="font-mono text-xs">arch</code> and{" "}
          <code className="font-mono text-xs">size</code>.<br></br>When two sources list the same
          build it is stored once, and the lowest priority is the one downloaded.
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-border p-4">
      <input type="hidden" name="feedId" value={feed.id} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{feed.name}</h3>
          {feed.enabled ? null : <Badge variant="secondary">disabled</Badge>}
          <span className="text-xs text-muted-foreground">
            {feed.versionCount} version{feed.versionCount === 1 ? "" : "s"} discovered ·{" "}
            {feed.targetCount} target{feed.targetCount === 1 ? "" : "s"}
          </span>
        </div>

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
          <p className="text-xs text-muted-foreground">
            Lowest wins when two sources list the same build.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`poll-${feed.id}`}>Check every</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`poll-${feed.id}`}
              name="pollMinutes"
              type="number"
              min={1}
              defaultValue={feed.pollMinutes}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-xs text-muted-foreground">minutes</span>
          </div>
          <p className="text-xs text-muted-foreground">
            This index is somebody else&rsquo;s server. A mirror that publishes hourly and one that
            publishes on release do not want the same cadence.
          </p>
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

        {!disabled ? <SaveButton state={state} size="sm" /> : null}
      </div>

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${feed.name}?`}
        description="Polling stops. The builds it already found stay, cached artifacts and rollout history included."
        pending={pending}
        error={removeError}
        onConfirm={() => {
          startTransition(async () => {
            const result = await deleteSourceFeed(feed.id);
            setRemoveError(result.error ?? null);
            if (!result.error) setConfirmOpen(false);
          });
        }}
      >
        {/* A target polls only the feeds it is paired with, and removing this
            one unpairs it everywhere. A target left with none goes quiet
            without ever saying so, which is the trap worth naming here. */}
        {feed.orphanedTargets.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            <span>
              This is the only source for{" "}
              <span className="font-medium">{feed.orphanedTargets.join(", ")}</span>. Without it
              {feed.orphanedTargets.length === 1 ? " that target" : " those targets"} will never
              discover a new version again — give
              {feed.orphanedTargets.length === 1 ? " it" : " them"} another source first.
            </span>
          </div>
        ) : feed.targetCount > 0 ? (
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-xs text-muted-foreground">
            {feed.targetCount} target{feed.targetCount === 1 ? "" : "s"} polled from it and will
            stop, but each keeps at least one other source.
          </p>
        ) : null}
      </ConfirmDialog>
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
            placeholder="https://example.com/apks/ (only if the index lists bare filenames)"
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-source-poll">Check every</Label>
          <div className="flex items-center gap-2">
            <Input
              id="new-source-poll"
              name="pollMinutes"
              type="number"
              min={1}
              defaultValue={15}
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-xs text-muted-foreground">minutes</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
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
