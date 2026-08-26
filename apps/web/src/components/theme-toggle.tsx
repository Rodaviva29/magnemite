"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle({
  className,
  /** In a collapsed rail there is no room for three buttons, so one cycles. */
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server has no idea which theme the browser resolved, so render the
  // control only once we do — otherwise the highlighted option flickers.
  useEffect(() => setMounted(true), []);

  const found = OPTIONS.findIndex((o) => o.value === theme);
  const currentIndex = found === -1 ? 0 : found;
  const current = OPTIONS[currentIndex]!;

  if (compact) {
    const Icon = mounted ? current.icon : Monitor;
    const next = OPTIONS[(currentIndex + 1) % OPTIONS.length]!;
    return (
      <Tooltip label={mounted ? `Theme: ${current.label}` : "Theme"}>
        <button
          type="button"
          onClick={() => setTheme(next.value)}
          className={cn(
            "mx-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card",
            "text-muted-foreground transition-colors hover:text-foreground",
            className,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          <span className="sr-only">Change theme</span>
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5",
        className,
      )}
      role="group"
      aria-label="Colour theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-6 flex-1 items-center justify-center rounded-[6px] transition-colors",
              active ? "bg-emphasis text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
