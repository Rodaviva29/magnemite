"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  MoreHorizontal,
  Power,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import type { JobState, VersionSource } from "@magnemite/db";
import { startRollout, type ActionState } from "@/actions/rollouts";
import { rebootDevice, setDeviceApproval } from "@/actions/devices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { ACTIVE_JOB_STATES, JobStateBadge, OnlineDot } from "@/components/status";
import { formatBytes } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";
import { useTablePagination } from "@/lib/table-pagination";
import { useTableSort } from "@/lib/table-sort";
import { cn } from "@/lib/utils";

export type DeviceRow = {
  id: string;
  name: string;
  serial: string;
  online: boolean;
  approved: boolean;
  model: string | null;
  androidVersion: string | null;
  agentVersion: string | null;
  groupName: string | null;
  installedVersion: string | null;
  /** Installed version of each watched package, keyed by package name. */
  watchedVersions: Record<string, string | null>;
  freeBytes: number | null;
  lastSeenAt: string | null;
  /** Only present when the Rotom integration is on and this box was matched. */
  rotom: { connected: boolean; workers: number | null } | null;
  job: {
    id: string;
    rolloutId: string;
    state: JobState;
    progress: number;
    toVersion: string;
  } | null;
};

export type VersionOption = {
  id: string;
  /** The app this build belongs to. A rollout ships exactly one of them. */
  targetId: string;
  targetName: string;
  targetPackage: string;
  version: string;
  source: VersionSource;
  sizeBytes: number;
  approved: boolean;
};

type Filter = "all" | "online" | "offline" | "outdated" | "pending";

/**
 * An extra version column, configured in Settings.
 *
 * Magnemite does not update these packages — the boxes just report what they
 * have — so the column is a plain version with none of the up-to-date badging
 * the target app's column carries.
 */
export type WatchedColumn = { packageName: string; label: string };

// Plus one `pkg:<name>` per watched column, which is why this is not a closed
// union.
type FleetSortKey = string;

