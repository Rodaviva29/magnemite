import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { OnlineDot } from "@/components/status";
import { DeviceControls } from "@/components/device-controls";
import {
  DeviceHistory,
  type DeviceAgentUpdateRow,
  type DeviceJobRow,
} from "@/components/device-history";
import { DevicePackages, type DevicePackageRow } from "@/components/device-packages";
import { DeviceLastSeen } from "@/components/device-last-seen";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [device, groups, targets] = await Promise.all([
    prisma.device.findUnique({
      where: { id },
      include: {
        group: true,
        packages: { orderBy: { packageName: "asc" } },
        agentUpdates: {
          orderBy: { sentAt: "desc" },
          // Same idea as the job cap below: enough history to see a pattern,
          // not the whole life of the box.
          take: 50,
        },
        jobs: {
          orderBy: { queuedAt: "desc" },
          // The table pages client-side, so this is a cap on how far back the
          // history goes rather than on what fits on screen.
          take: 200,
          include: { rollout: { select: { id: true, appVersion: { select: { version: true } } } } },
        },
      },
    }),
    prisma.deviceGroup.findMany({ orderBy: { name: "asc" } }),
    // Which of the installed packages Magnemite can actually update.
    prisma.appTarget.findMany({ where: { enabled: true }, select: { packageName: true } }),
  ]);

  if (!device) notFound();

  const online = device.status === "ONLINE";

  const memTotal = device.memTotalBytes === null ? null : Number(device.memTotalBytes);
  const memAvailable = device.memAvailableBytes === null ? null : Number(device.memAvailableBytes);
  const memUsed = memTotal === null || memAvailable === null ? null : memTotal - memAvailable;

  const diskTotal = device.totalBytes === null ? null : Number(device.totalBytes);
  const diskFree = device.freeBytes === null ? null : Number(device.freeBytes);
  const diskUsed = diskTotal === null || diskFree === null ? null : diskTotal - diskFree;

  const jobRows: DeviceJobRow[] = device.jobs.map((job) => ({
    id: job.id,
    rolloutId: job.rolloutId,
    state: job.state,
    fromVersion: job.fromVersion,
    toVersion: job.toVersion,
    installMode: job.installMode,
    dataWiped: job.dataWiped,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    durationMs:
      job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
  }));

  const agentUpdateRows: DeviceAgentUpdateRow[] = device.agentUpdates.map((update) => ({
    id: update.id,
    fromVersion: update.fromVersion,
    toVersion: update.toVersion,
    state: update.state,
    error: update.error,
    sentAt: update.sentAt.toISOString(),
    finishedAt: update.finishedAt?.toISOString() ?? null,
  }));

  const tracked = new Set(targets.map((t) => t.packageName));
  const packageRows: DevicePackageRow[] = device.packages.map((pkg) => ({
    id: pkg.id,
    packageName: pkg.packageName,
    versionName: pkg.versionName,
    versionCode: pkg.versionCode === null ? null : pkg.versionCode.toString(),
    installed: pkg.installed,
    tracked: tracked.has(pkg.packageName),
  }));

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Fleet
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <OnlineDot online={online} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{device.name}</h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{device.serial}</p>
          </div>
          {!device.approved ? <Badge variant="warning">pending approval</Badge> : null}
        </div>

        {user.role !== "VIEWER" ? (
          <DeviceControls
            deviceId={device.id}
            name={device.name}
            approved={device.approved}
            online={online}
            groupId={device.groupId}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            hasRotom={Boolean(device.rotomDeviceId)}
          />
        ) : null}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hardware</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Field
              label="Model"
              value={[device.manufacturer, device.model].filter(Boolean).join(" ") || "—"}
            />
            <Field label="Android" value={device.androidVersion ?? "—"} />
            <Field label="SDK" value={device.sdkInt?.toString() ?? "—"} />
            <Field label="ABI" value={device.abi ?? "—"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">State</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Field label="Group" value={device.group?.name ?? "—"} />
            <Field
              label="Uptime"
              value={
                device.uptimeSeconds
                  ? formatDuration(new Date(Date.now() - device.uptimeSeconds * 1000), new Date())
                  : "—"
              }
            />
            <Field
              label="Last seen"
              value={
                <DeviceLastSeen
                  lastSeenAt={device.lastSeenAt?.toISOString() ?? null}
                  online={online}
                />
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Load</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Meter
              label="CPU"
              // Load average against core count is the honest reading a box
              // can give for free: 1.0 per core means "fully busy", above that
              // means work is queueing.
              detail={
                device.loadAvg1 === null
                  ? "not reported"
                  : `${device.loadAvg1.toFixed(2)}${
                      device.cpuCount ? ` of ${device.cpuCount} cores` : ""
                    }`
              }
              percent={
                device.loadAvg1 === null || !device.cpuCount
                  ? null
                  : (device.loadAvg1 / device.cpuCount) * 100
              }
            />
            <Meter
              label="Memory"
              detail={
                memUsed === null || memTotal === null
                  ? "not reported"
                  : `${formatBytes(memUsed)} of ${formatBytes(memTotal)}`
              }
              percent={memUsed === null || !memTotal ? null : (memUsed / memTotal) * 100}
            />
            <Meter
              label="Storage"
              detail={
                diskUsed === null || diskTotal === null
                  ? formatBytes(device.freeBytes === null ? null : Number(device.freeBytes))
                  : `${formatBytes(diskUsed)} of ${formatBytes(diskTotal)}`
              }
              percent={diskUsed === null || !diskTotal ? null : (diskUsed / diskTotal) * 100}
            />
            {device.loadAvg5 !== null || device.loadAvg15 !== null ? (
              // The raw 5/15-minute load averages mean nothing to most people
              // ("15 min 1.64" — of what?). Against the core count they turn
              // into the same percentage the CPU bar above already shows, which
              // is what makes "busy right now" versus "busy all afternoon"
              // readable at a glance.
              <p className="text-xs text-muted-foreground">
                CPU averaged {loadText(device.loadAvg5, device.cpuCount)} over the last 5m and{" "}
                {loadText(device.loadAvg15, device.cpuCount)} over 15m
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Field label="Version" value={device.agentVersion ?? "—"} />
            {/* The socket's remote address is the reverse proxy on the hub's
                own network — the same 10.x on every box — so show the LAN
                address the agent reports, and fall back only for agents too
                old to send one. */}
            {device.localIp ? (
              <Field label="Local IP" value={device.localIp} />
            ) : (
              <Field label="Public IP" value={device.publicIp ?? "—"} />
            )}
            <Field label="Enrolled" value={formatRelative(device.createdAt)} />
            <Field
              label="Scanner (rotom)"
              value={
                device.rotomDeviceId
                  ? `${device.rotomConnected ? "scanning" : "not scanning"}${
                      device.rotomWorkerCount ? ` · ${device.rotomWorkerCount} workers` : ""
                    }`
                  : "not matched"
              }
            />
            {device.rotomOrigin ? <Field label="Rotom origin" value={device.rotomOrigin} /> : null}
          </CardContent>
        </Card>
      </div>

      <DevicePackages
        packages={packageRows}
        syncedAt={device.packagesSyncedAt?.toISOString() ?? null}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Update history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <DeviceHistory jobs={jobRows} agentUpdates={agentUpdateRows} />
        </CardContent>
      </Card>
    </div>
  );
}

/** A load average as a share of the box's cores, which is how the bars read. */
function loadText(load: number | null, cores: number | null): string {
  if (load === null) return "—";
  if (!cores) return load.toFixed(2);
  return `${Math.round((load / cores) * 100)}%`;
}

/**
 * A labelled bar. `percent` is null when the box has not reported the reading —
 * an agent old enough to predate these metrics — and that reads as "not
 * reported" rather than as a bar sitting at zero.
 */
function Meter({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string;
  percent: number | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right text-xs">
          {detail}
          {percent === null ? "" : ` (${Math.round(percent)}%)`}
        </span>
      </div>
      {percent === null ? (
        <Progress value={0} tone="muted" />
      ) : (
        <Progress
          value={percent}
          tone={percent >= 90 ? "danger" : percent >= 70 ? "primary" : "success"}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
