"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, PlugZap, PowerOff, Radar, RadioTower, Unplug } from "lucide-react";
import { rotomDeviceAction, rotomSetEnabled } from "@/actions/devices";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RotomSyncButton } from "@/components/rotom-sync-button";
import { useToast } from "@/components/ui/toast";

/**
 * The things you can tell Rotom to do to this box.
 *
 * They live here rather than in the device page's action menu because they all
 * travel Rotom's socket rather than the agent's, and that distinction is the
 * whole reason to reach for one: three of them are the only remediation left on
 * a box Magnemite cannot reach. Mixed in beside "Reboot", which needs the agent
 * alive, the two kinds of reboot read as duplicates of each other.
 *
 * None of them are disabled when the box is offline to us. That is exactly when
 * they are worth having.
 */
export function RotomControls({
  deviceId,
  enabled,
}: {
  deviceId: string;
  /** Whether Rotom has the box in its pool, which decides which way the last
   *  item points. There is no automatic path out of the pool — see below. */
  enabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error?: string; message?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast(result.error, "error");
      else if (result.message) toast(result.message);
      // Refresh whatever the outcome: "Rotom still has this box enabled" is a
      // message about state the page is now showing, so the page has to catch
      // up with it either way.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RotomSyncButton label="Refresh from Rotom" />

        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => rotomDeviceAction(deviceId, "restart"))}
          title="Restart the scanner app through Rotom"
        >
          <Radar />
          Restart scanner
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={pending} aria-label="Rotom actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => run(() => rotomDeviceAction(deviceId, "disconnect"))}>
              <Unplug />
              Drop Rotom connection
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => run(() => rotomDeviceAction(deviceId, "reboot"))}>
              <RadioTower />
              Reboot through Rotom
            </DropdownMenuItem>

            {/* One item, pointing whichever way the box is not. The action
                re-reads Rotom afterwards rather than trusting the flag this
                label was drawn from, and says so when Rotom disagrees — a
                stored copy can be a whole sync out of date.

                Manual only, and no rule can do it: an automatic path out of the
                scanning pool with no automatic path back is not a watchdog. */}
            {enabled ? (
              <DropdownMenuItem onSelect={() => run(() => rotomSetEnabled(deviceId, false))}>
                <PowerOff />
                Disable in Rotom
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => run(() => rotomSetEnabled(deviceId, true))}>
                <PlugZap />
                Enable in Rotom
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
