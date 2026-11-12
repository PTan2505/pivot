"use client";

import { ChevronDown, X } from "lucide-react";
import { useMemo } from "react";
import { TAG_KIND_LABELS, TAG_KINDS, type ResourceDTO, type TagDTO } from "@pivot/core/types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/lib/api";
import { cn } from "@/lib/utils";

const VISIBLE = 12;

const pill =
  "inline-flex h-9 items-center gap-2 rounded-full px-4 text-[14px] font-medium transition-colors duration-150";
const idle = "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink";
const on = "bg-inverse text-on-inverse";

/**
 * The tag filter: one pill per tag used by what's on screen, most used first, so picking one narrows the list
 * (tags combine with AND). The rest are in "More". Selected tags stay first and show inverse.
 */
export function TagPills({
  items,
  selected,
  onChange,
}: {
  /** The resources currently listed; tag counts come from them. */
  items: ResourceDTO[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: allTags = [] } = useTags();
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const ranked = useMemo(() => {
    const counts = new Map<string, { tag: TagDTO; count: number }>();
    for (const r of items ?? []) {
      for (const t of r.tags) counts.set(t.id, { tag: t, count: (counts.get(t.id)?.count ?? 0) + 1 });
    }
    return [...counts.values()]
      .filter((x) => !selected.includes(x.tag.id))
      .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name));
  }, [items, selected]);

  // Selected tags may not be in the list any more (no item left has them all); look them up globally.
  const chosen = selected.map((id) => allTags.find((t) => t.id === id)).filter((t): t is TagDTO => !!t);
  const visible = ranked.slice(0, VISIBLE);
  const rest = ranked.slice(VISIBLE);

  if (!chosen.length && !ranked.length) return null;

  // Facets (page type, style…) and plain tags look alike, so the visible pills are grouped under their kind.
  const groups = TAG_KINDS.map((kind) => ({ kind, list: visible.filter((x) => x.tag.kind === kind) })).filter(
    (g) => g.list.length,
  );
  const labelled = groups.some((g) => g.kind !== "tag");

  return (
    <div role="group" aria-label="Filter by tag" className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(pill, chosen.length ? idle : on)} onClick={() => onChange([])}>
          All
        </button>
        {chosen.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed
            className={cn(pill, on, "pr-3")}
            onClick={() => toggle(t.id)}
            title="Click to remove"
          >
            {t.kind !== "tag" && <span className="font-normal opacity-70">{TAG_KIND_LABELS[t.kind]}</span>}
            {t.name}
            <X className="size-3.5 opacity-70" aria-label="Remove" />
          </button>
        ))}
      </div>
      {groups.map(({ kind, list }) => (
        <div key={kind} role="group" aria-label={TAG_KIND_LABELS[kind]} className="flex flex-wrap items-center gap-2">
          {labelled && <span className="pr-1 text-[13px] text-ink-subtle">{TAG_KIND_LABELS[kind]}</span>}
          {list.map(({ tag, count }) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={false}
              className={cn(pill, idle)}
              onClick={() => toggle(tag.id)}
            >
              {tag.name}
              <span className="font-normal tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      ))}
      {rest.length > 0 && <MoreTags tags={rest} onToggle={toggle} />}
    </div>
  );
}

function MoreTags({ tags, onToggle }: { tags: { tag: TagDTO; count: number }[]; onToggle: (id: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(pill, idle)}>
          +{tags.length} more
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Find a tag…" />
          <CommandList>
            <CommandEmpty>No tag matches.</CommandEmpty>
            {TAG_KINDS.map((kind) => {
              const list = tags.filter((x) => x.tag.kind === kind);
              if (!list.length) return null;
              return (
                <CommandGroup key={kind} heading={TAG_KIND_LABELS[kind]}>
                  {list.map(({ tag, count }) => (
                    <CommandItem key={tag.id} value={`${tag.name} ${tag.id}`} onSelect={() => onToggle(tag.id)}>
                      <span className="truncate">{tag.name}</span>
                      <span className="ml-auto font-mono text-[12px] text-ink-subtle tabular-nums">{count}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
