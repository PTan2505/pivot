"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  TAG_KIND_LABELS,
  TYPE_DEFS,
  type CollectionDTO,
  type ResourceDTO,
  type ResourceType,
  type TagDTO,
  type TagKind,
} from "@pivot/core/types";
import { useSlidingIndicator } from "@/components/library-motion";
import { useTags } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * The Library's page-level filter panel ("Index rail", approved 2026-11-15): quiet vertical option lists beside the
 * grid, after Are.na's View/Sort. It filters and orders this page; the top bar stays the only navigation.
 */

const VISIBLE = 5;
// Facets first, in the order people narrow by; plain tags last.
const KIND_ORDER: TagKind[] = ["pageType", "domain", "visualStyle", "uiPattern", "technology", "tag"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-0.5">
      {/* a label for the group, not a heading: the page's headings stay h1 then h2 */}
      <p aria-hidden className="mb-1 pl-3 text-[13px] leading-[1.4] text-ink-subtle">
        {title}
      </p>
      {children}
    </div>
  );
}

const row =
  "flex min-h-[34px] w-full items-center justify-between gap-2 rounded-[12px] px-3 text-left text-[14px] transition-colors duration-150";
const idle = "text-ink-secondary hover:bg-surface hover:text-ink";
// once a list's highlight is placed (D1) it slides under the pressed option, which drops its own background
const current = "bg-surface-raised text-ink in-data-sliding:bg-transparent";

function Count({ n }: { n: number | string }) {
  return <span className="font-mono text-[12px] text-ink-subtle tabular-nums">{n}</span>;
}

/** An option that picks one value of a group (View, Sort): pressed when it is the current one. */
function Choice({ label, on, count, onClick }: { label: string; on: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn(row, "relative", on ? current : idle)}>
      <span className="truncate">{label}</span>
      {count !== undefined && <Count n={count} />}
    </button>
  );
}

/** A single-choice option list whose highlight slides between rows (D1). */
function Choices({ value, children }: { value: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useSlidingIndicator(ref, value);
  return (
    <div ref={ref} className="relative flex flex-col gap-0.5">
      <span
        aria-hidden
        data-ind
        className="pointer-events-none absolute inset-x-0 top-0 rounded-[12px] bg-surface-raised opacity-0"
      />
      {children}
    </div>
  );
}

export type LandingShow = "all" | "folders" | "items";
export type SortKey = "updated" | "created" | "oldest" | "title";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Recently edited" },
  { value: "created", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
];

export type LayoutKey = "grid" | "list";

/** How the page orders and lays out its items (direction D: these moved from the head into the rail). */
export interface RailOrder {
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  layout: LayoutKey;
  onLayout: (layout: LayoutKey) => void;
}

function OrderGroups({ sort, onSort, layout, onLayout }: RailOrder) {
  return (
    <>
      <Group title="Sort">
        <Choices value={sort}>
          {SORTS.map((s) => (
            <Choice key={s.value} label={s.label} on={sort === s.value} onClick={() => onSort(s.value)} />
          ))}
        </Choices>
      </Group>
      <Group title="Layout">
        <Choices value={layout}>
          <Choice label="Grid" on={layout === "grid"} onClick={() => onLayout("grid")} />
          <Choice label="List" on={layout === "list"} onClick={() => onLayout("list")} />
        </Choices>
      </Group>
    </>
  );
}

/** The Library landing's rail: what to show, the order and layout, and every type and collection with its count. */
export function LandingRail({
  types,
  items,
  collections,
  folderCount,
  show,
  onShow,
  order,
}: {
  types: readonly ResourceType[];
  items: ResourceDTO[] | undefined;
  collections: CollectionDTO[];
  folderCount: number;
  show: LandingShow;
  onShow: (show: LandingShow) => void;
  order: RailOrder;
}) {
  const total = items?.length ?? 0;
  return (
    <div role="group" aria-label="Library filters" className="flex flex-col gap-6">
      <Group title="View">
        <Choices value={show}>
          <Choice label="All" on={show === "all"} count={total} onClick={() => onShow("all")} />
          <Choice label="Folders" on={show === "folders"} count={folderCount} onClick={() => onShow("folders")} />
          <Choice label="Items" on={show === "items"} count={total} onClick={() => onShow("items")} />
        </Choices>
      </Group>
      <OrderGroups {...order} />
      <Group title="Types">
        {types.map((t) => (
          <Link key={t} href={`/?type=${t}`} className={cn(row, idle)}>
            <span className="truncate">{TYPE_DEFS[t].plural}</span>
            <Count n={items?.filter((r) => r.type === t).length ?? 0} />
          </Link>
        ))}
      </Group>
      {collections.length > 0 && (
        <Group title="Collections">
          {collections.map((c) => (
            <Link key={c.id} href={`/collections/${c.id}`} className={cn(row, idle)}>
              <span className="truncate">{c.name}</span>
              <Count n={c.count} />
            </Link>
          ))}
        </Group>
      )}
    </div>
  );
}

/** Tags used by these resources, the most used first. */
function rank(items: ResourceDTO[]) {
  const counts = new Map<string, { tag: TagDTO; count: number }>();
  for (const r of items)
    for (const t of r.tags) counts.set(t.id, { tag: t, count: (counts.get(t.id)?.count ?? 0) + 1 });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name));
}

