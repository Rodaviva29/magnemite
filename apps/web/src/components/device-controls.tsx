"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Pencil,
  Power,
  Radio,
  RotateCw,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  collectDeviceLogs,
  deleteDevice,
  renameDevice,
  rebootDevice,
  rotomDeviceAction,
  setDeviceApproval,
  setDeviceGroup,
} from "@/actions/devices";
import { DeviceExec } from "@/components/device-exec";
import { DeviceLiveLogs } from "@/components/device-live-logs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export function DeviceControls({
  deviceId,
  name,
  approved,
  online,
  groupId,
  groups,
  hasRotom,
}: {
  deviceId: string;
  name: string;
  approved: boolean;
  online: boolean;
  groupId: string | null;
  groups: { id: string; name: string }[];
  /** True when Rotom has this box matched, so its actions can be offered. */
  hasRotom: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [liveLogs, setLiveLogs] = useState(false);
  const [executing, setExecuting] = useState(false);

  /**
   * Collecting takes as long as the box takes to zip and upload, so the menu
   * item says what it is doing rather than looking broken for ten seconds.
   */
  function downloadLogs() {
    setMessage("Collecting logs from the box…");
    startTransition(async () => {
      const result = await collectDeviceLogs(deviceId);
      if (result.error || !result.bundleId) {
        setMessage(result.error ?? "The box sent nothing back.");
        return;
      }
      setMessage("Logs ready — downloading.");
      window.location.href = `/api/devices/${deviceId}/logs/${result.bundleId}`;
    });
  }

  function run(fn: () => Promise<{ error?: string; message?: string }>, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      setMessage(result?.error ?? result?.message ?? null);
      if (!result?.error) after?.();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Only the two controls used on every visit stay out here; the rest —
          rename, reboot, remove — sit behind the menu so the header stays calm. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          aria-label="Group"
          value={groupId ?? ""}
          disabled={pending}
          className="w-40"
          options={[
            { value: "", label: "No group" },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
          onValueChange={(value) => run(() => setDeviceGroup(deviceId, value))}
        />

        {!approved ? (
          <Button disabled={pending} onClick={() => run(() => setDeviceApproval(deviceId, true))}>
            <ShieldCheck />
            Approve
          </Button>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={pending} aria-label="Device actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>

            {hasRotom ? (
              <DropdownMenuItem onSelect={() => run(() => rotomDeviceAction(deviceId, "restart"))}>
                <RotateCw />
                Restart scanner
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuItem disabled={!online} onSelect={() => setExecuting(true)}>
              <Terminal />
              Execute
            </DropdownMenuItem>

            <DropdownMenuItem disabled={!online} onSelect={() => setLiveLogs(true)}>
              <Radio />
              Live logs
            </DropdownMenuItem>

            <DropdownMenuItem disabled={!online} onSelect={() => downloadLogs()}>
              <ScrollText />
              Logcat (.zip)
            </DropdownMenuItem>

            <DropdownMenuItem disabled={!online} onSelect={() => run(() => rebootDevice(deviceId))}>
              <Power />
              Reboot
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {approved ? (
              <DropdownMenuItem onSelect={() => run(() => setDeviceApproval(deviceId, false))}>
                <ShieldOff />
                Unapprove
              </DropdownMenuItem>
            ) : null}

            <DropdownMenuItem destructive onSelect={() => setConfirmDelete(true)}>
              <Trash2 />
              Remove device
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}

      <DeviceExec deviceId={deviceId} name={name} open={executing} onOpenChange={setExecuting} />

      <DeviceLiveLogs deviceId={deviceId} name={name} open={liveLogs} onOpenChange={setLiveLogs} />

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="device-name">Name</Label>
            <Input
              id="device-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => renameDevice(deviceId, newName),
                  () => setRenaming(false),
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              Its token stops working immediately and its update history is deleted. The box itself
              is untouched — it will keep retrying until you re-enroll it or remove the Magisk
              module.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(
                  () => deleteDevice(deviceId),
                  () => router.push("/"),
                )
              }
            >
              Remove device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
