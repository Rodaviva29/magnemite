"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chart } from "@/lib/metrics-view";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One metric over time, as lines.
 *
 * Deliberately hand-drawn SVG rather than a charting library: the whole
 * dashboard is a handful of components on a fixed token palette, and pulling
 * in a chart runtime to draw six line charts would be the largest dependency
 * in the app.
 *
 * Two rules the drawing keeps:
 *
 *   A null is a gap, never a zero. A box that was offline breaks the line;
 *   bridging it would invent readings, and inventing a flat zero would invent
 *   an idle box.
 *
 *   Colour is identity, never rank. A series' slot is fixed by the caller and
 *   survives filtering, so the colour a reader learned stays true.
 */

const HEIGHT = 176;
const PAD = { top: 12, right: 64, bottom: 22, left: 46 };
/** Widest a tooltip gets, so the flip-at-the-edge maths has something to use. */
const TOOLTIP_WIDTH = 190;
/** Least vertical room between two end-labels before they overprint. */
const MIN_LABEL_GAP = 12;

/** Tailwind cannot see a class it never sees written out, so spell them all. */
const SERIES_STROKE: Record<number, string> = {
  1: "stroke-chart-1",
  2: "stroke-chart-2",
  3: "stroke-chart-3",
  4: "stroke-chart-4",
  5: "stroke-chart-5",
  6: "stroke-chart-6",
  7: "stroke-chart-7",
  8: "stroke-chart-8",
};
const SERIES_FILL: Record<number, string> = {
  1: "fill-chart-1",
  2: "fill-chart-2",
  3: "fill-chart-3",
  4: "fill-chart-4",
  5: "fill-chart-5",
  6: "fill-chart-6",
  7: "fill-chart-7",
  8: "fill-chart-8",
};
const SERIES_BG: Record<number, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
  7: "bg-chart-7",
  8: "bg-chart-8",
};

export function formatValue(value: number | null, unit: Chart["unit"]): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (unit === "bytes") return formatBytes(value);
  if (unit === "celsius") return `${value.toFixed(1)} °C`;
  // A bucket is a mean, so a count of whole things arrives fractional. One
  // decimal below ten keeps "1.5 workers on average" from rounding to a number
  // that was never true.
  if (unit === "count") return value < 10 ? value.toFixed(1) : String(Math.round(value));
  if (unit === "rate") return `${value < 10 ? value.toFixed(2) : Math.round(value)}/s`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

/** Axis ticks on round numbers, which is what makes them readable at a glance. */
function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return ticks;
}

/** Bytes need their own steps: a round number of bytes is a power of two. */
function byteTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const unit = 1024 ** Math.floor(Math.log(max) / Math.log(1024));
  const rough = max / count / unit;
  const step =
    (rough >= 500
      ? 1000
      : rough >= 200
        ? 500
        : rough >= 100
          ? 200
          : rough >= 50
            ? 100
            : rough >= 20
              ? 50
              : rough >= 10
                ? 20
                : rough >= 5
                  ? 10
                  : rough >= 2
                    ? 5
                    : rough >= 1
                      ? 2
                      : 1) * unit;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return ticks;
}

