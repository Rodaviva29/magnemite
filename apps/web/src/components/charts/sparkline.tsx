import { cn } from "@/lib/utils";

/**
 * The last hour of a metric, at thumbnail size.
 *
 * Context for the number beside it, not a chart in its own right: no axes, no
 * labels, no hover. Drawn in the muted ink rather than a series colour,
 * because the meter next to it is already carrying the severity — two things
 * shouting the same thing is how a card stops being readable at a glance.
 *
 * A null is a gap, not a zero: a box that was offline for ten minutes should
 * show a break in the line, not a dive to the floor.
 */
export function Sparkline({
  values,
  className,
  width = 72,
  height = 20,
}: {
  values: (number | null)[];
  className?: string;
  width?: number;
  height?: number;
}) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  // Two points is the minimum that can show a direction. One is a dot that
  // says nothing, so it renders as nothing.
  if (known.length < 2) return null;

  const min = Math.min(...known);
  const max = Math.max(...known);
  // A flat line has no range to scale against; centre it rather than dividing
  // by zero.
  const span = max - min || 1;
  const pad = 1.5; // room for the 1.5px stroke and the end dot's radius

  const x = (index: number) =>
    values.length === 1 ? width / 2 : (index / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);

  // One path per run of known values, so a gap breaks the line instead of
  // being bridged by a straight segment the box never reported.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`,
    );
  });
  if (current.length > 1) segments.push(current.join(" "));

  let lastIndex = -1;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      lastIndex = index;
      break;
    }
  }
  const lastValue = lastIndex >= 0 ? (values[lastIndex] as number) : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      {segments.map((d, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-foreground/70"
        />
      ))}
      {lastValue !== null ? (
        <circle cx={x(lastIndex)} cy={y(lastValue)} r={2} className="fill-foreground" />
      ) : null}
    </svg>
  );
}
