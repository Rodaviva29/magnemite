"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Download, RefreshCw, Trash2 } from "lucide-react";
import type { VersionSource, VersionStatus } from "@magnemite/db";
import { cacheVersion, pollSources, pruneVersions, setVersionApproval } from "@/actions/versions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from "@/components/ui/table";
import { VersionStatusBadge } from "@/components/status";
import { formatBytes, formatRelative } from "@/lib/format";
import { useTableSort } from "@/lib/table-sort";

type SortKey = "version" | "source" | "status" | "size" | "devices" | "published";

export type VersionRow = {
  id: string;
  version: string;
  buildCode: string | null;
  source: VersionSource;
  arch: string;
  status: VersionStatus;
  cacheProgress: number;
  sizeBytes: number;
  approved: boolean;
  sha256: string | null;
  error: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  devicesOnThis: number;
};

export function VersionsTable({
  rows,
  packageName,
  canOperate,
}: {
  rows: VersionRow[];
  packageName: string;
  canOperate: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  const { headProps, sortRows } = useTableSort<SortKey, VersionRow>(
    {
      version: (r) => r.version,
      source: (r) => r.source,
      status: (r) => r.status,
      size: (r) => r.sizeBytes,
      devices: (r) => r.devicesOnThis,
      published: (r) => r.publishedAt ?? r.discoveredAt,
    },
    { key: "published", direction: "desc" },
  );

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (row) =>
            row.version.toLowerCase().includes(q) ||
            row.source.toLowerCase().includes(q) ||
            row.arch.toLowerCase().includes(q) ||
            row.status.toLowerCase().includes(q) ||
            (row.buildCode?.toLowerCase().includes(q) ?? false),
        )
      : rows;
    return sortRows(filtered);
  }, [rows, query, sortRows]);

  // A search is its own shortlist; capping it again would just hide matches.
  const searching = query.trim() !== "";
  const showingAll = showAll || searching;
  const visible = showingAll ? matching : matching.slice(0, 12);
  const cached = rows.filter((r) => r.status === "READY").length;

  function run(fn: () => Promise<{ error?: string; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage(result?.error ?? result?.message ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Versions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {packageName} · {rows.length} known · {cached} cached on this server
          </p>
        </div>

        {canOperate ? (
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={() => run(pollSources)}>
              <RefreshCw />
              Check sources
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => run(() => pruneVersions(3))}>
              <Trash2 />
              Free old bundles
            </Button>
          </div>
        ) : null}
      </header>

      {message ? (
        <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm">{message}</p>
      ) : null}

      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search version, build, source, arch…"
        className="max-w-md"
      />

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableSortHead {...headProps("version")}>Version</TableSortHead>
              <TableSortHead {...headProps("source")}>Source</TableSortHead>
              <TableSortHead {...headProps("status")}>On disk</TableSortHead>
              <TableSortHead {...headProps("size")} align="right">
                Size
              </TableSortHead>
              <TableSortHead {...headProps("devices")} align="right">
                Devices
              </TableSortHead>
              <TableSortHead {...headProps("published")}>Published</TableSortHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No versions match this search.
                </TableCell>
              </TableRow>
            ) : null}
            {visible.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{row.version}</span>
                    {row.approved ? <Badge variant="success">approved</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.buildCode ? `build ${row.buildCode} · ` : ""}
                    {row.arch}
                  </div>
                </TableCell>

                <TableCell className="text-sm text-muted-foreground">
                  {row.source.toLowerCase()}
                </TableCell>

                <TableCell className="min-w-40">
                  <div className="flex flex-col gap-1">
                    <VersionStatusBadge status={row.status} />
                    {row.status === "CACHING" ? <Progress value={row.cacheProgress} /> : null}
                    {row.error ? (
                      <span className="text-xs text-destructive" title={row.error}>
                        {row.error.slice(0, 60)}
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono text-xs">
                  {formatBytes(row.sizeBytes)}
                </TableCell>

                <TableCell className="text-right font-mono text-xs">
                  {row.devicesOnThis > 0 ? row.devicesOnThis : "—"}
                </TableCell>

                <TableCell className="text-xs text-muted-foreground">
                  {formatRelative(row.publishedAt ?? row.discoveredAt)}
                </TableCell>

                <TableCell>
                  {canOperate ? (
                    <div className="flex justify-end gap-1">
                      {row.status !== "READY" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending || row.status === "CACHING"}
                          onClick={() => run(() => cacheVersion(row.id))}
                        >
                          <Download />
                          Cache
                        </Button>
                      ) : null}
                      <Button
                        variant={row.approved ? "ghost" : "secondary"}
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => setVersionApproval(row.id, !row.approved))}
                      >
                        <Check />
                        {row.approved ? "Unapprove" : "Approve"}
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!showingAll && matching.length > 12 ? (
        <Button variant="ghost" className="w-fit" onClick={() => setShowAll(true)}>
          Show all {matching.length} versions
        </Button>
      ) : null}
      {showAll && !searching && matching.length > 12 ? (
        <Button variant="ghost" className="w-fit" onClick={() => setShowAll(false)}>
          Show fewer versions
        </Button>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Approving a version only matters for auto-update, it is the gate the policy checks before
        starting a rollout on its own. Manual rollouts can pick any cached version.
      </p>
    </div>
  );
}
