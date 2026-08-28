"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

import { RelativeTime } from "@/components/relative-time";

export type DevicePackageRow = {
  id: string;
  packageName: string;
  versionName: string | null;
  versionCode: string | null;
  installed: boolean;
  /** True for a package Magnemite watches, which is the one it can update. */
  tracked: boolean;
};

/**
 * Everything the box has, not just the app being rolled out.
 *
 * The tracked apps come from `dumpsys` and carry a real version name; the rest
 * come from the periodic `pm list packages` inventory and only have a version
 * code. That difference is visible on purpose — a code with no name means
 * "seen in the inventory", not "version unknown for a watched app".
 */
export function DevicePackages({
  packages,
  syncedAt,
}: {
  packages: DevicePackageRow[];
  syncedAt: string | null;
}) {
  const [query, setQuery] = useState("");
  const [onlyTracked, setOnlyTracked] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packages.filter((pkg) => {
      if (onlyTracked && !pkg.tracked) return false;
      if (!q) return true;
      return (
        pkg.packageName.toLowerCase().includes(q) ||
        (pkg.versionName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [packages, query, onlyTracked]);

  const gone = packages.filter((p) => !p.installed).length;

  return (
    <TooltipProvider delayDuration={200}>
      <Card>
        {/* The card owns its own header so the counts can sit up on the title
            line, where they read as a subtitle for the whole list rather than
            as one more control in the filter row. */}
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-sm">Installed packages</CardTitle>
          <span className="text-xs text-muted-foreground">
            {visible.length} of {packages.length}
            {gone > 0 ? ` · ${gone} no longer installed` : ""}
            {syncedAt ? (
              <>
                {" · inventory "}
                <RelativeTime value={syncedAt} />
              </>
            ) : null}
          </span>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search packages…"
              className="max-w-xs"
            />
            <Button
              variant={onlyTracked ? "secondary" : "outline"}
              onClick={() => setOnlyTracked((v) => !v)}
              aria-pressed={onlyTracked}
              className="ml-auto shrink-0"
            >
              {onlyTracked ? <Eye /> : <EyeOff />}
              Watched only
            </Button>
          </div>

          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing reported yet — the agent sends this on its next heartbeat.
            </p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto pr-1 text-sm">
              {visible.map((pkg) => (
                <li key={pkg.id} className="flex items-center justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2">
                    {/* The eye carries what the badge used to say, in the column
                    where the reader is already looking: open means Magnemite
                    watches this package and can update it. */}
                    <Tooltip
                      label={
                        pkg.tracked
                          ? "Watched — Magnemite can update this one"
                          : "Not watched — seen in the inventory only"
                      }
                    >
                      <span
                        className={
                          pkg.tracked
                            ? "shrink-0 text-foreground"
                            : "shrink-0 text-muted-foreground/50"
                        }
                      >
                        {pkg.tracked ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </Tooltip>
                    <span className="truncate font-mono text-xs">{pkg.packageName}</span>
                  </span>
                  <span className="shrink-0">
                    {!pkg.installed ? (
                      <Badge variant="outline">not installed</Badge>
                    ) : pkg.versionName ? (
                      <Badge variant="secondary">
                        {pkg.versionName}
                        {pkg.versionCode ? ` (${pkg.versionCode})` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        {pkg.versionCode ? `code ${pkg.versionCode}` : "installed"}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
              {visible.length === 0 ? (
                <li className="py-4 text-center text-xs text-muted-foreground">
                  Nothing matches that search.
                </li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
