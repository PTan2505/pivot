"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { TAG_KIND_LABELS, TAG_KINDS, TYPE_DEFS, type ResourceType, type TagDTO, type TagKind } from "@stan-bag/core/types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/lib/api";
import { cn } from "@/lib/utils";

const pill =
  "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150";

function FacetPopover({
  kind,
  tags,
  selected,
  onToggle,
}: {
  kind: TagKind;
  tags: TagDTO[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const active = tags.filter((t) => selected.includes(t.id)).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(pill, active ? "bg-inverse text-on-inverse" : "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink")}
        >
          {TAG_KIND_LABELS[kind]}
          {active > 0 && <span className="font-mono text-[11px] opacity-70">{active}</span>}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={`Filter ${TAG_KIND_LABELS[kind].toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>Nothing here yet.</CommandEmpty>
            <CommandGroup>
              {tags.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <CommandItem key={t.id} value={t.name} onSelect={() => onToggle(t.id)} data-checked={on}>
                    <span
                      className={cn("grid size-4 place-items-center rounded-full border-2 border-ink-subtle", on && "border-inverse bg-inverse text-on-inverse")}
                      aria-hidden
                    >
                      {on && <Check className="size-2.5" strokeWidth={3.5} />}
                    </span>
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-subtle tabular-nums">{t.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({
  type,
  selected,
  onChange,
}: {
  type?: ResourceType;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const kinds: TagKind[] = type ? ["tag", ...TYPE_DEFS[type].facets] : [...TAG_KINDS];
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const chosen = tags.filter((t) => selected.includes(t.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.map((kind) => {
        // Hide facet values nobody uses yet, unless already selected.
        const list = tags.filter((t) => t.kind === kind && ((t.count ?? 0) > 0 || selected.includes(t.id)));
        if (kind !== "tag" && list.length === 0) return null;
        return <FacetPopover key={kind} kind={kind} tags={list} selected={selected} onToggle={toggle} />;
      })}
      {chosen.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => toggle(t.id)}
          className={cn(pill, "bg-surface-raised text-ink hover:bg-surface")}
          aria-label={`Remove filter ${t.name}`}
        >
          <span className="text-ink-subtle">{TAG_KIND_LABELS[t.kind]}</span> {t.name}
          <X className="size-3.5" aria-hidden />
        </button>
      ))}
      {chosen.length > 0 && (
        <button type="button" className={cn(pill, "text-ink-muted hover:text-ink")} onClick={() => onChange([])}>
          Clear filters
        </button>
      )}
    </div>
  );
}