export function FleetTable({
  rows,
  groups,
  versions,
  latestVersion,
  packageName,
  watchedColumns,
  canOperate,
}: {
  rows: DeviceRow[];
  groups: { id: string; name: string }[];
  versions: VersionOption[];
  latestVersion: string | null;
  packageName: string;
  watchedColumns: WatchedColumn[];
  canOperate: boolean;
}) {
  // The scanner column only earns its space once Rotom has matched something.
  const showRotom = rows.some((row) => row.rotom !== null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const accessors = useMemo(() => {
    const map: Record<FleetSortKey, (row: DeviceRow) => string | number | null> = {
      device: (r) => r.name,
      group: (r) => r.groupName,
      version: (r) => r.installedVersion,
      scanner: (r) => (r.rotom ? (r.rotom.connected ? 2 : 1) : 0),
      // Offline boxes sort together, and a box mid-update outranks an idle one.
      status: (r) => (r.job ? 3 : r.online ? 2 : 1),
      free: (r) => r.freeBytes,
      agent: (r) => r.agentVersion,
      lastSeen: (r) => r.lastSeenAt,
    };
    for (const column of watchedColumns) {
      map[`pkg:${column.packageName}`] = (r) => r.watchedVersions[column.packageName] ?? null;
    }
    return map;
  }, [watchedColumns]);

  const { headProps, sort, sortRows } = useTableSort<FleetSortKey, DeviceRow>(accessors, {
    key: "device",
    direction: "asc",
  });

  const stats = useMemo(() => {
    const online = rows.filter((r) => r.online).length;
    const upToDate = latestVersion
      ? rows.filter((r) => r.installedVersion === latestVersion).length
      : 0;
    const pending = rows.filter((r) => !r.approved).length;
    const working = rows.filter((r) => r.job && ACTIVE_JOB_STATES.includes(r.job.state)).length;
    return { online, upToDate, pending, working };
  }, [rows, latestVersion]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (group && row.groupName !== group) return false;
      if (filter === "online" && !row.online) return false;
      if (filter === "offline" && row.online) return false;
      if (filter === "pending" && row.approved) return false;
      if (filter === "outdated") {
        if (!latestVersion || row.installedVersion === latestVersion) return false;
      }
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.serial.toLowerCase().includes(q) ||
        (row.model?.toLowerCase().includes(q) ?? false) ||
        (row.installedVersion?.toLowerCase().includes(q) ?? false) ||
        Object.values(row.watchedVersions).some(
          (version) => version?.toLowerCase().includes(q) ?? false,
        )
      );
    });
    return sortRows(filtered);
  }, [rows, query, filter, group, latestVersion, sortRows]);

  const pagination = useTablePagination(matching, {
    resetKey: `${query}|${filter}|${group}|${sort.key}|${sort.direction}`,
  });
  const visible = pagination.rows;

  // Selection follows the page you are looking at: the header checkbox ticks
  // what is in front of you, and anything already picked on another page stays
  // picked — the button label keeps the running count honest.
  const selectableIds = visible.filter((r) => r.approved).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Fleet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} device{rows.length === 1 ? "" : "s"} · {stats.online} online ·{" "}
            {stats.upToDate} on {latestVersion ?? "—"}
            {stats.working > 0 ? ` · ${stats.working} updating` : ""}
          </p>
        </div>

        {canOperate ? (
          <div className="flex gap-2">
            <RolloutDialog
              versions={versions}
              deviceIds={[...selected]}
              label={selected.size > 0 ? `Update ${selected.size} selected` : "Update selected"}
              disabled={selected.size === 0}
              variant="default"
            />
            <RolloutDialog
              versions={versions}
              deviceIds={[]}
              label="Update all"
              disabled={rows.length === 0}
              variant="outline"
            />
          </div>
        ) : null}
      </header>

      {stats.pending > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {stats.pending} device{stats.pending === 1 ? "" : "s"} waiting for approval — they will
          not receive updates until approved.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search name, serial, model, version…"
        />

        <Select
          aria-label="Filter devices"
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          className="w-40"
          options={[
            { value: "all", label: "All devices" },
            { value: "online", label: "Online" },
            { value: "offline", label: "Offline" },
            { value: "outdated", label: "Outdated" },
            { value: "pending", label: "Pending approval" },
          ]}
        />

        <Select
          aria-label="Filter by group"
          value={group}
          onValueChange={setGroup}
          className="w-40"
          options={[
            { value: "", label: "All groups" },
            ...groups.map((g) => ({ value: g.name, label: g.name })),
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table containerClassName="max-h-[64vh]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all on this page"
                  disabled={!canOperate || selectableIds.length === 0}
                />
              </TableHead>
              <TableSortHead {...headProps("device")}>Device</TableSortHead>
              <TableSortHead {...headProps("group")}>Group</TableSortHead>
              <TableSortHead {...headProps("version")}>
                {packageName.split(".").pop()}
              </TableSortHead>
              {watchedColumns.map((column) => (
                <TableSortHead key={column.packageName} {...headProps(`pkg:${column.packageName}`)}>
                  {column.label}
                </TableSortHead>
              ))}
              {showRotom ? <TableSortHead {...headProps("scanner")}>Scanner</TableSortHead> : null}
              <TableSortHead {...headProps("status")}>Status</TableSortHead>
              <TableSortHead {...headProps("free")} align="right">
                Free
              </TableSortHead>
              <TableSortHead {...headProps("agent")}>Agent</TableSortHead>
              <TableSortHead {...headProps("lastSeen")}>Last seen</TableSortHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={(showRotom ? 10 : 9) + watchedColumns.length}
                  className="py-10 text-center text-muted-foreground"
                >
                  {rows.length === 0
                    ? "No devices yet. Flash the Magisk module on a box and it will show up here."
                    : "No devices match this filter."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((row) => (
                <DeviceRowView
                  key={row.id}
                  row={row}
                  latestVersion={latestVersion}
                  selected={selected.has(row.id)}
                  onToggle={() => toggleOne(row.id)}
                  canOperate={canOperate}
                  showRotom={showRotom}
                  watchedColumns={watchedColumns}
                />
              ))
            )}
          </TableBody>
        </Table>
        <TablePaginationBar pagination={pagination} unit="devices" />
      </div>
    </div>
  );
}

