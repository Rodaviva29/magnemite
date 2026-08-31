"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A relative timestamp that survives hydration.
 *
 * `formatRelative` reads the clock, and the server and the browser read it at
 * different moments. A row rendered "19s ago" on the server is "18s ago" by
 * the time React hydrates it, and React treats a text difference as a real
 * mismatch and throws the whole tree away to re-render it.
 *
 * The difference is a second, and the next render corrects it, so the warning
 * is the only actual problem — hence marking the text as expected to differ
 * rather than freezing the clock or rendering nothing until mount. The same
 * reasoning is why {@link DeviceLastSeen} does it, and this is that one line
 * in the twelve other places that need it.
 */
export function RelativeTime({
  value,
  fallback = "never",
  className,
  live = false,
}: {
  value: string | Date | null | undefined;
  /** Shown when there is no timestamp at all. */
  fallback?: string;
  className?: string;
  /**
   * Count up on its own rather than waiting for the next render.
   *
   * Opt-in, because most of the twelve places this appears are rows in a table
   * that re-renders on its own anyway, and a timer each would be a timer per
   * row. It is worth it where the number is the point and the thing that
   * refreshes it is slow: "last seen by Rotom" against a sync a minute wide sat
   * at `12s ago` and then jumped to `1m ago`, which reads as a stall rather
   * than as nobody having asked yet.
   */
  live?: boolean;
}) {
  const label = useLiveLabel(value, fallback, live);

  return (
    <span suppressHydrationWarning className={cn(className)}>
      {label}
    </span>
  );
}

/**
 * The label, re-read once a second while `live`.
 *
 * A second even for a timestamp hours old, because the check is cheap and the
 * alternative is a schedule that has to know when the next boundary falls.
 * What is not cheap is re-rendering, so the state is only written when the
 * *text* changes: `formatRelative` is coarse — seconds, then minutes, then
 * hours — so an hour-old timestamp settles into one setState a minute, and a
 * day-old one into one an hour. React bails out on an identical value, so the
 * rest cost a string compare.
 *
 * Without `live` the ticked value is never read and the effect never sets it,
 * so the twelve places that do not ask for this render exactly what they did
 * before: one string, no state, no timer.
 */
function useLiveLabel(
  value: string | Date | null | undefined,
  fallback: string,
  live: boolean,
): string {
  const direct = value ? formatRelative(value) : fallback;
  const [ticked, setTicked] = useState(direct);

  useEffect(() => {
    if (!live) return;

    const read = () => (value ? formatRelative(value) : fallback);
    // Once immediately, because the state was seeded during a render that may
    // have happened on the server, a second or more ago.
    setTicked(read());
    const id = setInterval(() => setTicked(read()), 1000);
    return () => clearInterval(id);
  }, [value, fallback, live]);

  return live ? ticked : direct;
}
