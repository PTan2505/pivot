"use client";

import { LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  visibleTypes,
  SOURCE_CATEGORIES,
  TAG_KIND_LABELS,
  TYPE_DEFS,
  type CollectionDTO,
  type ResourceDTO,
  type ResourceType,
} from "@pivot/core/types";
import { Breadcrumbs, typeCrumbs, type Crumb } from "@/components/breadcrumbs";
import { FolderShelf } from "@/components/folder-shelf";
import { FacetRail, LandingRail, type LandingShow, type RailOrder } from "@/components/library-rail";
import {
  openFolder as openFolderMotion,
  refreshScroll,
  useCondensingHead,
  useEntrance,
  useFilterFlip,
  useRoll,
  useViewMorph,
} from "@/components/library-motion";
import { ResourceCard, ResourceRow } from "@/components/resource-card";
import { SelectionBar } from "@/components/selection-bar";
import { ExternalResults, ScopeSwitch } from "@/components/external-search";
import { Suggestions } from "@/components/suggestions";
import { SkillPackGroups } from "@/components/skill-pack-groups";
import { SkillSyncPanel } from "@/components/skill-sync-panel";
import { categoryOf, SourceGroups, SourceToolbar } from "@/components/source-groups";
import { TagPills } from "@/components/tag-pills";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLibraryParams } from "@/hooks/use-library-params";
import {
  assetUrl,
  useCollectionCovers,
  useCollections,
  useResource,
  useShowOther,
  usePrimeResources,
  useResources,
  useTags,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { hostOf } from "@/components/resource-card";

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

/** Narrows a collection or the trash to one type. */
function TypeSelect({
  types,
  value,
  onChange,
}: {
  types: readonly ResourceType[];
  value: ResourceType | undefined;
  onChange: (type: ResourceType | undefined) => void;
}) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? undefined : (v as ResourceType))}>
      <SelectTrigger size="sm" className="w-[196px]" aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All types</SelectItem>
        {types.map((t) => (
          <SelectItem key={t} value={t}>
            <TypeIcon type={t} className="size-3.5 text-ink-subtle" />
            {SHORT_LABEL[t] ?? TYPE_DEFS[t].plural}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A section's landing page: one glass folder per type, holding what's listed below. */
function TypeShelf({ types, items }: { types: readonly ResourceType[]; items: ResourceDTO[] }) {
  const router = useRouter();
  return (
    <FolderShelf
      label="Types"
      folders={types.map((t) => {
        const list = items.filter((r) => r.type === t);
        const plural = TYPE_DEFS[t].plural;
        return {
          id: `type-${t}`,
          label: plural,
          meta: `${list.length} item${list.length === 1 ? "" : "s"}`,
          items: list.map((r) => ({
            id: r.id,
            name: r.title,
            meta: hostOf(r.sourceUrl) ?? undefined,
            image: r.coverAssetId ? assetUrl(r.coverAssetId, { thumb: true }) : undefined,
          })),
          activate: () => router.push(`/?type=${t}`),
        };
      })}
    />
  );
}

/**
 * The Library landing's shelf in the "Index rail" layout: a glass folder for each type that holds something and for each
 * collection, holding what's listed below. Empty types stay in the rail. Opening one fades the page out first (M3).
 */
function RailShelf({
  types,
  items,
  collections,
  onOpen,
}: {
  types: readonly ResourceType[];
  items: ResourceDTO[];
  collections: CollectionDTO[];
  onOpen: (href: string, folderId: string, ids: string[]) => void;
}) {
  const covers = useCollectionCovers(collections.map((c) => c.id));
  const sheet = (r: ResourceDTO) => ({
    id: r.id,
    name: r.title,
    meta: hostOf(r.sourceUrl) ?? undefined,
    image: r.coverAssetId ? assetUrl(r.coverAssetId, { thumb: true }) : undefined,
  });
  const folders = [
    ...types
      .map((t) => ({ t, list: items.filter((r) => r.type === t) }))
      .filter(({ list }) => list.length)
      .map(({ t, list }) => ({
        id: `type-${t}`,
        label: TYPE_DEFS[t].plural,
        meta: `${list.length} item${list.length === 1 ? "" : "s"}`,
        // the folder shows its last four files, newest at the front: the four most recent, so opening References
        // lands them on its first cards
        items: list.slice(0, 4).reverse().map(sheet),
        activate: () =>
          onOpen(
            `/?type=${t}`,
            `type-${t}`,
            list
              .slice(0, 4)
              .reverse()
              .map((r) => r.id),
          ),
      })),
    ...collections
      .filter((c) => c.count > 0)
      .map((c) => ({
        id: `collection-${c.id}`,
        label: c.name,
        meta: `${c.count} item${c.count === 1 ? "" : "s"}`,
        items: (covers[collections.indexOf(c)]?.data ?? []).map(sheet),
        activate: () => onOpen(`/collections/${c.id}`, `collection-${c.id}`, []),
      })),
  ];
  return <FolderShelf label="Folders" folders={folders} />;
}

/** D2: a count that rolls to its new value (the live region and the pill's label carry the words). */
function Rolling({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useRoll(ref, n);
  return (
    <span ref={ref} className="inline-grid overflow-hidden align-bottom">
      <span className="[grid-area:1/1]">{n}</span>
    </span>
  );
}

/** A filter shown as a dark pill with a button that removes it. */
function FilterChip({ label, clearLabel, onClear }: { label: ReactNode; clearLabel: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-full bg-inverse pr-1 pl-3 text-[13px] font-medium text-on-inverse">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={clearLabel}
        className="grid size-6 place-items-center rounded-full hover:bg-on-inverse/15"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** Shown while the list is narrowed to what was saved from one source. */
function ViaChip({ sourceId, onClear }: { sourceId: string; onClear: () => void }) {
  const { data: source } = useResource(sourceId);
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-full bg-inverse pr-1 pl-3 text-[13px] font-medium text-on-inverse">
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
  crumbs,
}: {
  collectionId?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  mode?: "library" | "trash";
  emptyState?: ReactNode;
  /** Breadcrumb trail; the library works out its own (Section › Type). Shown only when it has two or more steps. */
  crumbs?: Crumb[];
}) {
  const params = useLibraryParams();
  const [selected, setSelected] = useState<string[]>([]);
  const lastClicked = useRef<string | null>(null);
  const { set } = params;
  // Sections only apply to the library itself; collections and the trash cover every type.
  const library = mode === "library" && !collectionId;
  // collections and the trash list every type; their type filter offers what's shown
  const showOther = useShowOther();
  const typeChoices = library ? params.section.types : visibleTypes(showOther);
  // Hybrid search: with a query in the library, look in it, outside it, or both.
  const searching = library && !!params.q.trim();
  const scope = searching ? params.scope : "library";

  const {
    data: listed,
    isLoading,
    error,
  } = useResources({
    q: params.q,
    type: params.type,
    // "Saved from this source" counts every type, so the list it opens doesn't stop at the section's types.
    types: library && !params.type && !params.via && !params.review && !params.url ? params.section.types : undefined,
    tags: params.tags,
    via: params.via || undefined,
    review: params.review || undefined,
    url: params.url || undefined,
    sort: params.sort,
    collection: collectionId ?? (params.collection || undefined),
    trash: mode === "trash",
  });
  const { data: allCollections = [] } = useCollections();
  const collectionName = allCollections.find((c) => c.id === params.collection)?.name;

  // One source category: narrow here, the list of sources is small.
  const items = useMemo(
    () => (params.category ? listed?.filter((r) => categoryOf(r) === params.category) : listed),
    [listed, params.category],
  );

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

  const category = SOURCE_CATEGORIES.find((c) => c.value === params.category);
  const { data: viaSource } = useResource(library && !params.type ? params.via : "");
  const heading =
    title ??
    (params.review ? "Inbox" : undefined) ??
    category?.label ??
    viaSource?.title ??
    (params.type && params.section.types.length > 1 ? TYPE_DEFS[params.type].plural : params.section.label);
  const filtered = !!(params.q || params.tags.length || params.via || params.collection || params.url);
  // Search, tags, source, collection and page; the type, section, category and Inbox are where you are, not filters.
  const clearFilters = () => set({ q: "", tags: [], via: "", collection: "", url: "", scope: "all" });
  const trail =
    crumbs ??
    (library && params.type ? [...typeCrumbs(params.type), ...(category ? [{ label: category.label }] : [])] : []);
  const exportName = typeof heading === "string" ? heading : "ui-context";
  const countLabel = items
    ? `${items.length} ${mode === "trash" ? "in trash" : items.length === 1 ? "item" : "items"}${params.q ? ` matching “${params.q}”` : ""}`
    : undefined;

  // "Index rail" (approved 2026-11-15): the Library landing and the References list get a page-level filter rail, one
  // head band, a compact head while scrolling and GSAP motion. Other sections, collections and the trash keep theirs.
  const rail =
    library && params.section.id === "library" && (!params.type || params.type === "reference") && !params.review;
  const landing = rail && !params.type && !params.via && !params.url && !searching;
  const [show, setShow] = useState<LandingShow>("all");
  const router = useRouter();
  const { data: allTags = [] } = useTags();
  const pageRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const railHeadRef = useRef<HTMLDivElement>(null);
  const railTitleRef = useRef<HTMLSpanElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  // below lg the title docks into the top bar's row once it has scrolled under it (direction D)
  const [docked, setDocked] = useState(false);
  useCondensingHead(
    {
      title: titleRef,
      rail: railRef,
      railHead: railHeadRef,
      railTitle: railTitleRef,
      controls: controlsRef,
      shelf: shelfRef,
    },
    setDocked,
    // rebuilt only when the page changes; other layout changes just re-measure (a rebuild would hide the head)
    [rail, landing, !!items],
  );
  useEffect(() => {
    if (rail) refreshScroll();
  }, [rail, show, params.view, items?.length]);
  useEntrance(pageRef, titleRef, `${params.section.id}:${params.type ?? ""}`, !!items, rail);
  const { grid: gridRef, capture: captureFlip } = useFilterFlip(items);
  const { list: listRef, morph: morphView } = useViewMorph(params.view);
  const prime = usePrimeResources();
  const openFolder = (href: string, folderId: string, ids: string[]) => {
    // References opens from what is already loaded (sorted the same way); the real fetch still runs
    if (folderId === "type-reference" && params.sort === "updated" && items)
      prime(
        { type: "reference", sort: "updated" },
        items.filter((r) => r.type === "reference"),
      );
    openFolderMotion(pageRef, shelfRef.current, folderId, ids, () => router.push(href));
  };
  // M2: a facet toggle animates the cards that stay; the test below says which ones will
  const toggleTag = (id: string) => {
    const next = params.tags.includes(id) ? params.tags.filter((x) => x !== id) : [...params.tags, id];
    const byId = new Map(items?.map((r) => [r.id, r]));
    captureFlip((rid) => {
      const r = byId.get(rid);
      return !!r && next.every((t) => r.tags.some((x) => x.id === t));
    });
    set({ tags: next });
  };
  const changeView = (v: string) => {
    if (v !== "grid" && v !== "list") return;
    if (rail) morphView(() => set({ view: v }));
    else set({ view: v });
  };
  const folderCount = landing
    ? params.section.types.filter((t) => items?.some((r) => r.type === t)).length +
      allCollections.filter((c) => c.count > 0).length
    : 0;

  const viewToggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={1}
      value={params.view}
      onValueChange={changeView}
      aria-label="Layout"
    >
      <ToggleGroupItem value="grid" aria-label="Grid view">
        <LayoutGrid />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view">
        <List />
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const order: RailOrder = {
    sort: params.sort,
    onSort: (sort) => set({ sort }),
    layout: params.view === "list" ? "list" : "grid",
    onLayout: changeView,
  };
  const railContent = landing ? (
    <LandingRail
      types={params.section.types}
      items={items}
      collections={allCollections}
      folderCount={folderCount}
      show={show}
      onShow={setShow}
      order={order}
    />
  ) : (
    <FacetRail items={items} selected={params.tags} onToggle={toggleTag} order={order} />
  );
  // Below lg the rail moves into a popover behind a "Filters (n)" pill.
  const filtersFor = (trigger: ReactNode) => (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* touch-sized rows here: this popover is how phones and tablets reach the rail */}
      <PopoverContent align="end" className="max-h-[70vh] w-72 overflow-y-auto p-3 [&_a]:min-h-11 [&_button]:min-h-11">
        {railContent}
      </PopoverContent>
    </Popover>
  );
  const filtersLabel = params.tags.length ? `Filters (${params.tags.length})` : "Filters";
  const filtersButton = filtersFor(
    <Button variant="secondary" size="sm" className="lg:hidden">
      <SlidersHorizontal aria-hidden /> {filtersLabel}
    </Button>,
  );
  // below lg, once the title has gone under the bar: the title, its count and Filters in the bar's row (direction D)
  const dockSlot = docked && rail && typeof document !== "undefined" ? document.getElementById("topbar-dock") : null;
  const dock =
    dockSlot &&
    createPortal(
      <>
        {/* the h1 stays the page's heading: screen readers skip this copy */}
        <span
          aria-hidden
          className="min-w-0 truncate text-[17px] leading-[1.2] font-medium tracking-[-0.01em] text-ink"
        >
          {heading}
        </span>
        {items && (
          <span aria-hidden className="font-mono text-[13px] text-ink tabular-nums">
            {items.length}
          </span>
        )}
        {filtersFor(
          <button
            type="button"
            aria-label={`${filtersLabel}: sort, layout and facets`}
            className="relative ml-auto grid size-11 shrink-0 place-items-center rounded-full text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text [&_svg]:size-5"
          >
            <SlidersHorizontal aria-hidden />
            {params.tags.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] rounded-full bg-inverse px-1 text-center font-mono text-[12px] leading-[18px] font-medium text-on-inverse">
                {params.tags.length}
              </span>
            )}
          </button>,
        )}
      </>,
      dockSlot,
    );
  return (
    <div ref={pageRef} className="flex min-h-full flex-col">
      {dock}
      {rail ? (
        <section className="flex flex-col gap-4 px-4 pt-8 pb-2 md:px-10 md:pt-10">
          {trail.length > 1 && (
            <div data-enter>
              <Breadcrumbs items={trail} />
            </div>
          )}
          <div data-enter className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <h1
              ref={titleRef}
              tabIndex={-1}
              className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em] text-balance text-ink"
            >
              {/* M2 moves the words, M1 the heading itself */}
              <span data-morph className="inline-block">
                {heading}
              </span>
            </h1>
            {items && scope !== "external" && (
              <span
                data-arrive
                aria-label={countLabel}
                title={countLabel}
                className="mb-2 inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-surface px-3 font-mono text-[14px] text-ink-secondary tabular-nums"
              >
                <Rolling n={items.length} />
              </span>
            )}
            {/* from lg, Sort and Layout live in the rail; below it, in Filters (with the facets) */}
            <div ref={controlsRef} data-arrive className="ml-auto flex flex-wrap items-center gap-2 pb-1 lg:hidden">
              {filtersButton}
              {viewToggle}
            </div>
          </div>
          {filtered && (
            <div data-enter role="group" aria-label="Active filters" className="flex flex-wrap items-center gap-2">
              {params.tags.map((id) => {
                const t = allTags.find((x) => x.id === id);
                return (
                  <FilterChip
                    key={id}
                    label={
                      <>
                        {t && t.kind !== "tag" && (
                          <span className="font-normal opacity-70">{TAG_KIND_LABELS[t.kind]}&nbsp;</span>
                        )}
                        {t?.name ?? "Tag"}
                      </>
                    }
                    clearLabel={`Remove filter ${t?.name ?? ""}`}
                    onClear={() => toggleTag(id)}
                  />
                );
              })}
              {params.via && <ViaChip sourceId={params.via} onClear={() => set({ via: "" })} />}
              {params.collection && (
                <FilterChip
                  label={`In ${collectionName ?? "collection"}`}
                  clearLabel="Show every collection"
                  onClear={() => set({ collection: "" })}
                />
              )}
              {params.url && (
                <FilterChip
                  label={`Saved from ${hostOf(params.url) ?? "this page"}`}
                  clearLabel="Show every page"
                  onClear={() => set({ url: "" })}
                />
              )}
              {searching && <ScopeSwitch value={params.scope} onChange={(next) => set({ scope: next })} />}
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X aria-hidden /> Clear filters
              </Button>
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {countLabel}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-6 px-4 pt-8 pb-2 md:px-10 md:pt-10">
          {trail.length > 1 && <Breadcrumbs items={trail} />}
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            {/* focusable from code (after "Show them" reveals a hidden section), not by Tab */}
            <h1
              tabIndex={-1}
              className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em] text-balance text-ink outline-none"
            >
              {heading}
            </h1>
            {/* Just the number: what's listed right now (it follows search and filters); none when only searching outside. */}
            {items && scope !== "external" && (
              <span
                aria-label={countLabel}
                title={countLabel}
                className="mb-2 inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-surface px-3 font-mono text-[14px] text-ink-secondary tabular-nums"
              >
                {items.length}
              </span>
            )}
            {subtitle && <p className="pb-2.5 text-base text-ink-muted">{subtitle}</p>}
            {params.review && (
              <p className="pb-2.5 text-base text-ink-muted">
                Quick saves waiting to be organised. They are searchable already; select some and mark them reviewed.
              </p>
            )}
            {actions && <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">{actions}</div>}
          </div>
          <TagPills items={items} selected={params.tags} onChange={(tags) => set({ tags })} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* In the library the navbar menus pick the type; collections and the trash keep the select. */}
            {!library && typeChoices.length > 1 && (
              <TypeSelect types={typeChoices} value={params.type} onChange={(type) => set({ type })} />
            )}
            {params.via && <ViaChip sourceId={params.via} onClear={() => set({ via: "" })} />}
            {params.review && (
              <FilterChip label="Needs review" clearLabel="Leave the Inbox" onClear={() => set({ review: "" })} />
            )}
            {params.collection && !collectionId && (
              <FilterChip
                label={`In ${collectionName ?? "collection"}`}
                clearLabel="Show every collection"
                onClear={() => set({ collection: "" })}
              />
            )}
            {params.url && (
              <FilterChip
                label={`Saved from ${hostOf(params.url) ?? "this page"}`}
                clearLabel="Show every page"
                onClear={() => set({ url: "" })}
              />
            )}
            {searching && <ScopeSwitch value={params.scope} onChange={(next) => set({ scope: next })} />}
            {filtered && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X aria-hidden /> Clear filters
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Select value={params.sort} onValueChange={(v) => set({ sort: v as typeof params.sort })}>
                <SelectTrigger size="sm" className="w-[176px]" aria-label="Sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Recently edited</SelectItem>
                  <SelectItem value="created">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
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
      )}

      <div
        className={cn(
          "flex-1 px-4 pt-6 pb-16 md:px-10",
          rail && "lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start lg:gap-10",
        )}
      >
        {rail && (
          <aside
            ref={railRef}
            data-arrive
            className="hidden lg:sticky lg:top-[calc(var(--topbar-h)+16px)] lg:-mt-14 lg:block lg:max-h-[calc(100dvh-var(--topbar-h)-32px)] lg:overflow-y-auto lg:pb-6"
          >
            {/* M1 lands the display title here; it is the page's h1 seen again, so screen readers skip it */}
            <div ref={railHeadRef} aria-hidden className="mb-4 flex h-10 items-baseline gap-2.5 px-3 opacity-0">
              <span
                ref={railTitleRef}
                className="min-w-0 truncate text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink"
              >
                {heading}
              </span>
              {items && <span className="font-mono text-[13px] text-ink-subtle tabular-nums">{items.length}</span>}
            </div>
            {railContent}
          </aside>
        )}
        <div className="min-w-0 space-y-6">
          {scope === "external" ? (
            <ExternalResults query={params.q} />
          ) : (
            <>
              {params.review && <Suggestions />}
              {params.type === "skill" && library && <SkillSyncPanel />}
              {params.type === "source" && library && <SourceToolbar />}
              {landing
                ? items && (
                    // hidden rather than removed under View: Items, so the folders don't assemble again on the way back
                    <div ref={shelfRef} data-enter className="pb-10" hidden={show === "items"}>
                      <RailShelf
                        types={params.section.types}
                        items={items}
                        collections={allCollections}
                        onOpen={openFolder}
                      />
                    </div>
                  )
                : library &&
                  !searching &&
                  !params.type &&
                  !params.via &&
                  !params.review &&
                  !params.url &&
                  params.section.types.length > 1 &&
                  items && (
                    <div className="pb-10">
                      <TypeShelf types={params.section.types} items={items} />
                    </div>
                  )}
              {landing && show !== "folders" && items && items.length > 0 && (
                <h2 data-enter className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink">
                  All items{" "}
                  <span className="ml-1 font-mono text-[14px] font-normal text-ink-subtle">{items.length}</span>
                </h2>
              )}

              {error && (
                <div role="alert" className="rounded-[14px] bg-surface p-4 text-sm text-danger">
                  Could not load the library: {error.message}
                </div>
              )}

              <div ref={listRef} hidden={landing && show === "folders"}>
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
                  <div
                    className={cn(
                      "grid place-items-center text-center",
                      scope === "all" && searching ? "py-10" : "py-24",
                    )}
                  >
                    {filtered ? (
                      <div className="flex max-w-sm flex-col items-center gap-3">
                        <div className="space-y-1">
                          <p className="text-[16px] font-medium">
                            {params.q ? `Nothing matches “${params.q}”` : "Nothing matches these filters"}
                          </p>
                          <p className="text-sm text-ink-muted">
                            {params.q && (params.tags.length || params.via)
                              ? "The search and the filters apply together. Try fewer filters or a different search."
                              : "Try fewer filters or a different search."}
                          </p>
                        </div>
                        <Button variant="secondary" onClick={clearFilters}>
                          <X aria-hidden /> Clear filters
                        </Button>
                        {searching && scope === "library" && (
                          <Button variant="ghost" onClick={() => set({ scope: "external" })}>
                            Search outside your library
                          </Button>
                        )}
                      </div>
                    ) : (
                      (emptyState ?? (
                        <div className="max-w-sm space-y-2">
                          <p className="text-[16px] font-medium">
                            {typeof heading === "string" && library ? `Nothing in ${heading} yet` : "Nothing here yet"}
                          </p>
                          <p className="text-sm text-ink-muted">
                            Paste a URL or an image anywhere with <Kbd>⌘V</Kbd>, drop files on the window, or press Add.
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                ) : params.type === "source" && library && items ? (
                  <SourceGroups
                    items={items}
                    view={params.view}
                    selection={selection}
                    toggle={toggle}
                    shelf={!category}
                  />
                ) : params.type === "skill" && library && items ? (
                  <SkillPackGroups items={items} view={params.view} selection={selection} toggle={toggle} />
                ) : params.view === "grid" ? (
                  <div
                    ref={gridRef}
                    className={cn(
                      "grid gap-x-6 gap-y-10 data-flipping:pointer-events-none",
                      rail
                        ? "grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]"
                        : "grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))]",
                    )}
                  >
                    {items?.map((r) => (
                      // the cell is what Flip moves; the card and its screenshot inside are never transformed
                      <div
                        key={r.id}
                        data-flip-id={r.id}
                        className={cn(
                          "min-w-0",
                          // D3: pointer devices lift a card 2px; off while cards move and with reduced motion
                          rail &&
                            "transition-[translate] duration-200 ease-out in-data-flipping:translate-none motion-safe:pointer-fine:hover:-translate-y-0.5",
                        )}
                      >
                        <ResourceCard
                          resource={r}
                          selected={selection.includes(r.id)}
                          selecting={selection.length > 0}
                          onToggle={toggle(r.id)}
                          compact={rail}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div ref={gridRef} className="flex flex-col gap-1 data-flipping:pointer-events-none">
                    {items?.map((r) => (
                      <div key={r.id} data-flip-id={r.id}>
                        <ResourceRow
                          resource={r}
                          selected={selection.includes(r.id)}
                          selecting={selection.length > 0}
                          onToggle={toggle(r.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {scope === "all" && searching && (
                <div className="pt-10">
                  <ExternalResults query={params.q} compact />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SelectionBar
        ids={selection}
        onClear={() => setSelected([])}
        mode={mode}
        collectionId={collectionId ?? (params.collection || undefined)}
        exportName={exportName}
        inbox={!!params.review}
      />
    </div>
  );
}
