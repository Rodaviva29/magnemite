import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { Sparkline } from "@/components/charts/sparkline";

export type MeterTone = "success" | "primary" | "danger" | "muted";

/**
 * A labelled bar with the reading beside it and the last hour underneath.
 *
 * `percent` is null when nobody reported it, and that reads as "not reported"
 * rather than as a bar sitting at zero — the same distinction the metrics and
 * the Rotom signals both turn on.
 *
 * The tone is the caller's, not a threshold baked in here, because full does
 * not always mean bad: 95% of a box's memory is a problem and 95% of its
 * workers allocated is the point of the box.
 */
export function Meter({
  label,
  detail,
  value,
  percent,
  tone,
  trend,
}: {
  label: string;
  detail: string;
  /** The reading beside the label. Defaults to the percentage itself. */
  value?: ReactNode;
  percent: number | null;
  tone?: MeterTone;
  trend: (number | null)[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right font-medium tabular-nums">
          {value ?? (percent === null ? "—" : `${Math.round(percent)}%`)}
        </span>
      </div>
      {percent === null ? (
        <Progress value={0} tone="muted" />
      ) : (
        <Progress value={percent} tone={tone ?? "primary"} />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
        <Sparkline values={trend} />
      </div>
    </div>
  );
}
