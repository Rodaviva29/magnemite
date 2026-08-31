"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncRotom } from "@/actions/devices";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Ask Rotom now, and say what came back.
 *
 * The counts are the point, not the freshness: "12 devices, 0 matched" is a
 * naming problem and "0 devices" is a connectivity one, and telling those apart
 * otherwise means reading hub logs.
 *
 * `router.refresh()` afterwards is what makes it a refresh rather than a poke —
 * the sync writes rows, and every Rotom field on screen is a server render of
 * those rows. Anything reading a live value off Rotom re-reads too, because the
 * re-render hands it a new token.
 *
 * Fleet-wide, not one box: the endpoint behind it is `GET /api/device`, which
 * answers for everything Rotom has. That is one HTTP round trip whatever the
 * fleet size, so pressing it costs the same as one tick of the periodic sync.
 *
 * `type="button"` because it has lived inside a form before and would live
 * inside one again: a default submit would save whatever form it is standing in
 * as a side effect of a diagnostic.
 */
export function RotomSyncButton({ label = "Sync now" }: { label?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await syncRotom();
          if (result.error) {
            toast(result.error, "error");
            return;
          }
          if (result.message) toast(result.message);
          router.refresh();
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {label}
    </Button>
  );
}
