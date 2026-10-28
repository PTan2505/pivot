"use client";

import { LayoutGrid, List, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { RESOURCE_TYPES, SEPARATE_TYPES, TYPE_DEFS, type ResourceType } from "@stan-bag/core/types";
import { FilterBar } from "@/components/filter-bar";
import { ResourceCard, ResourceRow } from "@/components/resource-card";
import { SelectionBar } from "@/components/selection-bar";
import { SkillPackGroups } from "@/components/skill-pack-groups";
import { SkillSyncPanel } from "@/components/skill-sync-panel";
import { SourceGroups, SourceToolbar } from "@/components/source-groups";
import { TypeIcon } from "@/components/type-icon";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLibraryParams } from "@/hooks/use-library-params";
import { useCounts, useResource, useResources } from "@/lib/api";
import { cn } from "@/lib/utils";

const SHORT_LABEL: Partial<Record<ResourceType, string>> = {
  media: "Images",
  icon: "Icons",
  typography: "Palettes",
  prompt: "Prompts",
  snippet: "Snippets",
  rule: "Rules",
  checklist: "Checklists",
  mcp: "MCP",
};

/**
 * One row of pills: All + every resource type. The active one is inverse.
 * Separate types (skills) sit after a divider: they have their own tab and are not part of All.
 */
function TypeTabs({ active, showCounts }: { active?: ResourceType; showCounts: boolean }) {
  const pathname = usePathname();
  const { data: counts } = useCounts();
  const tab = (href: string, label: ReactNode, isActive: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors duration-150",
        isActive
          ? "bg-inverse text-on-inverse"
          : "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
      )}
    >
      {label}
      {showCounts && count !== undefined && <span className="font-normal tabular-nums opacity-70">{count}</span>}
    </Link>
  );
  return (
    <nav aria-label="Resource types" className="flex flex-wrap gap-2">
      {tab(pathname, "All", !active, counts?.all)}
      {RESOURCE_TYPES.filter((t) => !SEPARATE_TYPES.includes(t)).map((t) =>
        tab(`${pathname}?type=${t}`, SHORT_LABEL[t] ?? TYPE_DEFS[t].plural, active === t, counts?.[t] ?? 0),
      )}
      <span aria-hidden className="mx-1 my-1.5 w-px self-stretch bg-surface-raised" />
      {SEPARATE_TYPES.map((t) =>
        tab(
          `${pathname}?type=${t}`,
          <>
            <TypeIcon type={t} className="size-3.5" />
            {TYPE_DEFS[t].plural}
          </>,
          active === t,
          counts?.[t] ?? 0,
        ),
      )}
    </nav>
  );
}

