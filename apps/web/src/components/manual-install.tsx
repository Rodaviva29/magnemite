"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, Trash2, Upload, Wand2, X } from "lucide-react";
import { deleteManualVersion, startManualInstall } from "@/actions/manual";
import { readApkInfoFromFile, type ApkInfo } from "@/lib/apk-info";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from "@/components/ui/table";
import { OnlineDot } from "@/components/status";
import { formatBytes } from "@/lib/format";
import { RelativeTime } from "@/components/relative-time";
import { useTableSort } from "@/lib/table-sort";
import { cn } from "@/lib/utils";

export type FleetPackage = {
  packageName: string;
  displayName: string | null;
  devices: number;
};

export type ManualDevice = {
  id: string;
  name: string;
  serial: string;
  online: boolean;
  groupId: string | null;
  groupName: string | null;
  model: string | null;
  androidVersion: string | null;
  freeBytes: number | null;
  lastSeenAt: string | null;
  /** Reported version per package, for the "currently on" column. */
  installed: Record<string, string>;
};

export type ManualBuild = {
  id: string;
  packageName: string;
  displayName: string;
  version: string;
  arch: string;
  sizeBytes: number;
  sha256: string | null;
  uploadedAt: string;
};

type Group = {
  id: string;
  name: string;
  preInstallHook: string | null;
  postInstallHook: string | null;
};

const CUSTOM = "__custom__";

/**
 * Manual install: put an APK you have in your hand onto boxes you choose.
 *
 * Everything else in Magnemite is about the one watched app and the versions a
 * source publishes for it. This is the escape hatch — a scanner build that is
 * not on the mirror yet, a launcher, a config app — and it deliberately ends
 * up in the same place: a normal rollout, with the same jobs and the same page
 * to watch it fail or finish on.
 */
