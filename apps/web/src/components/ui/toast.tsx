"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Transient results of things somebody just did.
 *
 * The rule for what belongs here: a message about an **action**, which is
 * finished and has nothing left to read — "Rotom now has this box disabled",
 * "Reboot sent". What does *not* belong is feedback about a **form**, which is
 * still on screen and still being corrected; a validation error that flies away
 * on a timer is a validation error somebody has to trigger twice to read. Those
 * stay inline beside their field.
 *
 * Radix rather than a hand-rolled one for the same reason every other primitive
 * in this folder is: the parts nobody remembers to write are the ones it
 * already has — an `aria-live` region that announces without stealing focus,
 * timers that pause while the pointer is over the stack or the window is in the
 * background, swipe to dismiss, and an F8 hotkey onto the list.
 */

export type ToastTone = "info" | "error";

type ToastRecord = { id: number; message: string; tone: ToastTone };

type ToastFn = (message: string, tone?: ToastTone) => void;

const ToastContext = React.createContext<ToastFn | null>(null);

/**
 * How long a message stays up.
 *
 * Long enough to read a sentence twice, because these land in the corner while
 * the eye is still on the button that caused them. Errors do not auto-dismiss
 * at all — an action that failed is one somebody has to decide about, and a
 * message that leaves on its own is a decision made for them.
 */
const DURATION_MS = 6000;

/**
 * The pile, and what it costs.
 *
 * A column of toasts pushes the older ones up the screen and, past three or
 * four, off it. Stacked, the newest is always in the same place — which is
 * where the eye already is, having just clicked something — and the rest are a
 * visible count rather than a queue that scrolled away.
 *
 * `PEEK` is how much of each older card shows above the one in front, `GAP` the
 * space between them once the stack opens. `VISIBLE` is how deep the pile is
 * drawn before the rest fade out behind it; they are still there, and opening
 * the stack shows them.
 */
const PEEK = 12;
const GAP = 10;
const SCALE_STEP = 0.04;
const VISIBLE = 3;

/**
 * Beyond this the oldest is dropped rather than kept behind the pile.
 *
 * A cap rather than none: these are things somebody did, and a person who did
 * eight things is not going to read the first one. Errors are exempt further
 * down — those never auto-dismiss, so they can only leave by being read.
 */