export function TimeSeriesChart({ chart, times }: { chart: Chart; times: number[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // The chart is drawn against a measured width rather than a viewBox stretch,
  // so a 2px stroke stays 2px on a wide screen. Measuring also means nothing
  // renders until after mount, which is what keeps the server and the client
  // from disagreeing about how a timestamp is spelled in the reader's locale.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const maxValue = useMemo(() => {
    if (chart.max !== null) return chart.max;
    let top = 0;
    for (const series of chart.series) {
      for (const point of series.points) {
        if (point !== null && Number.isFinite(point) && point > top) top = point;
      }
    }
    // Headroom, so the peak is not drawn welded to the top edge.
    return top > 0 ? top * 1.1 : 1;
  }, [chart]);

  const ticks = useMemo(
    () => (chart.unit === "bytes" ? byteTicks(maxValue) : niceTicks(maxValue)),
    [chart.unit, maxValue],
  );
  // The top gridline is the top of the plot, so a tick above the data's own
  // maximum does not leave the highest line floating in the middle.
  const axisTop = Math.max(maxValue, ticks[ticks.length - 1] ?? maxValue);

  const x = useCallback(
    (index: number) =>
      times.length <= 1 ? PAD.left : PAD.left + (index / (times.length - 1)) * plotWidth,
    [plotWidth, times.length],
  );
  const y = useCallback(
    (value: number) => PAD.top + plotHeight - (value / axisTop) * plotHeight,
    [axisTop, plotHeight],
  );

  const paths = useMemo(() => {
    if (plotWidth <= 0) return [];
    const baseline = PAD.top + plotHeight;

    return chart.series.map((series) => {
      const lines: string[] = [];
      const areas: string[] = [];
      let run: { x: number; y: number }[] = [];

      // Each unbroken run of readings is its own subpath — and, for the area,
      // its own closed polygon dropped to the baseline at its own two ends.
      // One polygon spanning a gap would close from the far side of the gap
      // back to the start of the chart, painting a wedge under readings that
      // do not exist.
      const flush = () => {
        if (run.length === 0) return;
        const d = run
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
          )
          .join(" ");
        lines.push(d);
        if (run.length > 1) {
          const first = run[0]!;
          const last = run[run.length - 1]!;
          areas.push(
            `${d} L${last.x.toFixed(1)},${baseline.toFixed(1)} L${first.x.toFixed(1)},${baseline.toFixed(1)} Z`,
          );
        }
        run = [];
      };

      series.points.forEach((value, index) => {
        if (value === null || !Number.isFinite(value)) {
          flush();
          return;
        }
        run.push({ x: x(index), y: y(value) });
      });
      flush();

      return { series, d: lines.join(" "), area: areas.join(" ") };
    });
  }, [chart.series, plotHeight, plotWidth, x, y]);

  // The last known point of each series, for the dot and the direct label.
  const endpoints = useMemo(
    () =>
      chart.series.map((series) => {
        for (let index = series.points.length - 1; index >= 0; index -= 1) {
          const value = series.points[index];
          if (value !== null && value !== undefined && Number.isFinite(value)) {
            return { series, index, value };
          }
        }
        return null;
      }),
    [chart.series],
  );

  const hasSeries = chart.series.length > 0;
  // Direct labels supplement the legend up to four series; past that even a
  // spacing pass cannot keep them attached to their lines, and the legend
  // below carries the values instead.
  const showEndLabels = chart.series.length <= 4;

  /**
   * Where each end-label sits, once converging lines are taken into account.
   *
   * Labels are pushed apart just enough to stop them overprinting, and the one
   * that moved gets a leader line back to its dot. Stacking them without the
   * connector detaches a number from its line, which is worse than no label at
   * all — and simply overprinting them, which is what happens with no spacing
   * pass, is worse still.
   */
  const endLabels = useMemo(() => {
    if (!showEndLabels || plotWidth <= 0) return [];
    const placed = endpoints
      .filter((endpoint): endpoint is NonNullable<typeof endpoint> => endpoint !== null)
      .map((endpoint) => ({ endpoint, anchorY: y(endpoint.value), labelY: y(endpoint.value) }))
      .sort((a, b) => a.anchorY - b.anchorY);

    for (let i = 1; i < placed.length; i += 1) {
      const previous = placed[i - 1]!;
      const current = placed[i]!;
      if (current.labelY - previous.labelY < MIN_LABEL_GAP) {
        current.labelY = previous.labelY + MIN_LABEL_GAP;
      }
    }

    // Spreading downwards can push the last one out of the plot; shift the
    // whole set back up rather than clipping it.
    const overflow = Math.max(0, (placed[placed.length - 1]?.labelY ?? 0) - (PAD.top + plotHeight));
    if (overflow > 0) for (const entry of placed) entry.labelY -= overflow;

    return placed;
  }, [endpoints, plotHeight, plotWidth, showEndLabels, y]);

  const xLabels = useMemo(() => {
    if (times.length === 0) return [];
    const span = times[times.length - 1]! - times[0]!;
    // Under two days the interesting difference is the time of day; past that
    // it is the day.
    const format: Intl.DateTimeFormatOptions =
      span > 48 * 60 * 60 * 1000
        ? { day: "2-digit", month: "short" }
        : { hour: "2-digit", minute: "2-digit" };
    const count = Math.min(5, times.length);
    return Array.from({ length: count }, (_, i) => {
      const index = Math.round((i / Math.max(1, count - 1)) * (times.length - 1));
      return { index, label: new Date(times[index]!).toLocaleString(undefined, format) };
    });
  }, [times]);

  const pointerToIndex = (clientX: number) => {
    const element = containerRef.current;
    if (!element || times.length === 0) return null;
    const rect = element.getBoundingClientRect();
    const offset = clientX - rect.left - PAD.left;
    if (plotWidth <= 0) return null;
    const ratio = Math.max(0, Math.min(1, offset / plotWidth));
    return Math.round(ratio * (times.length - 1));
  };

  const hoveredTime = hover === null ? null : times[hover];
  // Flip the tooltip to the left of the crosshair when it would otherwise run
  // off the right edge of the card.
  const tooltipLeft =
    hover === null
      ? 0
      : x(hover) + TOOLTIP_WIDTH + 12 > width
        ? x(hover) - TOOLTIP_WIDTH - 12
        : x(hover) + 12;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: HEIGHT }}
        onPointerMove={(event) => setHover(pointerToIndex(event.clientX))}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && hasSeries ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${chart.title}. ${chart.description}`}
            tabIndex={0}
            onFocus={() => setHover((current) => current ?? times.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setHover((current) => {
                const from = current ?? times.length - 1;
                const next = from + (event.key === "ArrowRight" ? 1 : -1);
                return Math.max(0, Math.min(times.length - 1, next));
              });
            }}
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            {/* Gridlines: solid hairlines one step off the surface. Dashes read
                as a threshold, which these are not. */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {chart.unit === "bytes" ? formatBytes(tick) : Math.round(tick)}
                </text>
              </g>
            ))}

            {xLabels.map(({ index, label }, position) => (
              <text
                key={`${index}-${label}`}
                x={x(index)}
                y={HEIGHT - 6}
                textAnchor={
                  position === 0 ? "start" : position === xLabels.length - 1 ? "end" : "middle"
                }
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {label}
              </text>
            ))}

            {/* A wash under a lone series, so the chart has a body rather than
                a hairline floating in a box. Never under several: overlapping
                washes muddle into a colour neither series owns. */}
            {chart.series.length === 1 && paths[0]?.area ? (
              <path
                d={paths[0].area}
                className={cn(SERIES_FILL[chart.series[0]!.slot] ?? SERIES_FILL[1], "opacity-10")}
                stroke="none"
              />
            ) : null}

            {paths.map(({ series, d }) => (
              <path
                key={series.id}
                d={d}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={SERIES_STROKE[series.slot] ?? SERIES_STROKE[1]}
              />
            ))}

            {hover !== null ? (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                className="stroke-border-emphasis"
                strokeWidth={1}
              />
            ) : null}

            {/* End dots carry a ring in the surface colour so they stay legible
                where two series cross. A stroke around the mark would be
                data-weight ink doing a spacer's job. */}
            {endpoints.map((endpoint) =>
              endpoint ? (
                <circle
                  key={endpoint.series.id}
                  cx={x(endpoint.index)}
                  cy={y(endpoint.value)}
                  r={4}
                  strokeWidth={2}
                  className={cn(SERIES_FILL[endpoint.series.slot] ?? SERIES_FILL[1], "stroke-card")}
                />
              ) : null,
            )}

            {/* Values at the line ends, in text ink rather than the series
                colour — the dot beside them is what carries identity, and the
                lighter slots are illegible as text on a white card. A label
                that had to move to avoid its neighbour gets a leader line, so
                it still reads as belonging to its own line. */}
            {endLabels.map(({ endpoint, anchorY, labelY }) => (
              <g key={`label-${endpoint.series.id}`}>
                {Math.abs(labelY - anchorY) > 1 ? (
                  <polyline
                    points={`${(x(endpoint.index) + 5).toFixed(1)},${anchorY.toFixed(1)} ${(x(endpoint.index) + 8).toFixed(1)},${labelY.toFixed(1)} ${(x(endpoint.index) + 10).toFixed(1)},${labelY.toFixed(1)}`}
                    fill="none"
                    strokeWidth={1}
                    className="stroke-border-emphasis"
                  />
                ) : null}
                <text
                  x={x(endpoint.index) + 12}
                  y={labelY}
                  dominantBaseline="middle"
                  className="fill-foreground text-[10px] tabular-nums"
                >
                  {formatValue(endpoint.value, chart.unit)}
                </text>
              </g>
            ))}

            {hover !== null
              ? chart.series.map((series) => {
                  const value = series.points[hover];
                  if (value === null || value === undefined || !Number.isFinite(value)) return null;
                  return (
                    <circle
                      key={`hover-${series.id}`}
                      cx={x(hover)}
                      cy={y(value)}
                      r={4}
                      strokeWidth={2}
                      className={cn(SERIES_FILL[series.slot] ?? SERIES_FILL[1], "stroke-card")}
                    />
                  );
                })
              : null}
          </svg>
        ) : null}

        {hover !== null && hoveredTime !== undefined && hoveredTime !== null ? (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-lg border border-border bg-popover p-2 shadow-md"
            style={{ left: Math.max(0, tooltipLeft), width: TOOLTIP_WIDTH }}
          >
            <p className="mb-1.5 text-[11px] text-muted-foreground tabular-nums">
              {new Date(hoveredTime).toLocaleString(undefined, {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            <ul className="flex flex-col gap-1">
              {chart.series.map((series) => (
                <li key={series.id} className="flex items-center gap-2 text-xs">
                  {/* A short stroke, not a filled box: at this density a swatch
                      is data-weight ink doing a label's job. */}
                  <span
                    className={cn(
                      "h-0.5 w-3 shrink-0 rounded-full",
                      SERIES_BG[series.slot] ?? SERIES_BG[1],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {series.label}
                  </span>
                  {/* The value leads: the reader already has the series and
                      came for the number. */}
                  <span className="font-medium tabular-nums">
                    {formatValue(series.points[hover] ?? null, chart.unit)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/*
        Legend and summary in one row rather than two.

        Each entry already needs the line-key and the series name to work as a
        legend; carrying the three numbers on the same line makes it the table
        view's stand-in too — which matters because three of the eight palette
        slots sit below 3:1 on the light card, so every one of them has to be
        readable as text somewhere that is not a tooltip.
      */}
      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border pt-3">
        {chart.series.map((series) => (
          <div key={series.id} className="flex items-center gap-2 text-xs">
            <span
              className={cn("h-0.5 w-3 rounded-full", SERIES_BG[series.slot] ?? SERIES_BG[1])}
            />
            <dt className="text-muted-foreground">{series.label}</dt>
            <dd className="tabular-nums">
              {series.stats
                ? `avg ${formatValue(series.stats.avg, chart.unit)} · p95 ${formatValue(
                    series.stats.p95,
                    chart.unit,
                  )} · max ${formatValue(series.stats.max, chart.unit)}`
                : "not reported"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
