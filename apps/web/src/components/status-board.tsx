"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  Globe,
  HardDrive,
  MinusCircle,
  LayoutDashboard,
  Radar,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { recheckIntegrations } from "@/actions/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { HubHealth, IntegrationCheck, IntegrationState } from "@/lib/hub";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Server> = {
  web: LayoutDashboard,
  hub: Server,
  database: Database,
  artifacts: HardDrive,
  feeds: Cloud,
  rotom: Radar,
  edge: Globe,
};

/** Version sources are one card each, keyed `feed:<id>`. */
function iconFor(key: string): typeof Server {
  if (key.startsWith("feed:")) return Cloud;
  return ICONS[key] ?? Server;
}

const STATE: Record<
  IntegrationState,
  {
    label: string;
    badge: "success" | "warning" | "danger" | "secondary";
    icon: typeof CheckCircle2;
  }
> = {
  OK: { label: "Healthy", badge: "success", icon: CheckCircle2 },
  DEGRADED: { label: "Degraded", badge: "warning", icon: AlertTriangle },
  DOWN: { label: "Down", badge: "danger", icon: XCircle },
  OFF: { label: "Not configured", badge: "secondary", icon: MinusCircle },
};

/**
 * An ISO timestamp read as a person would say it. `formatRelative` only looks
 * backwards, and some of these facts are in the future.
 */
function when(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return formatRelative(date);
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  return `in ${Math.round(minutes / 60)}h`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function StatusBoard({ health, error }: { health: HubHealth | null; error: string | null }) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function recheck() {
    setActionError(null);
    startTransition(async () => {
      const result = await recheckIntegrations();
      setActionError(result.error ?? null);
    });
  }

  const failing = health?.checks.filter((c) => c.state === "DOWN" || c.state === "DEGRADED") ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error
              ? "The hub could not be reached, so nothing below could be probed."
              : failing.length === 0
                ? "Every integration answered."
                : `${failing.length} integration${failing.length === 1 ? "" : "s"} need${
                    failing.length === 1 ? "s" : ""
                  } a look.`}
            {health ? ` Checked ${formatRelative(health.checkedAt)}.` : ""}
          </p>
        </div>

        <Button variant="outline" disabled={pending} onClick={recheck}>
          <RefreshCw className={cn(pending && "animate-spin")} />
          Check again
        </Button>
      </header>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">The hub is not answering.</p>
            <p className="mt-0.5 text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm">{actionError}</p>
      ) : null}

      {health ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {health.checks.map((check) => (
            <IntegrationCard key={check.key} check={check} />
          ))}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Probes run on the hub and are cached for 30 seconds, so this page costs nothing to leave
        open: every source index is a real request, and repaints do not spend one.
      </p>
    </div>
  );
}

function IntegrationCard({ check }: { check: IntegrationCheck }) {
  const state = STATE[check.state];
  const Icon = iconFor(check.key);
  const StateIcon = state.icon;
  const off = check.state === "OFF";

  return (
    <Card className={cn("flex flex-col", off && "opacity-75")}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-subtle",
              check.state === "DOWN" && "bg-destructive/10 text-destructive",
              check.state === "DEGRADED" && "bg-warning/10 text-warning",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-none tracking-tight">{check.label}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{check.summary}</p>
          </div>
        </div>

        <Badge variant={state.badge} className="shrink-0 whitespace-nowrap">
          <StateIcon className="h-3 w-3" />
          {state.label}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3">
        {check.facts.length > 0 ? (
          <dl className="flex flex-col gap-1.5 border-t border-border pt-3 text-xs">
            {check.facts.map((fact) => (
              <div key={fact.label} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-muted-foreground">{fact.label}</dt>
                <dd className="truncate font-mono" title={fact.value}>
                  {ISO.test(fact.value) ? when(fact.value) : fact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {check.detail ? (
          <p
            className={cn(
              "rounded-lg border px-2.5 py-2 text-xs",
              check.state === "DOWN"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-warning/30 bg-warning/5 text-warning",
            )}
          >
            {check.detail}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-muted-foreground">
          <span>{check.latencyMs !== null ? `${check.latencyMs} ms` : ""}</span>
          {check.link ? (
            <a
              href={check.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
