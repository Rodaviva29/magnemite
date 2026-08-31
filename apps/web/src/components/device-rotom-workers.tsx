import { CircleCheck, CircleX } from "lucide-react";
import type { RotomWorkerView } from "@/lib/hub";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RelativeTime } from "@/components/relative-time";

/**
 * The workers behind a box's numbers.
 *
 * Rendered from what the page already loaded, with no fetching of its own. The
 * hub keeps the last fleet sync's worker rows in memory and hands them over;
 * the sync had them anyway, since it asks for `include_workers=true` to compute
 * the request rate on the card beside this.
 *
 * It used to read them live, one box at a time, whenever the page re-rendered.
 * That was a call to Rotom driven by a page being open — and this page
 * re-renders on the fleet's own event feed, so during a rollout it was up to
 * one call a second over events about other boxes entirely. Rotom's own
 * dashboard never had that problem because it never had the second read: it
 * polls once and every view selects out of the same response.
 *
 * The cost is that the table is as of the last sync rather than as of now,
 * which the header says out loud instead of claiming to be live.
 */
export function DeviceRotomWorkers({
  workers,
  readAt,
  error,
  className,
}: {
  workers: RotomWorkerView[];
  /** When the sync that saw these ran. Null means it has not reached the box. */
  readAt: number | null;
  /** Set when the hub could not be reached at all. */
  error?: string | null;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Workers</CardTitle>
        <span className="text-xs text-muted-foreground">
          {readAt === null ? (
            "no reading yet"
          ) : (
            // Ticking, because the whole point of the label is how old this is.
            <>
              as of <RelativeTime value={new Date(readAt).toISOString()} live />
            </>
          )}
        </span>
      </CardHeader>

      <CardContent className="pt-0">
        <Body workers={workers} readAt={readAt} error={error} />
      </CardContent>
    </Card>
  );
}

function Body({
  workers,
  readAt,
  error,
}: {
  workers: RotomWorkerView[];
  readAt: number | null;
  error?: string | null;
}) {
  if (error) {
    return (
      <p className="py-6 text-sm leading-relaxed text-muted-foreground">
        Could not read the workers: {error}
      </p>
    );
  }
  if (readAt === null) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Nothing read yet — the next Rotom sync fills this in.
      </p>
    );
  }
  if (workers.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">Rotom has no workers on this box.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          {/* No Platform column: it is a protobuf enum whose zero value is
              UNSET, and a MITM that does not fill the field in its welcome —
              Cosmog, for one — reads as UNSET on every worker forever. A column
              that says the same nothing on every row is a column that costs
              width. The controller's id and user agent take its place: which
              thing is driving this worker, and which build of it. */}
          <tr className="border-b text-left">
            <th className="py-2 pr-6 font-normal">Worker</th>
            <th className="py-2 pr-6 font-normal">Version</th>
            <th className="py-2 pr-6 font-normal">In use</th>
            <th className="py-2 pr-6 text-right font-normal">req/s 1m</th>
            <th className="py-2 pr-6 text-right font-normal">req/s 5m</th>
            <th className="py-2 pr-6 text-right font-normal">avg ms</th>
            <th className="py-2 pr-6 font-normal">Controller</th>
            <th className="py-2 pr-6 font-normal">User agent</th>
            <th className="py-2 font-normal">Account</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => {
            const stats = worker.time_windowed_stats;
            const controller = worker.session?.controller;
            return (
              <tr key={worker.id} className="border-b border-border/50 last:border-0">
                <td className="py-3 pr-6 font-mono text-xs">{worker.id}</td>
                <td className="py-3 pr-6">{worker.version_name ?? "—"}</td>
                <td className="py-3 pr-6">
                  {/* The same tick and cross the flags on the card beside this
                      use, so one glance down the column counts the allocated
                      workers. The word stays for a screen reader, which cannot
                      see either mark. */}
                  {worker.is_in_use ? (
                    <CircleCheck className="h-4 w-4 text-success" aria-hidden="true" />
                  ) : (
                    <CircleX className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="sr-only">{worker.is_in_use ? "yes" : "no"}</span>
                </td>
                {/* tabular-nums here and not on the tiles: these are columns
                    that have to line up. */}
                <td className="py-3 pr-6 text-right tabular-nums">
                  {rate(stats?.requests_rate_over_1_min)}
                </td>
                <td className="py-3 pr-6 text-right tabular-nums">
                  {rate(stats?.requests_rate_over_5_min)}
                </td>
                <td className="py-3 pr-6 text-right tabular-nums">
                  {typeof stats?.request_ms_avg_over_5_min === "number"
                    ? Math.round(stats.request_ms_avg_over_5_min)
                    : "—"}
                </td>
                {/* All three are the controller's, and empty on a worker Rotom
                    is holding open with nothing allocated to it. */}
                <td className="py-3 pr-6 font-mono text-xs">{controller?.id ?? "—"}</td>
                <td className="py-3 pr-6 font-mono text-xs">{controller?.user_agent ?? "—"}</td>
                <td className="py-3">
                  {controller?.account_username
                    ? `${controller.account_username}${
                        controller.account_source ? ` (${controller.account_source})` : ""
                      }`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A dash for a rate Rotom did not report, never a zero it never sent. */
function rate(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "—";
}