const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const [heights, setHeights] = React.useState<Record<number, number>>({});
  const nextId = React.useRef(0);

  const push = React.useCallback<ToastFn>((message, tone = "info") => {
    const id = nextId.current++;
    setToasts((current) => {
      const next = [...current, { id, message, tone }];
      // Drop from the oldest end, but never an error: it is the one kind that
      // has no timer, so dropping it silently is the only way it could vanish
      // unread.
      while (next.length > MAX_TOASTS) {
        const index = next.findIndex((toast) => toast.tone !== "error");
        if (index === -1) break;
        next.splice(index, 1);
      }
      return next;
    });
  }, []);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    setHeights((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const measure = React.useCallback((id: number, height: number) => {
    setHeights((current) => (current[id] === height ? current : { ...current, [id]: height }));
  }, []);

  // Nothing to hover once the pile is gone; without this the stack would come
  // back already open the next time one arrives.
  React.useEffect(() => {
    if (toasts.length === 0) setExpanded(false);
  }, [toasts.length]);

  /** Front is the newest, at the bottom. Depth counts back from it. */
  const depthOf = (index: number) => toasts.length - 1 - index;
  const heightOf = (index: number) => heights[toasts[index]!.id] ?? 56;

  /**
   * How tall the hover region has to be.
   *
   * It is the whole stack when open, because the gaps between the cards are
   * part of it: a region that only covered the cards themselves would drop the
   * hover every time the pointer crossed a gap, and the stack would flicker
   * shut and open again.
   */
  const stackHeight = React.useMemo(() => {
    if (toasts.length === 0) return 0;
    if (expanded) {
      return toasts.reduce((sum, _, i) => sum + heightOf(i), 0) + (toasts.length - 1) * GAP;
    }
    return heightOf(toasts.length - 1) + Math.min(toasts.length - 1, VISIBLE - 1) * PEEK;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts, heights, expanded]);

  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="right" duration={DURATION_MS}>
        {children}

        <ToastPrimitive.Viewport
          // Radix pauses every timer while this is hovered or focused, so
          // opening the stack to read it also stops it timing out underneath.
          onPointerEnter={() => setExpanded(true)}
          onPointerLeave={() => setExpanded(false)}
          onFocusCapture={() => setExpanded(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setExpanded(false);
            }
          }}
          style={{ height: stackHeight }}
          className={cn(
            "fixed bottom-4 right-4 z-100 w-[calc(100%-2rem)] max-w-sm list-none outline-none",
            "transition-[height] duration-200 ease-out",
            // Nothing to hit when the pile is empty; the corner of the screen
            // has to keep working.
            toasts.length === 0 && "pointer-events-none",
          )}
        >
          {toasts.map((toast, index) => {
            const depth = depthOf(index);
            const inFront = toasts
              .slice(index + 1)
              .reduce((sum, _, offset) => sum + heightOf(index + 1 + offset) + GAP, 0);

            return (
              <ToastPrimitive.Root
                key={toast.id}
                duration={toast.tone === "error" ? Infinity : DURATION_MS}
                onOpenChange={(open) => {
                  if (!open) dismiss(toast.id);
                }}
                style={{ zIndex: toasts.length - depth }}
                className={cn(
                  "absolute bottom-0 right-0 w-full",
                  // The swipe transform is Radix's and lands on this element;
                  // the stacking transform is ours and lands on the card
                  // inside, so the two never overwrite each other.
                  "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none",
                  "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform",
                  "data-[swipe=end]:translate-x-[120%] data-[swipe=end]:transition-transform",
                )}
              >
                <Card
                  toast={toast}
                  depth={depth}
                  expanded={expanded}
                  offset={inFront}
                  onMeasure={measure}
                />
              </ToastPrimitive.Root>
            );
          })}
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

function Card({
  toast,
  depth,
  expanded,
  offset,
  onMeasure,
}: {
  toast: ToastRecord;
  /** 0 is the newest, at the front of the pile. */
  depth: number;
  expanded: boolean;
  /** Total height of everything in front of it, for the open stack. */
  offset: number;
  onMeasure: (id: number, height: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  // One frame at the entry position before the transition runs, or there is
  // nothing to transition from and the card appears already in place.
  const [entered, setEntered] = React.useState(false);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Measured rather than assumed: a two-line message is half again as tall as
    // a one-line one, and the open stack spaces cards by what they actually are.
    const report = () => onMeasure(toast.id, element.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);

    const frame = requestAnimationFrame(() => setEntered(true));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [toast.id, onMeasure]);

  const y = expanded ? -offset : -(depth * PEEK);
  const scale = expanded ? 1 : 1 - depth * SCALE_STEP;

  return (
    <div
      ref={ref}
      style={{
        transform: entered ? `translate3d(0, ${y}px, 0) scale(${scale})` : "translate3d(0, 8px, 0)",
        // Deep in a closed pile a card is a visible edge, not a message. Opening
        // the stack is what brings it back.
        opacity: entered ? (expanded || depth < VISIBLE ? 1 : 0) : 0,
      }}
      className={cn(
        "flex origin-bottom items-start gap-3 rounded-lg border bg-background px-3.5 py-3 shadow-lg",
        "transition-[transform,opacity] duration-200 ease-out",
        toast.tone === "error" ? "border-destructive/40" : "border-border",
      )}
    >
      {toast.tone === "error" ? (
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
      )}
      <ToastPrimitive.Description className="text-sm leading-snug">
        {toast.message}
      </ToastPrimitive.Description>
      <ToastPrimitive.Close
        aria-label="Dismiss"
        className="-mr-1 ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </ToastPrimitive.Close>
    </div>
  );
}

/**
 * Never throws when there is no provider: a component that toasts is not a
 * component that should stop rendering because it was mounted somewhere the
 * viewport is not. It drops the message instead.
 */
export function useToast(): ToastFn {
  const push = React.useContext(ToastContext);
  return React.useMemo<ToastFn>(() => push ?? (() => {}), [push]);
}
