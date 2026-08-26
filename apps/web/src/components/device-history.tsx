"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { InstallMode, JobState } from "@magnemite/db";
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
import { JobStateBadge } from "@/components/status";
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

type SortKey = "version" | "state" | "mode" | "when" | "duration";

/**
 * Every update this box has been given, sorted and paged like the fleet and
 * rollout tables — a box that has been in the fleet a while accumulates more
 * of these than fit on a screen.
 */
export function DeviceHistory({ jobs }: { jobs: DeviceJobRow[] }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState("");

  const { headProps, sort, sortRows } = useTableSort<SortKey, DeviceJobRow>(
    {
      version: (r) => r.toVersion,
      state: (r) => r.state,
      mode: (r) => r.installMode,
      when: (r) => r.queuedAt,
      duration: (r) => r.durationMs,
    },
    { key: "when", direction: "desc" },
  );

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      if (state && job.state !== state) return false;
      if (!q) return true;
      return (
        job.toVersion.toLowerCase().includes(q) ||
        (job.fromVersion?.toLowerCase().includes(q) ?? false) ||
        job.state.toLowerCase().includes(q)
      );
    });
    return sortRows(filtered);
  }, [jobs, query, state, sortRows]);

  const pagination = useTablePagination(matching, {
    pageSize: 10,
    resetKey: `${query}|${state}|${sort.key}|${sort.direction}`,
  });

  if (jobs.length === 0) {
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
            {pagination.rows.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">
                  {job.fromVersion ?? "none"} → {job.toVersion}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <JobStateBadge state={job.state} />
                    {job.dataWiped ? <Badge variant="warning">data wiped</Badge> : null}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {job.installMode?.toLowerCase().replace("_", " ") ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelative(job.queuedAt)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDuration(
                    job.startedAt ? new Date(job.startedAt) : null,
                    job.finishedAt ? new Date(job.finishedAt) : null,
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/rollouts/${job.rolloutId}`}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    rollout
                  </Link>
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
