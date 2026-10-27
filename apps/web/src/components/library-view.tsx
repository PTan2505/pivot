"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { TYPE_DEFS } from "@stan-bag/core/types";
import { AddMenu } from "@/components/add-menu";
import { FilterBar } from "@/components/filter-bar";
import { ResourceCard, ResourceRow } from "@/components/resource-card";
import { SelectionBar } from "@/components/selection-bar";
import { SkillSyncPanel } from "@/components/skill-sync-panel";
import { TypeIcon } from "@/components/type-icon";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLibraryParams } from "@/hooks/use-library-params";
import { useResources } from "@/lib/api";

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LibraryView({
  collectionId,
  title,
  headerExtra,
  mode = "library",
  emptyState,
}: {
  collectionId?: string;
  title?: ReactNode;
  headerExtra?: ReactNode;
  mode?: "library" | "trash";
  emptyState?: ReactNode;
}) {
  const params = useLibraryParams();
  const [query, setQuery] = useState(params.q);
  const debouncedQuery = useDebounced(query);
  const searchRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const lastClicked = useRef<string | null>(null);

  const { set } = params;
  useEffect(() => {
    if (debouncedQuery !== params.q) set({ q: debouncedQuery });
  }, [debouncedQuery, params.q, set]);

  const { data: items, isLoading, error } = useResources({
    q: params.q,
    type: params.type,
    tags: params.tags,
    sort: params.sort,
    collection: collectionId,
    trash: mode === "trash",
  });

  // "/" focuses search, Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && !typing) setSelected([]);
      if ((e.metaKey || e.ctrlKey) && e.key === "a" && !typing && items?.length) {
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

  const heading = title ?? (params.type ? TYPE_DEFS[params.type].plural : "All resources");
  const filtered = !!(params.q || params.tags.length);
  const exportName = typeof heading === "string" ? heading : "ui-context";

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2">
          <h1 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            {params.type && !collectionId && <TypeIcon type={params.type} className="size-4 text-muted-foreground" />}
            <span className="truncate">{heading}</span>
          </h1>
          {items && <span className="font-mono text-xs text-muted-foreground tabular-nums">{items.length}</span>}
          {headerExtra}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
                placeholder="Search…"
                aria-label="Search resources"
                className="h-8 w-56 pr-8 pl-8 text-[13px]"
              />
              <Kbd className="absolute top-1/2 right-1.5 -translate-y-1/2">/</Kbd>
            </div>
            <Select value={params.sort} onValueChange={(v) => set({ sort: v as typeof params.sort })}>
              <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label="Sort">
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
              value={params.view}
              onValueChange={(v) => v && set({ view: v as "grid" | "list" })}
              aria-label="Layout"
            >
              <ToggleGroupItem value="grid" aria-label="Grid view" className="h-8">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view" className="h-8">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
            {mode === "library" && <AddMenu preferType={params.type} />}
          </div>
        </div>
        <div className="flex min-h-10 items-center px-6 pb-2">
          <FilterBar type={params.type} selected={params.tags} onChange={(tags) => set({ tags })} />
        </div>
      </header>

      <div className="flex-1 space-y-4 px-6 py-5">
        {params.type === "skill" && mode === "library" && !collectionId && <SkillSyncPanel />}

        {error && (
          <div role="alert" className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
            Could not load the library: {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        ) : items?.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            {filtered ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">No matches</p>
                <p className="text-sm text-muted-foreground">Try fewer filters or a different search.</p>
              </div>
            ) : (
              (emptyState ?? (
                <div className="max-w-sm space-y-2">
                  <p className="text-sm font-medium">Nothing here yet</p>
                  <p className="text-sm text-muted-foreground">
                    Paste a URL or an image anywhere with <Kbd>⌘V</Kbd>, drop files, or use <span className="text-foreground">Add</span>.
                  </p>
                </div>
              ))
            )}
          </div>
        ) : params.view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {items?.map((r) => (
              <ResourceCard key={r.id} resource={r} selected={selection.includes(r.id)} selecting={selection.length > 0} onToggle={toggle(r.id)} />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card [&>a:last-child]:border-b-0">
            {items?.map((r) => (
              <ResourceRow key={r.id} resource={r} selected={selection.includes(r.id)} selecting={selection.length > 0} onToggle={toggle(r.id)} />
            ))}
          </div>
        )}
      </div>

      <SelectionBar ids={selection} onClear={() => setSelected([])} mode={mode} collectionId={collectionId} exportName={exportName} />
    </div>
  );
}
