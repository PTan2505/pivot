"use client";

import { FileUp, Search } from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { SOURCE_CATEGORIES, sourceSearchUrl, type ResourceDTO } from "@stan-bag/core/types";
import { BookmarkImportDialog } from "@/components/bookmark-import-dialog";
import { FolderShelf, scrollToSection } from "@/components/folder-shelf";
import { hostOf, ResourceCard, ResourceRow } from "@/components/resource-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Search box over every source with a search URL, and the bookmark import. Always shown on the Sources tab. */
export function SourceToolbar() {
  const { data: sources = [] } = useResources({ type: "source", sort: "title" });
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const searchable = sources.filter(searchTemplate);
  const q = query.trim();

  return (
    <div className="space-y-4 rounded-[14px] bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              searchable.length
                ? `Search ${searchable.length} sources for pricing pages, onboarding, buttons…`
                : "Add a search URL to a source to search it from here"
            }
            aria-label="Search the sources"
            className="h-10 pl-10"
            disabled={!searchable.length}
          />
        </div>
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <FileUp /> Import bookmarks
        </Button>
      </div>
      {q && (
        <div className="space-y-3" aria-live="polite">
          {GROUPS.map((g) => {
            const list = searchable.filter((s) => categoryOf(s) === g.value);
            if (!list.length) return null;
            return (
              <div key={g.value} className="flex flex-wrap items-center gap-2">
                <span className="w-32 shrink-0 text-[13px] text-ink-subtle">{g.label}</span>
                {list.map((s) => (
                  <a
                    key={s.id}
                    href={sourceSearchUrl(searchTemplate(s)!, q)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center rounded-full bg-surface-raised px-3 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-inverse hover:text-on-inverse"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <BookmarkImportDialog open={importing} onOpenChange={setImporting} />
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
            menu: [{ label: `Show all ${g.list.length} sources`, onSelect: () => scrollToSection(g.id) }],
          }))}
        />
      )}
      {groups.map((g) => {
        const { list, id } = g;
        return (
          <section key={id} aria-labelledby={id} className="space-y-6">
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
        <p className="text-xs text-ink-subtle">Add a search URL with {"{q}"} to search this source from Stan Bag.</p>
      )}
    </div>
  );
}
