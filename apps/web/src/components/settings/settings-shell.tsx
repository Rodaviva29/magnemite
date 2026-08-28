"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AppWindow,
  Boxes,
  Columns3,
  KeyRound,
  Rss,
  SearchX,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";

export type SettingsSectionId = "hub" | "apps" | "sources" | "columns" | "groups" | "enrollment";

export type SettingsSection = {
  id: SettingsSectionId;
  /** Shown beside the label in the rail, when there is something to count. */
  count?: number;
  content: ReactNode;
};

type Category = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  summary: string;
  /**
   * The words a person would actually type looking for a knob in this
   * category — field labels, and the names things go by elsewhere. Searching
   * "cooldown" has to land on Hub without them having to know it lives there.
   */
  terms: string[];
};

/** Ordered the way the fleet is set up: the hub first, then what it ships, then who joins. */
const CATEGORIES: Category[] = [
  {
    id: "hub",
    label: "Hub",
    icon: SlidersHorizontal,
    summary: "Fleet-wide limits, polling and how long health history is kept.",
    terms: [
      "max concurrent jobs",
      "job stall timeout",
      "source poll interval",
      "auto-update cooldown",
      "health sample interval",
      "history retention",
      "metrics",
    ],
  },
  {
    id: "apps",
    label: "Apps",
    icon: AppWindow,
    summary: "The packages this fleet installs, and how their rollouts start on their own.",
    terms: [
      "app target",
      "auto-update",
      "automatic rollouts",
      "approve versions",
      "canary devices",
      "soak minutes",
      "attempts per device",
      "rollout window",
      "package name",
    ],
  },
  {
    id: "sources",
    label: "Version sources",
    icon: Rss,
    summary: "The indexes new builds are discovered at, and which one wins a tie.",
    terms: ["index url", "base url", "priority", "poll", "mirror", "feed", "discovery"],
  },
  {
    id: "columns",
    label: "Fleet columns",
    icon: Columns3,
    summary: "Extra packages to show an installed version for on the fleet table.",
    terms: ["watched package", "column header", "reporting", "installed version", "scanner"],
  },
  {
    id: "groups",
    label: "Device groups",
    icon: Boxes,
    summary: "Install hooks that run around an install, and per-site concurrency.",
    terms: [
      "pre-install hook",
      "post-install hook",
      "concurrent updates",
      "site",
      "force-stop",
      "root",
    ],
  },
  {
    id: "enrollment",
    label: "Enrollment",
    icon: KeyRound,
    summary: "The tokens a new box presents once to join the fleet.",
    terms: ["token", "auto-approve devices", "max uses", "revoke", "config.json", "magisk"],
  },
];

/**
 * Settings, one category at a time.
 *
 * Everything here used to be a single column six cards long, which made the
 * page a scroll rather than a place: the knob you wanted was always somewhere
 * below the fold, and there was no way to ask for it by name. The rail turns
 * that into six short pages, and the search box is the way in for anyone who
 * knows the field but not the category it lives under — so it matches field
 * labels, not just the six headings.
 */
export function SettingsShell({ sections }: { sections: SettingsSection[] }) {
  const [active, setActive] = useState<SettingsSectionId>("hub");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);

  // A link to #groups should open on groups. Read after mount — the server has
  // no way to know the fragment, so rendering that tab first would mismatch.
  useEffect(() => {
    const hash = window.location.hash.slice(1) as SettingsSectionId;
    if (CATEGORIES.some((c) => c.id === hash)) setActive(hash);
  }, []);

  // "/" is the search key everywhere else on the web; ignore it while the
  // caret is already in a field, where it is a character someone is typing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => matchCategories(query), [query]);
  const searching = query.trim().length > 0;

  // Searching shows every category that matched, stacked, rather than making
  // someone click each hit in turn to find out which one they meant.
  const shown = searching
    ? matches.map((m) => m.category)
    : CATEGORIES.filter((c) => c.id === active);

  function select(id: SettingsSectionId) {
    setActive(id);
    setQuery("");
    // replace, not push: the back button should leave Settings, not walk back
    // through every tab that was looked at.
    window.history.replaceState(null, "", `#${id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-update policy, where versions are discovered, per-group install hooks, and the tokens
          new boxes enroll with.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        {/* Sticky on desktop so the rail stays reachable from the bottom of a
            long category; on phones it collapses into a scrolling pill row. */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-6">
          <SearchInput
            value={query}
            onChange={setQuery}
            inputRef={searchRef}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-none"
          />

          <nav
            aria-label="Settings categories"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {(searching ? matches : CATEGORIES.map((category) => ({ category, hits: [] }))).map(
              ({ category, hits }) => {
                const { id, label, icon: Icon } = category;
                const selected = !searching && id === active;
                const count = byId.get(id)?.count;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => select(id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "group flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium leading-5",
                      "transition-colors lg:w-full lg:shrink",
                      selected
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:bg-emphasis/60 hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 -translate-y-[0.5px] transition-colors",
                        selected
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{label}</span>
                      {/* Which field matched, so a hit is explicable rather
                          than just a category that lit up. */}
                      {hits.length > 0 ? (
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {hits.slice(0, 2).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    {count ? (
                      <Badge variant="secondary" className="tabular-nums">
                        {count}
                      </Badge>
                    ) : null}
                  </button>
                );
              },
            )}

            {searching && matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No match</p>
            ) : null}
          </nav>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {searching ? (
            <p className="text-sm text-muted-foreground">
              {matches.length === 0
                ? "Nothing in settings matches "
                : `${matches.length} ${matches.length === 1 ? "category" : "categories"} match `}
              <span className="font-medium text-foreground">“{query.trim()}”</span>
            </p>
          ) : null}

          {shown.map((category) => (
            <section key={category.id} id={category.id} className="flex min-w-0 flex-col gap-6">
              {/* Searching stacks several categories, and the cards below carry
                  their own titles — but not which category they belong to. */}
              {searching ? (
                <div className="flex items-center gap-2 text-sm font-medium">
                  <category.icon className="h-4 w-4 text-muted-foreground" />
                  {category.label}
                </div>
              ) : null}
              {byId.get(category.id)?.content}
            </section>
          ))}

          {searching && matches.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <SearchX className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Try a field name — “cooldown”, “canary”, “hook”, “token”.
              </p>
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Categories whose label, summary or field names contain every word typed,
 * along with the field names that matched.
 *
 * Every word rather than any: "poll minutes" should narrow to Hub, not widen
 * to everything mentioning either.
 */
function matchCategories(query: string): { category: Category; hits: string[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return CATEGORIES.map((category) => ({ category, hits: [] }));

  const result: { category: Category; hits: string[] }[] = [];
  for (const category of CATEGORIES) {
    const haystack =
      `${category.label} ${category.summary} ${category.terms.join(" ")}`.toLowerCase();
    if (!words.every((word) => haystack.includes(word))) continue;
    result.push({
      category,
      hits: category.terms.filter((term) => words.some((word) => term.includes(word))),
    });
  }
  return result;
}