function DeviceRowView({
  row,
  latestVersion,
  selected,
  onToggle,
  canOperate,
  showRotom,
  watchedColumns,
}: {
  row: DeviceRow;
  latestVersion: string | null;
  selected: boolean;
  onToggle: () => void;
  canOperate: boolean;
  watchedColumns: WatchedColumn[];
  showRotom: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const upToDate = latestVersion !== null && row.installedVersion === latestVersion;
  // Under ~450 MB a box cannot hold the bundle and its unpacked splits.
  const lowSpace = row.freeBytes !== null && row.freeBytes < 500 * 1024 * 1024;

  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!canOperate || !row.approved}
          aria-label={`Select ${row.name}`}
        />
      </TableCell>

      <TableCell>
        <div className="flex items-center gap-2">
          <OnlineDot online={row.online} />
          <div className="min-w-0">
            <Link
              href={`/devices/${row.id}`}
              className="block truncate font-medium hover:underline"
            >
              {row.name}
            </Link>
            <div className="truncate text-xs text-muted-foreground">
              {row.model ?? row.serial}
              {row.androidVersion ? ` · Android ${row.androidVersion}` : ""}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="text-muted-foreground">{row.groupName ?? "—"}</TableCell>

      <TableCell>
        {row.installedVersion ? (
          <Badge variant={upToDate ? "success" : "warning"}>
            {upToDate ? <CheckCircle2 className="h-3 w-3" /> : null}
            {row.installedVersion}
          </Badge>
        ) : (
          <span className="text-muted-foreground">not installed</span>
        )}
      </TableCell>

      {watchedColumns.map((column) => {
        const version = row.watchedVersions[column.packageName] ?? null;
        return (
          <TableCell key={column.packageName} className="font-mono text-xs">
            {version ?? <span className="font-sans text-muted-foreground">—</span>}
          </TableCell>
        );
      })}

      {showRotom ? (
        <TableCell>
          {row.rotom === null ? (
            <span className="text-xs text-muted-foreground" title="No matching device in Rotom">
              —
            </span>
          ) : row.rotom.connected ? (
            <Badge variant="success">
              scanning{row.rotom.workers ? ` · ${row.rotom.workers}w` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">not scanning</Badge>
          )}
        </TableCell>
      ) : null}

      <TableCell className="min-w-44">
        {!row.approved ? (
          <Badge variant="warning">pending approval</Badge>
        ) : row.job ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <JobStateBadge state={row.job.state} />
              <Link
                href={`/rollouts/${row.job.rolloutId}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                → {row.job.toVersion}
              </Link>
            </div>
            {ACTIVE_JOB_STATES.includes(row.job.state) ? (
              <Progress value={row.job.progress} />
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">idle</span>
        )}
      </TableCell>

      <TableCell
        className={cn("text-right font-mono text-xs", lowSpace && "text-warning")}
        title={lowSpace ? "Too little space for a 170 MB bundle plus its splits" : undefined}
      >
        {formatBytes(row.freeBytes)}
      </TableCell>

      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.agentVersion ?? "—"}
      </TableCell>

      <TableCell className="text-xs text-muted-foreground">
        {row.online ? "now" : <RelativeTime value={row.lastSeenAt} />}
      </TableCell>

      <TableCell>
        {canOperate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={pending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/devices/${row.id}`}>Open device</Link>
              </DropdownMenuItem>
              {!row.approved ? (
                <DropdownMenuItem
                  onSelect={() => startTransition(() => void setDeviceApproval(row.id, true))}
                >
                  <ShieldCheck />
                  Approve
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={!row.online}
                onSelect={() => startTransition(() => void rebootDevice(row.id))}
              >
                <Power />
                Reboot
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function RolloutSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Rocket />
      {pending ? "Starting…" : "Start rollout"}
    </Button>
  );
}

function RolloutDialog({
  versions,
  deviceIds,
  label,
  disabled,
  variant,
}: {
  versions: VersionOption[];
  deviceIds: string[];
  label: string;
  disabled?: boolean;
  variant: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(startRollout, {});
  const [forceClean, setForceClean] = useState(false);
  const [skipUpToDate, setSkipUpToDate] = useState(true);

  // Only apps with something cached can be rolled out at all, so the list is
  // derived from the versions rather than from every configured target — a
  // target with nothing on disk would be a dead end in the picker.
  const apps = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; packageName: string }>();
    for (const version of versions) {
      if (!seen.has(version.targetId)) {
        seen.set(version.targetId, {
          id: version.targetId,
          name: version.targetName,
          packageName: version.targetPackage,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [versions]);

  const [appTargetId, setAppTargetId] = useState("");
  // Falls back to the first app until one is picked, so the version list is
  // never empty on open.
  const activeAppId = appTargetId || (apps[0]?.id ?? "");
  const appVersions = versions.filter((version) => version.targetId === activeAppId);

  const deviceLabel =
    deviceIds.length > 0 ? `${deviceIds.length} selected device(s)` : "every approved device";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} disabled={disabled}>
          <Rocket />
          {label}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a rollout</DialogTitle>
          <DialogDescription>
            Targets {deviceLabel}. Devices that are offline keep their job queued and pick it up
            when they reconnect.
          </DialogDescription>
        </DialogHeader>

        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No cached versions yet. Go to{" "}
            <Link href="/versions" className="underline">
              Versions
            </Link>{" "}
            and cache one onto the server first.
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="deviceIds" value={deviceIds.join(",")} />

            <div className="flex flex-col gap-2">
              <Label htmlFor="rolloutAppTarget">App</Label>
              <Select
                id="rolloutAppTarget"
                aria-label="App to roll out"
                value={activeAppId}
                onValueChange={setAppTargetId}
                options={apps.map((app) => ({ value: app.id, label: app.name }))}
              />
              <p className="text-xs text-muted-foreground">
                A rollout ships one app. Only apps with a version cached on this server are listed.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="appVersionId">Version</Label>
              {/* Remounted per app so the default lands on that app's newest
                  build instead of keeping the previous app's selection. */}
              <Select
                key={activeAppId}
                id="appVersionId"
                name="appVersionId"
                required
                defaultValue={appVersions[0]?.id}
                options={appVersions.map((v) => ({
                  value: v.id,
                  label:
                    `${v.version} · ${v.source.toLowerCase()} · ${formatBytes(v.sizeBytes)}` +
                    (v.approved ? "" : " · not approved"),
                }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="canaryCount">Canary devices</Label>
                <Input id="canaryCount" name="canaryCount" type="number" min={0} defaultValue={1} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="soakMinutes">Soak (min)</Label>
                <Input
                  id="soakMinutes"
                  name="soakMinutes"
                  type="number"
                  min={0}
                  defaultValue={15}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="maxAttempts">Attempts</Label>
                <Input id="maxAttempts" name="maxAttempts" type="number" min={1} defaultValue={3} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              The canary devices update first. The rest wait for them to succeed, plus the soak.
            </p>

            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                name="forceClean"
                className="mt-0.5"
                checked={forceClean}
                onCheckedChange={(value) => setForceClean(value === true)}
              />
              <span>
                Force a clean install
                <span className="block text-xs text-muted-foreground">
                  Uninstalls first on every device. Normally the agent upgrades in place and only
                  falls back to this when Android rejects the upgrade.
                </span>
              </span>
            </label>

            {forceClean ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span>
                  WARNING: This wipes the app data on every targeted device: logins and settings
                  included.
                </span>
              </div>
            ) : null}

            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                name="skipUpToDate"
                className="mt-0.5"
                checked={skipUpToDate}
                onCheckedChange={(value) => setSkipUpToDate(value === true)}
              />
              <span>
                Skip devices already on this version
                <span className="block text-xs text-muted-foreground">
                  Uncheck to force a reinstall everywhere.
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input id="note" name="note" placeholder="Why this rollout" />
            </div>

            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <RolloutSubmit />
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
