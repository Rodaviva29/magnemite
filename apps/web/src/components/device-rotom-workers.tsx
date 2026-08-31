"use client";

import { useEffect, useState, useTransition } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import type { RotomWorkerView } from "@/lib/hub";
import { rotomWorkers } from "@/actions/devices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The workers behind a box's numbers, read live from Rotom and kept nowhere.
 *
 * The counts on the card beside this one are stored, so they render whether or
 * not Rotom is up and a rule can act on them. This is the breakdown, and a
 * table re-synced every minute for a page nobody has open would cost a write
 * per worker per minute forever — so it is fetched when somebody looks, and
 * that is also why it is the one Rotom view that can fail on its own.
 *
 * It has no refresh of its own. `syncToken` changes on every render of the
 * page, so the page's one Refresh — which re-asks Rotom and re-renders — is
 * what re-reads this too. Two refresh buttons a card apart, one of which
 * updated half the screen, is how a page starts lying about how fresh it is.
 */
export function DeviceRotomWorkers({
  deviceId,
  syncToken,
  className,
}: {
  deviceId: string;
  syncToken: number;
  className?: string;
}) {
  const [workers, setWorkers] = useState<RotomWorkerView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await rotomWorkers(deviceId);
      if ("error" in result) {
        setError(result.error);
        setWorkers(null);
        return;
      }
      setError(null);
      setWorkers(result.workers);
    });
  }, [deviceId, syncToken]);

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-sm">Workers</CardTitle>
        <span className="text-xs text-muted-foreground">
          {pending ? "reading…" : "live from Rotom"}
        </span>
      </CardHeader>

      <CardContent className="pt-0">
        <Body workers={workers} error={error} pending={pending} />
      </CardContent>
    </Card>
  );
}

function Body({
  workers,
  error,
  pending,
}: {
  workers: RotomWorkerView[] | null;
  error: string | null;
  pending: boolean;
}) {
  if (error) {
    return (
      <p className="py-6 text-sm leading-relaxed text-muted-foreground">
        Could not read the workers: {error}
      </p>
    );
  }
  if (workers === null) {
    return (
      <p className="py-6 text-sm text-muted-foreground">{pending ? "Reading from Rotom…" : "—"}</p>
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
                <td className="py-3 pr-6">{controller?.user_agent ?? "—"}</td>
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
