"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { SOURCE_CATEGORIES, sourceSearchUrl, type ResourceDTO } from "@pivot/core/types";
import { FolderShelf } from "@/components/folder-shelf";
import { hostOf, ResourceCard, ResourceRow } from "@/components/resource-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLibraryParams } from "@/hooks/use-library-params";
import { assetUrl, useResources, useSourceStats } from "@/lib/api";

const CATEGORY_VALUES = new Set<string>(SOURCE_CATEGORIES.map((c) => c.value));
/** The source's category, or "" when it has none (or one we no longer know). */
export const categoryOf = (r: ResourceDTO) =>
  typeof r.meta.category === "string" && CATEGORY_VALUES.has(r.meta.category) ? r.meta.category : "";
const searchTemplate = (r: ResourceDTO) =>
  typeof r.meta.searchUrl === "string" && r.meta.searchUrl.includes("{q}") ? r.meta.searchUrl : null;

const GROUPS = [
  ...SOURCE_CATEGORIES,
  { value: "", label: "Uncategorized", hint: "Pick a category on the source's page" },
] as const;

/** Filter box over the saved sources. It shares `?q=` with the top bar search, so the view stays linkable. */
export function SourceToolbar() {
  const { q, set } = useLibraryParams();
  const { data: sources = [] } = useResources({ type: "source" });
  const [value, setValue] = useState(q);
  const [lastQ, setLastQ] = useState(q);

  // Follow the URL when it changes from elsewhere (top bar search, back/forward, clearing filters).
  if (q !== lastQ) {
    setLastQ(q);
    setValue(q);
  }

  useEffect(() => {
    if (value === q) return;
    const t = setTimeout(() => set({ q: value }), 200);
    return () => clearTimeout(t);
  }, [value, q, set]);

  return (
    <div className="relative max-w-[560px]">
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setValue("")}
        placeholder={`Filter ${sources.length ? `${sources.length} ` : ""}sources by name, site, notes or tag…`}
        aria-label="Filter the sources"
        className="h-10 pl-10"
      />
    </div>
  );
}

/** Sources grouped by what you go there to find. */
export function SourceGroups({
  items,
  view,
  selection,
  toggle,
  shelf = true,
}: {
  /** The folder shelf above the groups; off when one category is chosen. */
  shelf?: boolean;
  items: ResourceDTO[];
  view: "grid" | "list";
  selection: string[];
  toggle: (id: string) => (e: MouseEvent) => void;
}) {
  const { data: stats = {} } = useSourceStats();
  const router = useRouter();
  const meta = (r: ResourceDTO) =>
    [hostOf(r.sourceUrl), stats[r.id] ? `${stats[r.id]} saved` : "", searchTemplate(r) ? "searchable" : ""]
      .filter(Boolean)
      .join(" · ");

  const groups = GROUPS.map((g) => ({
    ...g,
    id: `category-${g.value || "none"}`,
    list: items.filter((r) => categoryOf(r) === g.value),
  })).filter((g) => g.list.length);

  return (
    <div className="space-y-16">
      {shelf && (
        <FolderShelf
          label="Source categories"
          folders={groups.map((g) => ({
            id: g.id,
            label: g.label,
            meta: `${g.list.length} source${g.list.length === 1 ? "" : "s"}`,
            items: g.list.map((r) => ({
              id: r.id,
              name: r.title,
              meta: hostOf(r.sourceUrl) ?? undefined,
              image: r.coverAssetId ? assetUrl(r.coverAssetId, { thumb: true }) : undefined,
            })),
            activate: () => router.push(g.value ? `/?type=source&category=${g.value}` : "/?type=source"),
          }))}
        />
      )}
      {groups.map((g) => {
        const { list, id } = g;
        return (
          <section
            key={id}
            aria-labelledby={id}
            className="scroll-mt-8 space-y-6 md:scroll-mt-[calc(var(--topbar-h)+1rem)]"
          >
            <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id={id} className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink">
                {g.label}
              </h2>
              <p className="text-[14px] text-ink-subtle">
                {g.hint} · {list.length}
              </p>
            </header>
            {view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-x-6 gap-y-10">
                {list.map((r) => (
                  <ResourceCard
                    key={r.id}
                    resource={r}
                    meta={meta(r)}
                    selected={selection.includes(r.id)}
                    selecting={selection.length > 0}
                    onToggle={toggle(r.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {list.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    meta={meta(r)}
                    selected={selection.includes(r.id)}
                    selecting={selection.length > 0}
                    onToggle={toggle(r.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** On a source's page: what was saved from it, and a quick search to test its search URL. */
export function SourceInfo({ id, searchUrl }: { id: string; searchUrl: unknown }) {
  const { data: stats = {} } = useSourceStats();
  const [query, setQuery] = useState("");
  const count = stats[id] ?? 0;
  const template = typeof searchUrl === "string" && searchUrl.includes("{q}") ? searchUrl : null;
  return (
    <div className="space-y-3 rounded-[14px] bg-surface p-4">
      <Link
        href={`/?via=${id}`}
        className="flex items-center justify-between text-[14px] text-ink-secondary hover:text-ink"
      >
        <span>Saved from this source</span>
        <span className="font-mono text-xs tabular-nums">{count} →</span>
      </Link>
      {template ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) window.open(sourceSearchUrl(template, query), "_blank", "noopener,noreferrer");
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this source"
            aria-label="Search this source"
            className="h-8 text-[14px]"
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!query.trim()}>
            Search
          </Button>
        </form>
      ) : (
        <p className="text-xs text-ink-subtle">Add a search URL with {"{q}"} to search this source from PIVOT.</p>
      )}
    </div>
  );
}
