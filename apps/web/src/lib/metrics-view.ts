/**
 * The shape the metric charts are drawn from, and the windows they can be
 * drawn over.
 *
 * Split out of `metrics.ts` so the client components can import it: that
 * module reaches into Prisma, and a single value imported from it would drag
 * the database client — and `node:crypto` with it — into the browser bundle.
 * Types alone would be erased; `RANGES` would not.
 */

/** Most series a chart can carry — the chart palette has eight slots. */
export const MAX_SERIES = 8;

export type RangeKey = "1h" | "6h" | "24h" | "7d" | "30d";

export const RANGES: { key: RangeKey; label: string; hours: number }[] = [
  { key: "1h", label: "Last hour", hours: 1 },
  { key: "6h", label: "Last 6 hours", hours: 6 },
  { key: "24h", label: "Last 24 hours", hours: 24 },
  { key: "7d", label: "Last 7 days", hours: 24 * 7 },
  { key: "30d", label: "Last 30 days", hours: 24 * 30 },
];

export const DEFAULT_RANGE: RangeKey = "24h";

export type SeriesStats = {
  avg: number;
  min: number;
  max: number;
  /** The spike that a mean hides — which is usually the thing being looked for. */
  p95: number;
  last: number | null;
  /** Buckets with no sample at all: the box was offline, or the app was not running. */
  gaps: number;
};

export type Series = {
  id: string;
  label: string;
  /**
   * Palette slot, 1-8. Tied to the entity — a package keeps its colour when
   * another one is filtered out, so a reader who learned "the scanner is blue"
   * stays right.
   */
  slot: number;
  /** Aligned to the shared `times` array; null is a gap, not a zero. */
  points: (number | null)[];
  stats: SeriesStats | null;
};

export type Chart = {
  id: string;
  title: string;
  description: string;
  unit: "percent" | "celsius" | "bytes" | "count" | "rate" | "ms";
  /** Fixed top of the y axis, where the metric has one. Null lets it grow. */
  max: number | null;
  series: Series[];
};

export type MetricsView = {
  /** Bucket start times, epoch ms. One x axis, shared by every chart. */
  times: number[];
  bucketMs: number;
  from: number;
  to: number;
  charts: Chart[];
  /** Every package with data in the window, in the order that fixes its colour. */
  packages: string[];
  selected: string[];
  sampleCount: number;
  /** True when the row cap trimmed the oldest part of the window. */
  truncated: boolean;
  retentionDays: number;
  sampleSeconds: number;
};

export function parseRange(value: string | undefined): RangeKey {
  return RANGES.some((r) => r.key === value) ? (value as RangeKey) : DEFAULT_RANGE;
}
