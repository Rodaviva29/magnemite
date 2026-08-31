import "server-only";

import { getHubSettings, getMonitorSettings, prisma } from "@magnemite/db";
import { RANGES, type Chart, type RangeKey } from "./metrics-view";
import { bucketOf, buildSeries } from "./metrics";

/**
 * The last hour of what Rotom said about one box.
 *
 * The same shape and the same window as `loadRecentTrend`, deliberately: the
 * two sit on the same page and a reader should not have to learn that one of
 * them means something different by "the last hour".
 *
 * Nulls are gaps. A stretch where nobody asked Rotom — the hub was down, the
 * integration was off — is not a stretch where the answer was no.
 */
export type RotomTrend = {
  /** Share of attached workers that were allocated, 0-100. */
  workersInUse: (number | null)[];
  requestRate: (number | null)[];
  requestMs: (number | null)[];
  connected: (boolean | null)[];
  enabled: (boolean | null)[];
  canBeUsed: (boolean | null)[];
  inUse: (boolean | null)[];
};

export const EMPTY_ROTOM_TREND: RotomTrend = {
  workersInUse: [],
  requestRate: [],
  requestMs: [],
  connected: [],
  enabled: [],
  canBeUsed: [],
  inUse: [],
};

export async function loadRotomTrend(deviceId: string, points = 40): Promise<RotomTrend> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await prisma.rotomSample.findMany({
    where: { deviceId, at: { gte: since } },
    orderBy: { at: "desc" },
    take: 400,
    select: {
      connected: true,
      enabled: true,
      canBeUsed: true,
      inUse: true,
      workerCount: true,
      workersInUse: true,
      requestRate: true,
      requestMs: true,
    },
  });
  if (rows.length === 0) return EMPTY_ROTOM_TREND;

  const ordered = [...rows].reverse();
  // Evenly spaced rather than the newest N, so the strip spans the whole hour
  // whatever the sync interval is set to — the same rule the load sparklines
  // follow.
  const step = Math.max(1, Math.ceil(ordered.length / points));
  const taken = ordered.filter((_, index) => index % step === 0);

  return {
    workersInUse: taken.map((row) =>
      // Not `0` when Rotom did not say how many are attached: a share of an
      // unknown total is unknown, and a zero there would draw a floor the box
      // never reported.
      row.workersInUse === null || !row.workerCount
        ? null
        : (row.workersInUse / row.workerCount) * 100,
    ),
    requestRate: taken.map((row) => row.requestRate),
    requestMs: taken.map((row) => row.requestMs),
    connected: taken.map((row) => row.connected),
    enabled: taken.map((row) => row.enabled),
    canBeUsed: taken.map((row) => row.canBeUsed),
    inUse: taken.map((row) => row.inUse),
  };
}

// ---------------------------------------------------------------------------
// The full history, over a chosen window
// ---------------------------------------------------------------------------

/**
 * The same bucketing the metric charts use, over the Rotom samples.
 *
 * Deliberately the same shape — `Chart` and `Series` — so the charts, the
 * table view, the tooltip and the legend are the ones already written rather
 * than a second set that would drift from them.
 */
export type RotomMetricsView = {
  times: number[];
  bucketMs: number;
  charts: Chart[];
  sampleCount: number;
  truncated: boolean;
  retentionDays: number;
  /**
   * How often a reading is *kept* — the metric sample interval, not the Rotom
   * sync, which runs far more often than a row is written. This is the finest
   * a bucket can usefully be.
   */
  sampleSeconds: number;
};

/** Same cap and target as the metric charts, and for the same reasons. */
const TARGET_BUCKETS = 220;
const MAX_ROWS = 40_000;

export const EMPTY_ROTOM_METRICS: RotomMetricsView = {
  times: [],
  bucketMs: 60_000,
  charts: [],
  sampleCount: 0,
  truncated: false,
  retentionDays: 0,
  sampleSeconds: 60,
};

