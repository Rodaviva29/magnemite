"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/format";

/**
 * The age of the last check-in, ticking.
 *
 * The page itself is server-rendered, so its copy of "now" is frozen at the
 * moment of the render — the seconds counter would sit still until something
 * refreshed the route. When you are watching a box come back, a counter that
 * does not move is worse than no counter, so this one runs on its own clock.
 */
export function DeviceLastSeen({
  lastSeenAt,
  online,
}: {
  lastSeenAt: string | null;
  online: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastSeenAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastSeenAt]);

  if (!lastSeenAt) return <>never</>;

  const then = new Date(lastSeenAt);
  const seconds = Math.max(0, Math.round((now - then.getTime()) / 1000));

  // The relative label rounds hard — "2m ago" covers anything from 61 to 119
  // seconds — and when you are watching a box come back the exact age is the
  // whole point.
  return (
    // The server and the browser read their own clocks, so the first paint can
    // differ by a second; the interval corrects it either way.
    <span suppressHydrationWarning>
      {online ? "now" : formatRelative(then)} ({seconds}s)
    </span>
  );
}
