import { getHubSettings, prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { AutoUpdateForm } from "@/components/settings/auto-update-form";
import { CreateAppTargetForm } from "@/components/settings/create-app-target-form";
import { GroupsSection } from "@/components/settings/groups-section";
import { HubSettingsForm } from "@/components/settings/hub-settings-form";
import { SourcesSection } from "@/components/settings/sources-section";
import { WatchedPackagesSection } from "@/components/settings/watched-packages-section";
import { EnrollmentSection } from "@/components/settings/enrollment-section";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const canOperate = user.role !== "VIEWER";

  const [hubSettings, targets, feeds, watched, deviceCount, reporting, groups, tokens] =
    await Promise.all([
      getHubSettings(),
      prisma.appTarget.findMany({ orderBy: { displayName: "asc" } }),
      prisma.sourceFeed.findMany({
        orderBy: { priority: "asc" },
        include: { _count: { select: { versions: true } } },
      }),
      prisma.watchedPackage.findMany({ orderBy: { position: "asc" } }),
      prisma.device.count({ where: { approved: true } }),
      // How many boxes have answered for each watched package, in one pass
      // rather than a count per package.
      prisma.devicePackage.groupBy({
        by: ["packageName"],
        where: { installed: true },
        _count: { _all: true },
      }),
      prisma.deviceGroup.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { devices: true } } },
      }),
      prisma.enrollmentToken.findMany({ orderBy: { createdAt: "desc" } }),
    ]);

  const publicUrl = process.env.MAGNEMITE_PUBLIC_URL ?? "https://your.host";
  const reportingCounts = new Map(reporting.map((row) => [row.packageName, row._count._all]));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-update policy, where versions are discovered, per-group install hooks, and the tokens
          new boxes enroll with.
        </p>
      </header>

      <HubSettingsForm settings={hubSettings} disabled={!canOperate} />

      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No app target configured yet — add one below to start tracking versions and rollouts.
        </p>
      ) : null}

      {targets.map((target) => (
        <AutoUpdateForm
          key={target.id}
          target={{
            id: target.id,
            displayName: target.displayName,
            packageName: target.packageName,
            autoUpdateEnabled: target.autoUpdateEnabled,
            autoApprove: target.autoApprove,
            canaryCount: target.canaryCount,
            soakMinutes: target.soakMinutes,
            maxAttempts: target.maxAttempts,
            windowStart: target.windowStart,
            windowEnd: target.windowEnd,
          }}
          disabled={!canOperate}
        />
      ))}

      {!canOperate ? null : <CreateAppTargetForm />}

      <SourcesSection
        feeds={feeds.map((feed) => ({
          id: feed.id,
          name: feed.name,
          indexUrl: feed.indexUrl,
          baseUrl: feed.baseUrl,
          enabled: feed.enabled,
          priority: feed.priority,
          versionCount: feed._count.versions,
        }))}
        disabled={!canOperate}
      />

      <WatchedPackagesSection
        packages={watched.map((row) => ({
          id: row.id,
          packageName: row.packageName,
          label: row.label,
          // How many boxes have answered for it, which is the difference
          // between "nothing has it installed" and "nobody has reported yet".
          reporting: reportingCounts.get(row.packageName) ?? 0,
        }))}
        deviceCount={deviceCount}
        disabled={!canOperate}
      />

      <GroupsSection
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          preInstallHook: g.preInstallHook,
          postInstallHook: g.postInstallHook,
          maxConcurrency: g.maxConcurrency,
          deviceCount: g._count.devices,
        }))}
        disabled={!canOperate}
      />

      <EnrollmentSection
        tokens={tokens.map((t) => ({
          id: t.id,
          label: t.label,
          prefix: t.prefix,
          autoApprove: t.autoApprove,
          uses: t.uses,
          maxUses: t.maxUses,
          revoked: t.revoked,
          createdAt: t.createdAt.toISOString(),
        }))}
        publicUrl={publicUrl}
        disabled={!canOperate}
      />
    </div>
  );
}