/**
 * The References rail: each facet kind as a vertical list of values with counts (from what is listed now), the most
 * used first, five shown and "Show N more" for the rest. Picking values narrows the list (they combine with AND).
 */
export function FacetRail({
  items,
  selected,
  onToggle,
  order,
}: {
  items: ResourceDTO[] | undefined;
  selected: string[];
  onToggle: (id: string) => void;
  order: RailOrder;
}) {
  const { data: allTags = [] } = useTags();
  const [open, setOpen] = useState<Partial<Record<TagKind, boolean>>>({});
  // The order and the values come from the unfiltered list, so the rail doesn't rearrange under the pointer while
  // narrowing: values with nothing left drop to 0 and dim instead of disappearing.
  const [baseline, setBaseline] = useState<{ from: ResourceDTO[]; tags: TagDTO[] } | null>(null);
  const unfiltered = selected.length === 0 ? items : undefined;
  // adjusting state while rendering (not in an effect): remember the order each time the unfiltered list changes
  if (unfiltered && baseline?.from !== unfiltered)
    setBaseline({ from: unfiltered, tags: rank(unfiltered).map((x) => x.tag) });

  const groups = useMemo(() => {
    const current = new Map(rank(items ?? []).map((x) => [x.tag.id, x]));
    const order = baseline?.tags ?? [...current.values()].map((x) => x.tag);
    const tags = new Map(order.map((t) => [t.id, t]));
    for (const x of current.values()) if (!tags.has(x.tag.id)) tags.set(x.tag.id, x.tag);
    // a picked value may have no listed item left (nothing has them all): keep it so it can be unpicked
    for (const id of selected) {
      const tag = allTags.find((t) => t.id === id);
      if (tag && !tags.has(id)) tags.set(id, tag);
    }
    const list = [...tags.values()].map((tag) => ({ tag, count: current.get(tag.id)?.count ?? 0 }));
    return KIND_ORDER.map((kind) => ({ kind, list: list.filter((x) => x.tag.kind === kind) })).filter(
      (g) => g.list.length,
    );
  }, [items, selected, allTags, baseline]);

  if (!groups.length)
    return (
      <div className="flex flex-col gap-6">
        <OrderGroups {...order} />
        <p className="pl-3 text-[13px] text-ink-subtle">Nothing listed has tags yet.</p>
      </div>
    );

  return (
    <div role="group" aria-label="Filter by facet" className="flex flex-col gap-6">
      <OrderGroups {...order} />
      {groups.map(({ kind, list }) => {
        const expanded = !!open[kind];
        // picked values always show, even past the first five
        const shown = expanded ? list : list.filter((x, i) => i < VISIBLE || selected.includes(x.tag.id));
        const hidden = list.length - shown.length;
        return (
          <Group key={kind} title={TAG_KIND_LABELS[kind]}>
            {shown.map(({ tag, count }) => {
              const on = selected.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(tag.id)}
                  className={cn(row, on ? current : idle, !on && count === 0 && "text-ink-subtle")}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {on && <Check className="size-3.5 shrink-0 text-accent-text" aria-hidden />}
                    <span className="truncate">{tag.name}</span>
                  </span>
                  <Count n={count} />
                </button>
              );
            })}
            {(hidden > 0 || expanded) && list.length > VISIBLE && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [kind]: !expanded }))}
                className="self-start rounded-full px-3 py-1.5 text-[13px] text-accent-text hover:underline"
              >
                {expanded ? "Show fewer" : `Show ${hidden} more`}
              </button>
            )}
          </Group>
        );
      })}
    </div>
  );
}
