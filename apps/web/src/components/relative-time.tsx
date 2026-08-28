"use client";

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
}: {
  value: string | Date | null | undefined;
  /** Shown when there is no timestamp at all. */
  fallback?: string;
  className?: string;
}) {
  return (
    <span suppressHydrationWarning className={cn(className)}>
      {value ? formatRelative(value) : fallback}
    </span>
  );
}
