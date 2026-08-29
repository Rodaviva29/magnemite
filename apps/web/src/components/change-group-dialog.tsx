"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { FolderInput } from "lucide-react";
import { setDevicesGroup } from "@/actions/devices";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Moving a selection of boxes into one group.
 *
 * The device page has always had this as a plain select, which is fine for one
 * box and useless for forty. A dialog rather than a select in the bulk bar
 * because the move is not cosmetic — the group carries the install hooks and
 * the MITM config — so it gets a confirm step and a line saying what changes.
 */
export function ChangeGroupDialog({
  devices,
  groups,
  trigger,
}: {
  devices: { id: string; groupName: string | null }[];
  groups: { id: string; name: string }[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  // Where they are now, so "12 boxes" is not the only thing on screen when the
  // selection spans three groups and only some of them are moving.
  const from = useMemo(() => {
    const counts = new Map<string, number>();
    for (const device of devices) {
      const key = device.groupName ?? "No group";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [devices]);

  const target = groups.find((group) => group.id === groupId);
  const staying = devices.filter(
    (device) => (device.groupName ?? null) === (target?.name ?? null),
  ).length;
  const moving = devices.length - staying;

  const apply = () => {
    startTransition(async () => {
      setError(null);
      const result = await setDevicesGroup(
        devices.map((device) => device.id),
        groupId,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Change group for {devices.length} device{devices.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            The group decides the install hooks, the MITM config and the concurrency cap a box gets.
            No action triggered with this change.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-group">Move to</Label>
            <Select
              id="bulk-group"
              aria-label="Move to"
              placeholder="Select group…"
              value={groupId}
              onValueChange={setGroupId}
              options={[
                { value: "", label: "No group" },
                ...groups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <div>
              Currently:{" "}
              {from.map(([name, count], index) => (
                <span key={name}>
                  {index > 0 ? ", " : ""}
                  {count} in {name}
                </span>
              ))}
            </div>
            {staying > 0 ? (
              <div>
                {staying} {staying === 1 ? "is" : "are"} already there and{" "}
                {staying === 1 ? "stays" : "stay"} untouched.
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={apply} disabled={pending || moving === 0}>
            <FolderInput />
            {pending ? "Moving…" : `Move ${moving}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