export async function loadRotomMetrics(
  deviceId: string,
  range: RangeKey,
): Promise<RotomMetricsView> {
  const [hub, monitor] = await Promise.all([getHubSettings(), getMonitorSettings()]);
  const window = RANGES.find((entry) => entry.key === range) ?? RANGES[2]!;

  const to = Date.now();
  const from = to - window.hours * 60 * 60 * 1000;

  // Newest-first with a cap, then reversed: when the cap bites it should cost
  // the oldest end of the window rather than the part being looked at.
  const rowsDesc = await prisma.rotomSample.findMany({
    where: { deviceId, at: { gte: new Date(from) } },
    orderBy: { at: "desc" },
    take: MAX_ROWS,
    select: {
      at: true,
      connected: true,
      enabled: true,
      canBeUsed: true,
      inUse: true,
      workerCount: true,
      workersInUse: true,
      requestRate: true,
      requestMs: true,
    },
  });
  const rows = [...rowsDesc].reverse();

  const span = to - from;
  // Never finer than the grid the rows were written on — which is the metric
  // sample interval, not the Rotom sync: the sync runs far more often than a
  // row is kept. Buckets narrower than the data are single points with gaps
  // between them, which reads as a broken chart.
  const writeEverySeconds = Math.max(hub.rotomSampleSeconds, monitor.rotomSyncSeconds, 1);
  const bucketMs = Math.max(writeEverySeconds * 1000, Math.ceil(span / TARGET_BUCKETS));
  const bucketCount = Math.max(1, Math.ceil(span / bucketMs));
  const times = Array.from({ length: bucketCount }, (_, i) => from + i * bucketMs);

  const pick = (value: (row: (typeof rows)[number]) => number | null) =>
    rows.map((row) => ({
      bucket: bucketOf(row.at, from, bucketMs, bucketCount),
      value: value(row),
    }));

  // A boolean averaged over a bucket is the share of that bucket it was true
  // for, which is exactly what an availability chart wants — and it is why
  // these can ride the same series builder as everything else.
  const share = (value: (row: (typeof rows)[number]) => boolean) =>
    pick((row) => (value(row) ? 100 : 0));

  const charts: Chart[] = [
    {
      id: "rotom-workers",
      title: "Workers",
      description:
        "How many workers Rotom had attached to the box, and how many of them it was actually using.",
      unit: "count",
      max: null,
      series: [
        buildSeries(
          "workers-in-use",
          "In use",
          1,
          bucketCount,
          pick((row) => row.workersInUse),
        ),
        buildSeries(
          "workers-attached",
          "Attached",
          2,
          bucketCount,
          pick((row) => row.workerCount),
        ),
      ],
    },
    {
      id: "rotom-availability",
      title: "Availability",
      description:
        "Share of each interval Rotom answered yes to each of its four flags. Lines sitting on top of each other is them agreeing; a dip in one is the interesting case.",
      unit: "percent",
      // The four are shares of an interval, so they cannot exceed 100 and a
      // free axis would only ever make a flat 100% look like noise.
      max: 100,
      series: [
        buildSeries(
          "connected",
          "Connected",
          4,
          bucketCount,
          share((row) => row.connected),
        ),
        buildSeries(
          "enabled",
          "Enabled",
          5,
          bucketCount,
          share((row) => row.enabled),
        ),
        buildSeries(
          "can-be-used",
          "Can be used",
          6,
          bucketCount,
          share((row) => row.canBeUsed),
        ),
        buildSeries(
          "in-use",
          "In use",
          7,
          bucketCount,
          share((row) => row.inUse),
        ),
      ],
    },
    // The two request charts sit on the second row on purpose. Both are empty
    // on a Rotom that does not measure rates, and both are about how well the
    // box is working rather than whether it is — which is the question the two
    // above answer, and the one somebody opening this page has first.
    {
      id: "rotom-requests",
      title: "Request rate",
      description:
        "Requests per second across the box's workers, as Rotom counts them over its own five-minute window. Empty where Rotom does not measure rates.",
      unit: "rate",
      max: null,
      series: [
        buildSeries(
          "request-rate",
          "Requests",
          3,
          bucketCount,
          pick((row) => row.requestRate),
        ),
      ],
    },
    {
      id: "rotom-latency",
      title: "Request duration",
      description:
        "What Rotom's requests through this box averaged. Empty where there were no requests to average, which is not the same as fast.",
      unit: "ms",
      max: null,
      series: [
        buildSeries(
          "request-ms",
          "Average",
          8,
          bucketCount,
          pick((row) => row.requestMs),
        ),
      ],
    },
  ];

  return {
    times,
    bucketMs,
    charts,
    sampleCount: rows.length,
    truncated: rowsDesc.length >= MAX_ROWS,
    retentionDays: hub.rotomRetentionDays,
    sampleSeconds: writeEverySeconds,
  };
}