/** Shown while the list is narrowed to what was saved from one source. */
function ViaChip({ sourceId, onClear }: { sourceId: string; onClear: () => void }) {
  const { data: source } = useResource(sourceId);
  return (
    <span className="inline-flex h-[30px] items-center gap-1 rounded-full bg-inverse pr-1 pl-3 text-[12px] font-medium text-on-inverse">
      From {source?.title ?? "source"}
      <button
        type="button"
        onClick={onClear}
        aria-label="Show everything, not just this source"
        className="grid size-6 place-items-center rounded-full hover:bg-on-inverse/15"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

export function LibraryView({
  collectionId,
  title,
  subtitle,
  actions,
  mode = "library",
  emptyState,
}: {
  collectionId?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  mode?: "library" | "trash";
  emptyState?: ReactNode;
}) {
  const params = useLibraryParams();
  const [selected, setSelected] = useState<string[]>([]);
  const lastClicked = useRef<string | null>(null);
  const [weekAgo] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000);
  const { set } = params;

  const {
    data: items,
    isLoading,
    error,
  } = useResources({
    q: params.q,
    type: params.type,
    // the library's "All" leaves skills to their own tab; collections and trash show everything
    exclude: mode === "library" && !collectionId && !params.type ? SEPARATE_TYPES : undefined,
    tags: params.tags,
    via: params.via || undefined,
    sort: params.sort,
    collection: collectionId,
    trash: mode === "trash",
  });

  // Escape clears the selection, ⌘A selects everything shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (typing) return;
      if (e.key === "Escape") setSelected([]);
      if ((e.metaKey || e.ctrlKey) && e.key === "a" && items?.length) {
        e.preventDefault();
        setSelected(items.map((i) => i.id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);

  // Drop selections that disappear from the list (deleted, filtered out).
  const visibleIds = useMemo(() => new Set(items?.map((i) => i.id)), [items]);
  const selection = selected.filter((id) => visibleIds.has(id));

  const toggle = (id: string) => (e: MouseEvent) => {
    if (e.shiftKey && lastClicked.current && items) {
      const ids = items.map((i) => i.id);
      const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0) {
        setSelected((s) => [...new Set([...s, ...ids.slice(a, b + 1)])]);
        return;
      }
    }
    lastClicked.current = id;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const heading = title ?? (params.type ? TYPE_DEFS[params.type].plural : "Library");
  const filtered = !!(params.q || params.tags.length || params.via);
  const library = mode === "library" && !collectionId;
  const exportName = typeof heading === "string" ? heading : "ui-context";
  const thisWeek = items?.filter((i) => new Date(i.createdAt).getTime() > weekAgo).length ?? 0;
  const defaultSubtitle = items
    ? `${items.length} ${mode === "trash" ? "in trash" : "saved"}${params.q ? ` matching “${params.q}”` : ""}${!params.q && thisWeek && mode !== "trash" ? ` · ${thisWeek} this week` : ""}`
    : " ";

  return (
    <div className="flex min-h-full flex-col">
      <section className="flex flex-col gap-6 px-4 pt-8 pb-2 md:px-10 md:pt-10">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <h1 className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em] text-balance text-ink">
            {heading}
          </h1>
          <p className="pb-1.5 text-base text-ink-muted">{subtitle ?? defaultSubtitle}</p>
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">{actions}</div>}
        </div>
        {mode === "library" && <TypeTabs active={params.type} showCounts={!collectionId} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterBar type={params.type} selected={params.tags} onChange={(tags) => set({ tags })} />
          {params.via && <ViaChip sourceId={params.via} onClear={() => set({ via: "" })} />}
          <div className="ml-auto flex items-center gap-2">
            <Select value={params.sort} onValueChange={(v) => set({ sort: v as typeof params.sort })}>
              <SelectTrigger size="sm" className="w-[150px]" aria-label="Sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">Recently edited</SelectItem>
                <SelectItem value="created">Recently added</SelectItem>
                <SelectItem value="title">Title A–Z</SelectItem>
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              value={params.view}
              onValueChange={(v) => v && set({ view: v as "grid" | "list" })}
              aria-label="Layout"
            >
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </section>

      <div className="flex-1 space-y-6 px-4 pt-6 pb-16 md:px-10">
        {params.type === "skill" && library && <SkillSyncPanel />}
        {params.type === "source" && library && <SourceToolbar />}

        {error && (
          <div role="alert" className="rounded-[14px] bg-surface p-4 text-sm text-danger">
            Could not load the library: {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-x-6 gap-y-10">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3">
                <Skeleton className="aspect-[16/10] rounded-[14px] bg-surface" />
                <Skeleton className="h-4 w-2/3 rounded-full bg-surface" />
              </div>
            ))}
          </div>
        ) : items?.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            {filtered ? (
              <div className="space-y-1">
                <p className="text-[15px] font-medium">No matches</p>
                <p className="text-sm text-ink-muted">Try fewer filters or a different search.</p>
              </div>
            ) : (
              (emptyState ?? (
                <div className="max-w-sm space-y-2">
                  <p className="text-[15px] font-medium">Nothing here yet</p>
                  <p className="text-sm text-ink-muted">
                    Paste a URL or an image anywhere with <Kbd>⌘V</Kbd>, drop files on the window, or press Add.
                  </p>
                </div>
              ))
            )}
          </div>
        ) : params.type === "source" && library && items ? (
          <SourceGroups items={items} view={params.view} selection={selection} toggle={toggle} />
        ) : params.type === "skill" && library && items ? (
          <SkillPackGroups items={items} view={params.view} selection={selection} toggle={toggle} />
        ) : params.view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-x-6 gap-y-10">
            {items?.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                selected={selection.includes(r.id)}
                selecting={selection.length > 0}
                onToggle={toggle(r.id)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {items?.map((r) => (
              <ResourceRow
                key={r.id}
                resource={r}
                selected={selection.includes(r.id)}
                selecting={selection.length > 0}
                onToggle={toggle(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      <SelectionBar
        ids={selection}
        onClear={() => setSelected([])}
        mode={mode}
        collectionId={collectionId}
        exportName={exportName}
      />
    </div>
  );
}
