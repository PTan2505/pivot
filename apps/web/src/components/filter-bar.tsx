"use client";

import { ChevronDown, X } from "lucide-react";
import { TAG_KIND_LABELS, TAG_KINDS, TYPE_DEFS, type ResourceType, type TagDTO, type TagKind } from "@stan-bag/core/types";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/lib/api";
import { cn } from "@/lib/utils";

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
        <Button variant="outline" size="sm" className={cn("h-7 gap-1 text-xs font-normal", active && "border-primary/50 text-foreground")}>
          {TAG_KIND_LABELS[kind]}
          {active > 0 && <span className="rounded-sm bg-primary px-1 font-mono text-[10px] text-primary-foreground">{active}</span>}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
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
                      className={cn(
                        "grid size-3.5 place-items-center rounded-[3px] border border-input",
                        on && "border-primary bg-primary text-primary-foreground",
                      )}
                      aria-hidden
                    >
                      {on && <span className="block size-1.5 rounded-[1px] bg-current" />}
                    </span>
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{t.count}</span>
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
    <div className="flex flex-wrap items-center gap-1.5">
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
          className="flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs text-foreground transition-colors hover:bg-primary/20"
          aria-label={`Remove filter ${t.name}`}
        >
          <span className="text-muted-foreground">{TAG_KIND_LABELS[t.kind]}:</span> {t.name}
          <X className="size-3" />
        </button>
      ))}
      {chosen.length > 0 && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange([])}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
