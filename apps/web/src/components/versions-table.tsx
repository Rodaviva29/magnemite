"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Download, ExternalLink, RefreshCw, Trash2, X } from "lucide-react";
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
import { TablePaginationBar } from "@/components/ui/table-pagination";
import { VersionStatusBadge } from "@/components/status";
import { formatBytes, formatRelative } from "@/lib/format";
import { useTablePagination } from "@/lib/table-pagination";
import { useTableSort } from "@/lib/table-sort";

type SortKey = "version" | "source" | "status" | "size" | "devices" | "published";

export type VersionRow = {
  id: string;
  version: string;
  buildCode: string | null;
  source: VersionSource;
  /** Where the artifact was fetched from; empty for an upload. */
  remoteUrl: string;
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

/**
 * Where a version came from, as somewhere a person can actually go.
 *
 * A GitHub asset URL points straight at the 170 MB download; the release page
 * behind it is what someone clicking "github" wants to read, and the tag is
 * already in the download URL, so it is derived rather than guessed. The
 * mirror has no page — the file *is* the listing entry — so that one stays the
 * file, and the tooltip says so before you click it.
 */
function sourceLink(row: VersionRow): { href: string; hint: string } | null {
  if (!row.remoteUrl) return null;

  if (row.source === "GITHUB") {
    // https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
    const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/releases\/download\/([^/]+)\//.exec(
      row.remoteUrl,
    );
    if (match) {
      return {
        href: `${match[1]}/releases/tag/${match[2]}`,
        hint: `Open the ${match[2]} release on GitHub`,
      };
    }
    return { href: row.remoteUrl, hint: "Open the release asset on GitHub" };
  }

  if (row.source === "MIRROR") {
    const file = row.remoteUrl.split("/").pop() || "the file";
    return { href: row.remoteUrl, hint: `Download ${file} from the mirror` };
  }

  return null;
}

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
  const [query, setQuery] = useState("");

  const { headProps, sort, sortRows } = useTableSort<SortKey, VersionRow>(
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

  const pagination = useTablePagination(matching, {
    // Anything that reshuffles the list starts the reader at the top again;
    // a background refresh of the same list does not.
    resetKey: `${query}|${sort.key}|${sort.direction}`,
  });
  const visible = pagination.rows;
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
        <Table containerClassName="max-h-[62vh]">
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
                  <SourceCell row={row} />
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
                      {/* Fixed width: the label flips between two words of
                          different lengths, and without this the button — and
                          the Cache button beside it — resize on every click. */}
                      <Button
                        variant={row.approved ? "ghost" : "secondary"}
                        size="sm"
                        className="w-[6.5rem] justify-center"
                        disabled={pending}
                        onClick={() => run(() => setVersionApproval(row.id, !row.approved))}
                      >
                        {row.approved ? <X /> : <Check />}
                        {row.approved ? "Decline" : "Approve"}
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePaginationBar pagination={pagination} unit="versions" />
      </div>

      <p className="text-xs text-muted-foreground">
        Approving a version only matters for auto-update, it is the gate the policy checks before
        starting a rollout on its own. Manual rollouts can pick any cached version.
      </p>
    </div>
  );
}

function SourceCell({ row }: { row: VersionRow }) {
  const link = sourceLink(row);

  if (!link) {
    return (
      <span title={row.source === "MANUAL" ? "Uploaded here — no upstream" : undefined}>
        {row.source.toLowerCase()}
      </span>
    );
  }

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noreferrer"
      title={link.hint}
      className="group inline-flex items-center gap-1 hover:text-foreground hover:underline"
    >
      {row.source.toLowerCase()}
      <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}
