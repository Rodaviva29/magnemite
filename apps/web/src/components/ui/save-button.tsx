"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import type { ActionState } from "@/actions/rollouts";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** How long "Saved" holds before the button offers itself again. */
const SAVED_MS = 2000;

/**
 * A submit button that reports its own outcome.
 *
 * The settings forms used to answer a save with the word "Saved." next to the
 * button, which is the one place nobody is looking — the cursor is on the
 * button, and a line of text appearing beside it is easy to miss entirely. So
 * the button carries the whole cycle instead: it spins while the action is in
 * flight, turns green with a tick when it lands, and goes back to offering a
 * save a couple of seconds later. Failures are still text, because an error
 * has something to say that a button cannot fit.
 */
export function SaveButton({
  state,
  size,
  className,
  children = "Save",
}: {
  /** The action's result, so a failed save does not flash a tick. */
  state: ActionState;
  size?: ButtonProps["size"];
  className?: string;
  children?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  const [saved, setSaved] = useState(false);
  // Something has to have been submitted for a settled action to mean
  // anything: without this, the first render reads as a save that just landed.
  const submitted = useRef(false);

  useEffect(() => {
    if (pending) {
      submitted.current = true;
      setSaved(false);
      return;
    }
    if (!submitted.current) return;
    submitted.current = false;
    if (state.error) return;

    setSaved(true);
    const timer = setTimeout(() => setSaved(false), SAVED_MS);
    return () => clearTimeout(timer);
  }, [pending, state]);

  return (
    <Button
      type="submit"
      size={size}
      disabled={pending}
      aria-live="polite"
      className={cn(
        // The three labels are different lengths, and a button that resizes
        // under the cursor is the kind of thing that makes a click miss.
        "min-w-[6.5rem] transition-colors",
        saved &&
          "save-pop bg-success/15 text-success shadow-none ring-1 ring-inset ring-success/30 hover:bg-success/15",
        className,
      )}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          Saving…
        </>
      ) : saved ? (
        <>
          <Check className="save-check" />
          Saved
        </>
      ) : (
        children
      )}
    </Button>
  );
}
