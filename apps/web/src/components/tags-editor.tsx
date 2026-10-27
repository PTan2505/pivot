"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { TAG_KIND_LABELS, type TagKind } from "@stan-bag/core/types";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags, type TagInput } from "@/lib/api";

function KindPicker({ kind, value, onChange }: { kind: TagKind; value: TagInput[]; onChange: (v: TagInput[]) => void }) {
  const { data: tags = [] } = useTags();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const mine = value.filter((t) => t.kind === kind);
  const has = (name: string) => mine.some((t) => t.name.toLowerCase() === name.toLowerCase());
  const options = tags.filter((t) => t.kind === kind && !has(t.name));
  const trimmed = search.trim();
  const canCreate = trimmed && !has(trimmed) && !tags.some((t) => t.kind === kind && t.name.toLowerCase() === trimmed.toLowerCase());

  const add = (name: string) => {
    onChange([...value, { kind, name }]);
    setSearch("");
  };
  const remove = (name: string) => onChange(value.filter((t) => !(t.kind === kind && t.name === name)));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {mine.map((t) => (
        <span key={t.name} className="flex h-6 items-center gap-1 rounded-[5px] bg-muted pr-1 pl-2 text-xs">
          {t.name}
          <button
            type="button"
            onClick={() => remove(t.name)}
            className="grid size-4 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Remove ${t.name}`}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="h-6 text-xs text-muted-foreground" aria-label={`Add ${TAG_KIND_LABELS[kind]}`}>
            <Plus /> {mine.length ? "" : "Add"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandInput placeholder={`${TAG_KIND_LABELS[kind]}…`} value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">Type to create one.</CommandEmpty>
              {canCreate && (
                <CommandGroup>
                  <CommandItem value={`__create__${trimmed}`} onSelect={() => add(trimmed)}>
                    <Plus /> Create “{trimmed}”
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {options.map((t) => (
                  <CommandItem key={t.id} value={t.name} onSelect={() => add(t.name)}>
                    {t.name}
                    {!!t.count && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{t.count}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function TagsEditor({ kinds, value, onChange }: { kinds: TagKind[]; value: TagInput[]; onChange: (v: TagInput[]) => void }) {
  return (
    <div className="space-y-2">
      {kinds.map((kind) => (
        <div key={kind} className="grid grid-cols-[88px_1fr] items-start gap-2">
          <span className="pt-1 text-xs text-muted-foreground">{TAG_KIND_LABELS[kind]}</span>
          <KindPicker kind={kind} value={value} onChange={onChange} />
        </div>
      ))}
    </div>
  );
}