export function ManualInstall({
  packages,
  devices,
  groups,
  builds,
  canOperate,
}: {
  packages: FleetPackage[];
  devices: ManualDevice[];
  groups: Group[];
  builds: ManualBuild[];
  canOperate: boolean;
}) {
  const router = useRouter();

  // --- what to install ----------------------------------------------------
  const [choice, setChoice] = useState(packages[0]?.packageName ?? CUSTOM);
  const [customPackage, setCustomPackage] = useState("");
  const packageName = choice === CUSTOM ? customPackage.trim() : choice;

  const [file, setFile] = useState<File | null>(null);
  // What the file says about itself, read in the browser by the same parser
  // the hub runs on the upload. Null while it is being read.
  const [info, setInfo] = useState<ApkInfo | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ManualBuild | null>(null);

  // --- where it goes ------------------------------------------------------
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // --- how ----------------------------------------------------------------
  const [preHook, setPreHook] = useState("");
  const [postHook, setPostHook] = useState("");
  const [forceClean, setForceClean] = useState(false);
  const [skipUpToDate, setSkipUpToDate] = useState(false);
  const [note, setNote] = useState("");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const buildsForPackage = useMemo(
    () => (packageName ? builds.filter((b) => b.packageName === packageName) : builds),
    [builds, packageName],
  );

  // Sorted like the fleet table, because this is the fleet — the question
  // "which boxes" is the same one, asked while holding a file.
  const { headProps, sortRows } = useTableSort<
    "device" | "group" | "version" | "free" | "lastSeen",
    ManualDevice
  >(
    {
      device: (d) => d.name,
      group: (d) => d.groupName,
      version: (d) => (packageName ? (d.installed[packageName] ?? null) : null),
      free: (d) => d.freeBytes,
      lastSeen: (d) => d.lastSeenAt,
    },
    { key: "device", direction: "asc" },
  );

  const visibleDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = devices.filter((device) => {
      if (groupFilter && device.groupId !== groupFilter) return false;
      if (!q) return true;
      return (
        device.name.toLowerCase().includes(q) ||
        device.serial.toLowerCase().includes(q) ||
        (device.model?.toLowerCase().includes(q) ?? false) ||
        (device.groupName?.toLowerCase().includes(q) ?? false) ||
        (packageName ? (device.installed[packageName]?.toLowerCase().includes(q) ?? false) : false)
      );
    });
    return sortRows(filtered);
  }, [devices, query, groupFilter, packageName, sortRows]);

  const allVisiblePicked =
    visibleDevices.length > 0 && visibleDevices.every((d) => picked.has(d.id));
  const someVisiblePicked = visibleDevices.some((d) => picked.has(d.id));

  function toggleAllVisible() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allVisiblePicked) visibleDevices.forEach((d) => next.delete(d.id));
      else visibleDevices.forEach((d) => next.add(d.id));
      return next;
    });
  }

  function toggleDevice(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Read the manifest as soon as a file is chosen. Only a few kilobytes are
   * touched — the zip's tail and the one entry holding the manifest — so this
   * costs nothing even on a 250 MB bundle.
   */
  function chooseFile(picked: File | null) {
    setFile(picked);
    setUploadError(null);
    setInfo(null);
    if (!picked) return;

    setReading(true);
    void readApkInfoFromFile(picked)
      .then((read) => setInfo(read))
      .finally(() => setReading(false));
  }

  function clearFile() {
    setFile(null);
    setInfo(null);
    setUploadError(null);
    // The input keeps its own value, so without this the same file cannot be
    // chosen again — the change event never fires for an unchanged path.
    if (fileInput.current) fileInput.current.value = "";
  }

  /**
   * XHR rather than fetch: this is the one request in the app where the
   * operator needs to watch a progress bar, and `fetch` still cannot report
   * upload progress.
   */
  function upload() {
    if (!file) return;
    setUploadError(null);
    setUploadPct(0);

    // The version always comes out of the file's own manifest — it is the one
    // thing about a build nobody should be able to mistype. The package name
    // stays a hint the hub falls back on when the manifest does not name one.
    const query = new URLSearchParams({ filename: file.name });
    if (packageName) query.set("packageName", packageName);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/manual/upload?${query.toString()}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadPct(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      setUploadPct(null);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        payload = {};
      }

      if (xhr.status >= 400) {
        setUploadError((payload.error as string) ?? `Upload failed (HTTP ${xhr.status})`);
        return;
      }

      setSelected({
        id: payload.appVersionId as string,
        packageName: payload.packageName as string,
        displayName: (payload.packageName as string).split(".").pop() ?? "",
        version: payload.version as string,
        arch: "arm64-v8a",
        sizeBytes: Number(payload.sizeBytes ?? 0),
        sha256: (payload.sha256 as string) ?? null,
        uploadedAt: new Date().toISOString(),
      });
      clearFile();
      router.refresh();
    };

    xhr.onerror = () => {
      setUploadPct(null);
      setUploadError("The upload did not reach the server.");
    };

    xhr.send(file);
  }

  function install() {
    if (!selected) return;
    setError(null);

    startTransition(async () => {
      const result = await startManualInstall({
        appVersionId: selected.id,
        deviceIds: [...picked],
        preInstallHook: preHook.trim() || null,
        postInstallHook: postHook.trim() || null,
        forceClean,
        skipUpToDate,
        maxConcurrency: null,
        note: note.trim() || null,
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/rollouts/${result.rolloutId}`);
    });
  }

  function remove(build: ManualBuild) {
    startTransition(async () => {
      const result = await deleteManualVersion(build.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (selected?.id === build.id) setSelected(null);
      router.refresh();
    });
  }

  const uploading = uploadPct !== null;
  const canUpload = Boolean(file) && !uploading && canOperate;
  // The version the hub will store, since it parses the same bytes.
  const detectedVersion = info?.versionName ?? info?.versionCode ?? null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Manual install</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Push an APK you have on hand to boxes you pick! Made for an app no source is watched for,
          or a build that is not published yet. It runs as a normal rollout.
        </p>
      </header>

      {!canOperate ? (
        <p className="rounded-lg border border-border bg-subtle px-3 py-2 text-sm text-muted-foreground">
          Your account is read-only, so uploading and installing are disabled.
        </p>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {/* --- 1. the app ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>1 · Which app</CardTitle>
          <CardDescription>
            The package the APK replaces. Installing over a different signing key wipes the
            app&apos;s data. The agent falls back to uninstall-and-install and says so on the job.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="package">Package</Label>
            <Select
              id="package"
              placeholder="Select package…"
              value={choice}
              onValueChange={setChoice}
              options={[
                ...packages.map((p) => ({
                  value: p.packageName,
                  label: p.devices > 0 ? `${p.packageName} · ${p.devices} boxes` : p.packageName,
                })),
                { value: CUSTOM, label: "Another package…" },
              ]}
            />
            {choice === CUSTOM ? (
              <Input
                value={customPackage}
                onChange={(e) => setCustomPackage(e.target.value)}
                placeholder="com.example.app"
                className="mt-1 font-mono"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* --- 2. the file --------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>2 · The build</CardTitle>
          <CardDescription>
            A single <code className="font-mono">.apk</code>, or an{" "}
            <code className="font-mono">.apkm</code> / <code className="font-mono">.xapk</code>{" "}
            bundle of splits. A lone APK is wrapped into a one-entry bundle on the server, which is
            what the agent installs from. Nothing to do on your side.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-64 flex-1 flex-col gap-1.5">
              <Label htmlFor="file">File</Label>
              {/* The browser's own file control cannot be sized or centred
                  reliably — its button is a pseudo-element whose metrics differ
                  per engine — so the input is hidden and a real Button drives
                  it. Same height and same styling as every other field here. */}
              <div
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-lg border border-input bg-card pl-1.5 pr-3",
                  (!canOperate || uploading) && "opacity-40",
                )}
              >
                <Button
                  asChild
                  variant="secondary"
                  size="sm"
                  className="h-7 shrink-0"
                  disabled={!canOperate || uploading}
                >
                  <label htmlFor="file" className="cursor-pointer">
                    Choose file
                  </label>
                </Button>
                <span className="truncate text-sm text-muted-foreground">
                  {file ? `${file.name} · ${formatBytes(file.size)}` : "No file selected"}
                </span>
                {file && !uploading ? (
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Remove the chosen file"
                    className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {/* Which build this is, answered before a few hundred megabytes
                  of upload rather than after — the commonest mistake here is
                  picking the wrong file out of a folder of near-identical
                  names. Read from the manifest, not the file name, so it is
                  the version that will actually be stored. */}
              {file ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {reading ? (
                    <span className="text-muted-foreground">Reading the manifest…</span>
                  ) : detectedVersion ? (
                    <>
                      <span className="text-muted-foreground">Version</span>
                      <span className="font-mono font-medium text-foreground">
                        {detectedVersion}
                      </span>
                      {info?.versionName && info.versionCode ? (
                        <span className="font-mono text-muted-foreground">
                          · build {info.versionCode}
                        </span>
                      ) : null}
                      {/* The package the file declares, flagged only when it
                          disagrees with the one chosen above — that mismatch
                          is the mistake worth catching. */}
                      {info?.packageName && info.packageName !== packageName ? (
                        <span className="font-mono text-warning">· {info.packageName}</span>
                      ) : info?.packageName ? (
                        <span className="font-mono text-muted-foreground">
                          · {info.packageName}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Could not read a version out of this file — the hub will try again on upload.
                    </span>
                  )}
                </div>
              ) : null}

              <input
                id="file"
                ref={fileInput}
                type="file"
                accept=".apk,.apkm,.xapk,.zip"
                disabled={!canOperate || uploading}
                onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </div>
            <Button onClick={upload} disabled={!canUpload}>
              <Upload />
              {uploading ? `Uploading ${uploadPct}%` : "Upload"}
            </Button>
          </div>

          {uploading ? <Progress value={uploadPct ?? 0} /> : null}

          {uploadError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {uploadError}
            </p>
          ) : null}

          {selected ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <span className="font-mono">{selected.packageName}</span>
              <Badge variant="success">{selected.version}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatBytes(selected.sizeBytes)}
                {selected.sha256 ? ` · sha256 ${selected.sha256.slice(0, 12)}…` : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setSelected(null)}
              >
                Choose another
              </Button>
            </div>
          ) : null}

          {buildsForPackage.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">
                Already uploaded{packageName ? ` for ${packageName}` : ""}
              </p>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                {buildsForPackage.map((build) => (
                  <li
                    key={build.id}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      selected?.id === build.id
                        ? "border-primary/40 bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="font-mono">{build.version}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {build.packageName} · {formatBytes(build.sizeBytes)} ·{" "}
                      <RelativeTime value={build.uploadedAt} />
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canOperate || pending}
                        onClick={() => setSelected(build)}
                      >
                        Use this
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Forget ${build.version}`}
                        disabled={!canOperate || pending}
                        onClick={() => remove(build)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* --- 3. where ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>3 · Which boxes</CardTitle>
          <CardDescription>
            Offline boxes can be picked: the job waits queued and dispatches the moment the agent
            reconnects.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={query} onChange={setQuery} placeholder="Search name, serial…" />
            <Select
              aria-label="Filter by group"
              placeholder="Select group…"
              value={groupFilter}
              onValueChange={setGroupFilter}
              className="w-44"
              options={[
                { value: "", label: "All groups" },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            {/* A checkbox rather than a button: the label stays put whether
                the set is picked or not, so the row does not reflow on every
                click the way a Select/Clear button did. */}
            <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm">
              <Checkbox
                checked={allVisiblePicked ? true : someVisiblePicked ? "indeterminate" : false}
                onCheckedChange={toggleAllVisible}
                aria-label="Select every device in this filter"
                disabled={!canOperate || visibleDevices.length === 0}
              />
              <span className="tabular-nums">Select all {visibleDevices.length}</span>
            </label>
            {/* Fixed width and tabular figures: the search input beside it is
                flex-1, so a counter that grows from "0 picked" to "12 picked"
                would steal width from it and shuffle the whole row on every
                click. */}
            <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {picked.size} picked
            </span>
          </div>

          <div className="rounded-lg border border-border">
            <Table containerClassName="max-h-80">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableSortHead {...headProps("device")}>Device</TableSortHead>
                  <TableSortHead {...headProps("group")}>Group</TableSortHead>
                  <TableSortHead {...headProps("version")}>
                    {packageName ? packageName.split(".").pop() : "Installed"}
                  </TableSortHead>
                  <TableSortHead {...headProps("free")} align="right">
                    Free
                  </TableSortHead>
                  <TableSortHead {...headProps("lastSeen")}>Last seen</TableSortHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No approved device matches this filter.
                    </TableCell>
                  </TableRow>
                ) : null}
                {visibleDevices.map((device) => {
                  const current = packageName ? device.installed[packageName] : undefined;
                  return (
                    <TableRow
                      key={device.id}
                      // The whole row is the hit target: picking twenty boxes
                      // should not mean twenty small checkboxes.
                      className="cursor-pointer"
                      onClick={() => {
                        if (canOperate) toggleDevice(device.id);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={picked.has(device.id)}
                          onCheckedChange={() => toggleDevice(device.id)}
                          aria-label={`Select ${device.name}`}
                          disabled={!canOperate}
                        />
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          <OnlineDot online={device.online} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{device.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {device.model ?? device.serial}
                              {device.androidVersion ? ` · Android ${device.androidVersion}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {device.groupName ?? "—"}
                      </TableCell>

                      <TableCell className="font-mono text-xs">
                        {current ?? (
                          <span className="font-sans text-muted-foreground">not installed</span>
                        )}
                      </TableCell>

                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {device.freeBytes === null ? "—" : formatBytes(device.freeBytes)}
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground">
                        <RelativeTime value={device.lastSeenAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* --- 4. how -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>4 · Hooks and options</CardTitle>
          <CardDescription>
            Shell run as root on the box, around the install. Left empty, each box falls back to its
            group&apos;s own hook, which stops and starts the watched app, not this one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pre">Pre-install hook</Label>
              <Textarea
                id="pre"
                value={preHook}
                onChange={(e) => setPreHook(e.target.value)}
                placeholder={
                  packageName ? `am force-stop ${packageName}` : "am force-stop com.example.app"
                }
                disabled={!canOperate}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post">Post-install hook</Label>
              <Textarea
                id="post"
                value={postHook}
                onChange={(e) => setPostHook(e.target.value)}
                placeholder={
                  packageName
                    ? `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`
                    : "monkey -p com.example.app -c android.intent.category.LAUNCHER 1"
                }
                disabled={!canOperate}
              />
            </div>
          </div>

          {groups.some((g) => g.preInstallHook || g.postInstallHook) ? (
            <details className="rounded-lg border border-border bg-subtle px-3 py-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                What the groups run today
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {groups
                  .filter((g) => g.preInstallHook || g.postInstallHook)
                  .map((g) => (
                    <li key={g.id}>
                      <p className="font-medium">{g.name}</p>
                      {g.preInstallHook ? (
                        <p className="font-mono text-muted-foreground">pre: {g.preInstallHook}</p>
                      ) : null}
                      {g.postInstallHook ? (
                        <p className="font-mono text-muted-foreground">post: {g.postInstallHook}</p>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="text-sm font-medium">Clean install</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Uninstall first instead of upgrading in place. Wipes the app&apos;s data on every
                  box: accounts, logins, settings.
                </span>
              </span>
              <Switch checked={forceClean} onCheckedChange={setForceClean} disabled={!canOperate} />
            </label>

            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="text-sm font-medium">Skip boxes already on this label</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Off by default here: a re-upload under the same label is usually a different
                  build, and skipping would quietly do nothing.
                </span>
              </span>
              <Switch
                checked={skipUpToDate}
                onCheckedChange={setSkipUpToDate}
                disabled={!canOperate}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this build is going out"
              disabled={!canOperate}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {selected ? (
            <>
              <span className="font-mono text-foreground">{selected.packageName}</span>{" "}
              <Badge variant="outline">{selected.version}</Badge> on{" "}
              <span className="text-foreground">{picked.size}</span> box
              {picked.size === 1 ? "" : "es"}
              {forceClean ? " · data will be wiped" : ""}
            </>
          ) : (
            "Upload a build or pick one above."
          )}
        </p>
        <Button
          onClick={install}
          disabled={!canOperate || pending || !selected || picked.size === 0}
        >
          <Wand2 />
          {pending ? "Starting…" : "Install now"}
        </Button>
      </div>
    </div>
  );
}
