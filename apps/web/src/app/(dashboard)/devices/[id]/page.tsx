import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobStateBadge, OnlineDot } from "@/components/status";
import { DeviceControls } from "@/components/device-controls";
import { formatBytes, formatDuration, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [device, groups] = await Promise.all([
    prisma.device.findUnique({
      where: { id },
      include: {
        group: true,
        packages: { orderBy: { packageName: "asc" } },
        jobs: {
          orderBy: { queuedAt: "desc" },
          take: 20,
          include: { rollout: { select: { id: true, appVersion: { select: { version: true } } } } },
        },
      },
    }),
    prisma.deviceGroup.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!device) notFound();

  const online = device.status === "ONLINE";

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

      <div className="grid gap-4 md:grid-cols-3">
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
              label="Storage free"
              value={`${formatBytes(device.freeBytes === null ? null : Number(device.freeBytes))}${
                device.totalBytes ? ` of ${formatBytes(Number(device.totalBytes))}` : ""
              }`}
            />
            <Field
              label="Uptime"
              value={
                device.uptimeSeconds
                  ? formatDuration(new Date(Date.now() - device.uptimeSeconds * 1000), new Date())
                  : "—"
              }
            />
            <Field label="Last seen" value={online ? "now" : formatRelative(device.lastSeenAt)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <Field label="Version" value={device.agentVersion ?? "—"} />
            <Field label="Public IP" value={device.publicIp ?? "—"} />
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Installed packages</CardTitle>
        </CardHeader>
        <CardContent>
          {device.packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing reported yet — the agent sends this on its next heartbeat.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {device.packages.map((pkg) => (
                <li key={pkg.id} className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs">{pkg.packageName}</span>
                  <span>
                    {pkg.installed ? (
                      <Badge variant="secondary">
                        {pkg.versionName ?? "unknown"}
                        {pkg.versionCode ? ` (${pkg.versionCode})` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline">not installed</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Update history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {device.jobs.length === 0 ? (
            <p className="p-5 pt-0 text-sm text-muted-foreground">
              No updates run on this box yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {device.jobs.map((job) => (
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
                      {formatDuration(job.startedAt, job.finishedAt)}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
