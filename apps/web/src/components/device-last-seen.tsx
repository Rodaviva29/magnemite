"use client";

import { useEffect, useState } from "react";
import { formatDuration, formatRelative } from "@/lib/format";

/**
 * Whether the box is here, and if not, roughly how long it has been gone.
 *
 * Presence only — the exact age of the last check-in is {@link DeviceHeartbeat}
 * right below it. Cramming both into one line ("now (6s)") read as a
 * contradiction: it is either now or it is six seconds ago.
 */
export function DeviceLastSeen({
  lastSeenAt,
  online,
}: {
  lastSeenAt: string | null;
  online: boolean;
}) {
  if (!lastSeenAt) return <>never</>;
  if (online) return <>now</>;
  // Rendered on the server, so this reads the server's clock; the label rounds
  // to the minute anyway, which is all the precision an absent box needs.
  return <span suppressHydrationWarning>{formatRelative(new Date(lastSeenAt))}</span>;
}

/**
 * The age of the last heartbeat, ticking.
 *
 * The page itself is server-rendered, so its copy of "now" is frozen at the
 * moment of the render — the counter would sit still until something refreshed
 * the route. When you are watching a box come back, a counter that does not
 * move is worse than no counter, so this one runs on its own clock.
 *
 * The exact age, not the rounded label: a box that beats every 20 seconds is
 * either on schedule or it is not, and "2m ago" covers anything from 61 to 119
 * seconds.
 */
export function DeviceHeartbeat({ lastSeenAt }: { lastSeenAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastSeenAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastSeenAt]);

  if (!lastSeenAt) return <>never</>;

  return (
    // The server and the browser read their own clocks, so the first paint can
    // differ by a second; the interval corrects it either way.
    <span suppressHydrationWarning>{formatDuration(new Date(lastSeenAt), new Date(now))} ago</span>
  );
}
