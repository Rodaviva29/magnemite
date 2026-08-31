import Link from "next/link";
import { ChartSpline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Meter, type MeterTone } from "@/components/charts/meter";
import { formatBytes } from "@/lib/format";

export type DeviceLoad = {
  deviceId: string;
  loadAvg1: number | null;
  loadAvg5: number | null;
  loadAvg15: number | null;
  cpuCount: number | null;
  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  freeBytes: number | null;
  totalBytes: number | null;
};

export type LoadTrend = {
  cpu: (number | null)[];
  memory: (number | null)[];
  storage: (number | null)[];
};

/**
 * What the box is doing right now, with the last hour behind each number.
 *
 * The sparklines are what make the card worth more than four numbers: 78%
 * memory is unremarkable if it has been 78% all hour and is the whole story if
 * it was 40% twenty minutes ago. The full history — every metric, every window,
 * per-app — is behind the button in the corner.
 */
export function DeviceLoadCard({ load, trend }: { load: DeviceLoad; trend: LoadTrend }) {
  const memUsed =
    load.memTotalBytes === null || load.memAvailableBytes === null
      ? null
      : load.memTotalBytes - load.memAvailableBytes;
  const diskUsed =
    load.totalBytes === null || load.freeBytes === null ? null : load.totalBytes - load.freeBytes;

  const cpuPercent =
    load.loadAvg1 === null || !load.cpuCount ? null : (load.loadAvg1 / load.cpuCount) * 100;
  const memPercent =
    memUsed === null || !load.memTotalBytes ? null : (memUsed / load.memTotalBytes) * 100;
  const diskPercent =
    diskUsed === null || !load.totalBytes ? null : (diskUsed / load.totalBytes) * 100;

  return (
    <Card>
      {/* The header carries the one control, so the card body stays entirely
          readings — nothing to hunt for among the bars. */}
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Load</CardTitle>
        {/* Negative margins on both axes so a 28px button cannot make this
            header taller than the plain ones beside it — the card titles have
            to sit on one line across the row. */}
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="-my-1 -mr-2 h-7 w-7"
          title="Load history"
        >
          <Link href={`/devices/${load.deviceId}/metrics`} aria-label="Load history">
            <ChartSpline />
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-sm">
        <Meter
          label="CPU"
          // Load average against core count is the honest reading a box can
          // give for free: 1.0 per core means "fully busy", above that means
          // work is queueing.
          detail={
            load.loadAvg1 === null
              ? "not reported"
              : `${load.loadAvg1.toFixed(2)}${load.cpuCount ? ` of ${load.cpuCount} cores` : ""}`
          }
          percent={cpuPercent}
          tone={loadTone(cpuPercent)}
          trend={trend.cpu}
        />
        <Meter
          label="Memory"
          detail={
            memUsed === null || load.memTotalBytes === null
              ? "not reported"
              : `${formatBytes(memUsed)} of ${formatBytes(load.memTotalBytes)}`
          }
          percent={memPercent}
          tone={loadTone(memPercent)}
          trend={trend.memory}
        />
        <Meter
          label="Storage"
          detail={
            diskUsed === null || load.totalBytes === null
              ? formatBytes(load.freeBytes)
              : `${formatBytes(diskUsed)} of ${formatBytes(load.totalBytes)}`
          }
          percent={diskPercent}
          tone={loadTone(diskPercent)}
          trend={trend.storage}
        />

        {load.loadAvg5 !== null || load.loadAvg15 !== null ? (
          // The raw 5/15-minute load averages mean nothing to most people
          // ("15 min 1.64" — of what?). Against the core count they turn into
          // the same percentage the CPU bar above already shows, which is what
          // makes "busy right now" versus "busy all afternoon" readable at a
          // glance.
          <p className="text-xs text-muted-foreground">
            CPU averaged {loadText(load.loadAvg5, load.cpuCount)} over the last 5m and{" "}
            {loadText(load.loadAvg15, load.cpuCount)} over 15m
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A load average as a share of the box's cores, which is how the bars read. */
function loadText(load: number | null, cores: number | null): string {
  if (load === null) return "—";
  if (!cores) return load.toFixed(2);
  return `${Math.round((load / cores) * 100)}%`;
}

/** Fuller is worse for all three of these, which is not true everywhere. */
function loadTone(percent: number | null): MeterTone | undefined {
  if (percent === null) return undefined;
  return percent >= 90 ? "danger" : percent >= 70 ? "primary" : "success";
}
