import { cn } from "@/lib/utils";

/**
 * The last hour of a yes/no, at thumbnail size.
 *
 * A sparkline is the wrong form for a boolean — a line between 0 and 1 is a
 * square wave, and the eye reads its *slope*, which means nothing here. What
 * matters is when it was true and for how long, so it is drawn as a band: the
 * run lengths are the information.
 *
 * A null is a gap and not a `false`. "Nobody asked Rotom in that window" and
 * "Rotom said no" are different answers, and painting the first as the second
 * is the same mistake as reading an unknown signal as a fault.
 *
 * Runs are merged into one rect each, so an hour of one state is one node
 * rather than forty, and the band has no seams inside a run.
 */
export function StateStrip({
  values,
  className,
  width = 72,
  height = 10,
}: {
  values: (boolean | null)[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;

  const slot = width / values.length;
  const runs: { start: number; length: number; value: boolean }[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    const last = runs[runs.length - 1];
    if (last && last.value === value && last.start + last.length === index) {
      last.length += 1;
      return;
    }
    runs.push({ start: index, length: 1, value });
  });

  if (runs.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      role="img"
      aria-hidden="true"
    >
      {/* The track is what makes a gap legible as a gap rather than as the edge
          of the card. */}
      <rect x={0} y={0} width={width} height={height} rx={2} className="fill-muted/40" />
      {runs.map((run) => (
        <rect
          key={run.start}
          x={run.start * slot}
          y={0}
          width={Math.max(run.length * slot, 1)}
          height={height}
          rx={2}
          className={run.value ? "fill-success/70" : "fill-destructive/60"}
        />
      ))}
    </svg>
  );
}
