"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AgentUpdateState, InstallMode, JobState } from "@magnemite/db";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from "@/components/ui/table";
import { TablePaginationBar } from "@/components/ui/table-pagination";
import { AgentUpdateStateBadge, JobStateBadge } from "@/components/status";
import { formatDuration, formatRelative } from "@/lib/format";
import { useTablePagination } from "@/lib/table-pagination";
import { useTableSort } from "@/lib/table-sort";

export type DeviceJobRow = {
  id: string;
  rolloutId: string;
  state: JobState;
  fromVersion: string | null;
  toVersion: string;
  installMode: InstallMode | null;
  dataWiped: boolean;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

/**
 * An agent self-update. It belongs in the same table as the app installs: from
 * the box's point of view both are "something was pushed to me and either took
 * or did not", and a failed self-update is exactly what you go looking for on
 * a device page.
 */
export type DeviceAgentUpdateRow = {
  id: string;
  fromVersion: string | null;
  toVersion: string;
  state: AgentUpdateState;
  error: string | null;
  sentAt: string;
  finishedAt: string | null;
};

type HistoryRow = {
  id: string;
  kind: "app" | "agent";
  fromVersion: string | null;
  toVersion: string;
  /** Sorted and filtered as text, so both kinds of state share one column. */
  stateKey: string;
  mode: string | null;
  error: string | null;
  when: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  job: DeviceJobRow | null;
  agent: DeviceAgentUpdateRow | null;
};

function toHistoryRows(jobs: DeviceJobRow[], agentUpdates: DeviceAgentUpdateRow[]): HistoryRow[] {
  const fromJobs: HistoryRow[] = jobs.map((job) => ({
    id: `job:${job.id}`,
    kind: "app",
    fromVersion: job.fromVersion,
    toVersion: job.toVersion,
    stateKey: job.state,
    mode: job.installMode?.toLowerCase().replace("_", " ") ?? null,
    error: null,
    when: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    job,
    agent: null,
  }));

  const fromAgent: HistoryRow[] = agentUpdates.map((update) => ({
    id: `agent:${update.id}`,
    kind: "agent",
    fromVersion: update.fromVersion,
    toVersion: update.toVersion,
    stateKey: update.state,
    mode: "self-update",
    error: update.error,
    when: update.sentAt,
    startedAt: update.sentAt,
    finishedAt: update.finishedAt,
    durationMs: update.finishedAt
      ? new Date(update.finishedAt).getTime() - new Date(update.sentAt).getTime()
      : null,
    job: null,
    agent: update,
  }));

  return [...fromJobs, ...fromAgent];
}

type SortKey = "version" | "state" | "mode" | "when" | "duration";

/**
 * Every update this box has been given, sorted and paged like the fleet and
 * rollout tables — a box that has been in the fleet a while accumulates more
 * of these than fit on a screen.
 */
export function DeviceHistory({
  jobs,
  agentUpdates,
}: {
  jobs: DeviceJobRow[];
  agentUpdates: DeviceAgentUpdateRow[];
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");

  const rows = useMemo(() => toHistoryRows(jobs, agentUpdates), [jobs, agentUpdates]);

  const { headProps, sort, sortRows } = useTableSort<SortKey, HistoryRow>(
    {
      version: (r) => r.toVersion,
      state: (r) => r.stateKey,
      mode: (r) => r.mode,
      when: (r) => r.when,
      duration: (r) => r.durationMs,
    },
    { key: "when", direction: "desc" },
  );

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      // "Agent updates" filters by kind; every other option is a state.
      if (state === "AGENT" ? row.kind !== "agent" : state && row.stateKey !== state) return false;
      if (!q) return true;
      return (
        row.toVersion.toLowerCase().includes(q) ||
        (row.fromVersion?.toLowerCase().includes(q) ?? false) ||
        row.stateKey.toLowerCase().includes(q) ||
        (row.kind === "agent" && "agent self-update".includes(q))
      );
    });
    return sortRows(filtered);
  }, [rows, query, state, sortRows]);

  const pagination = useTablePagination(matching, {
    pageSize: 10,
    resetKey: `${query}|${state}|${sort.key}|${sort.direction}`,
  });

  if (rows.length === 0) {
    return (
      <p className="px-5 pb-5 text-sm text-muted-foreground">No updates run on this box yet.</p>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search version, state…"
          className="max-w-xs"
        />
        <Select
          aria-label="Filter by state"
          value={state}
          onValueChange={setState}
          className="w-40"
          options={[
            { value: "", label: "All updates" },
            { value: "SUCCESS", label: "Succeeded" },
            { value: "FAILED", label: "Failed" },
            { value: "SKIPPED", label: "Skipped" },
            { value: "CANCELLED", label: "Cancelled" },
            { value: "AGENT", label: "Agent updates" },
          ]}
        />
      </div>

      <div className="border-t border-border">
        <Table containerClassName="max-h-[26rem]">
          <TableHeader>
            <TableRow>
              <TableSortHead {...headProps("version")}>Version</TableSortHead>
              <TableSortHead {...headProps("state")}>State</TableSortHead>
              <TableSortHead {...headProps("mode")}>Mode</TableSortHead>
              <TableSortHead {...headProps("when")}>When</TableSortHead>
              <TableSortHead {...headProps("duration")}>Duration</TableSortHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagination.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No update matches this filter.
                </TableCell>
              </TableRow>
            ) : null}
            {pagination.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  <div>
                    {row.fromVersion ?? "none"} → {row.toVersion}
                  </div>
                  {row.error ? (
                    // The point of recording a failed self-update is reading
                    // the reason without opening the box's own log.
                    <div
                      className="mt-1 max-w-xs truncate font-sans text-destructive"
                      title={row.error}
                    >
                      {row.error}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.job ? <JobStateBadge state={row.job.state} /> : null}
                    {row.agent ? <AgentUpdateStateBadge state={row.agent.state} /> : null}
                    {row.kind === "agent" ? <Badge variant="outline">agent</Badge> : null}
                    {row.job?.dataWiped ? <Badge variant="warning">data wiped</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.mode ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelative(row.when)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDuration(
                    row.startedAt ? new Date(row.startedAt) : null,
                    row.finishedAt ? new Date(row.finishedAt) : null,
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {row.job ? (
                    <Link
                      href={`/rollouts/${row.job.rolloutId}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      rollout
                    </Link>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePaginationBar pagination={pagination} unit="updates" />
      </div>
    </div>
  );
}
