import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { compareVersions } from "@/lib/format";
import { FleetTable, type DeviceRow, type VersionOption } from "@/components/fleet-table";

export const dynamic = "force-dynamic";

const ACTIVE_OR_QUEUED = [
  "QUEUED",
  "DISPATCHED",
  "DOWNLOADING",
  "EXTRACTING",
  "INSTALLING",
  "VERIFYING",
] as const;

export default async function FleetPage() {
  const user = await requireUser();

  const target = await prisma.appTarget.findFirst({ where: { enabled: true } });
  const packageName = target?.packageName ?? "com.nianticlabs.pokemongo";

  const [devices, groups, versions] = await Promise.all([
    prisma.device.findMany({
      include: {
        group: { select: { id: true, name: true } },
        packages: { where: { packageName } },
        jobs: {
          where: { state: { in: [...ACTIVE_OR_QUEUED] } },
          orderBy: { queuedAt: "desc" },
          take: 1,
          select: { id: true, state: true, progress: true, rolloutId: true, toVersion: true },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    }),
    prisma.deviceGroup.findMany({ orderBy: { name: "asc" } }),
    prisma.appVersion.findMany({
      where: { status: "READY", appTargetId: target?.id },
      orderBy: { discoveredAt: "desc" },
    }),
  ]);

  const rows: DeviceRow[] = devices.map((device) => {
    const job = device.jobs[0];
    return {
      id: device.id,
      name: device.name,
      serial: device.serial,
      online: device.status === "ONLINE",
      approved: device.approved,
      model: [device.manufacturer, device.model].filter(Boolean).join(" ") || null,
      androidVersion: device.androidVersion,
      agentVersion: device.agentVersion,
      groupName: device.group?.name ?? null,
      installedVersion: device.packages[0]?.versionName ?? null,
      freeBytes: device.freeBytes === null ? null : Number(device.freeBytes),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      rotom: device.rotomDeviceId
        ? { connected: device.rotomConnected, workers: device.rotomWorkerCount }
        : null,
      job: job
        ? {
            id: job.id,
            rolloutId: job.rolloutId,
            state: job.state,
            progress: job.progress,
            toVersion: job.toVersion,
          }
        : null,
    };
  });

  const versionOptions: VersionOption[] = versions
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((v) => ({
      id: v.id,
      version: v.version,
      source: v.source,
      sizeBytes: Number(v.sizeBytes),
      approved: v.approved,
    }));

  const latestVersion = versionOptions[0]?.version ?? null;

  return (
    <FleetTable
      rows={rows}
      groups={groups.map((g) => ({ id: g.id, name: g.name }))}
      versions={versionOptions}
      latestVersion={latestVersion}
      packageName={packageName}
      canOperate={user.role !== "VIEWER"}
    />
  );
}
