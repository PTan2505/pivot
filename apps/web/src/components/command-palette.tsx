"use client";

import { FolderSync, Layers, Link2, Moon, Search, Settings, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RESOURCE_TYPES, sourceSearchUrl, TYPE_DEFS } from "@stan-bag/core/types";
import { useCreateOfType } from "@/components/add-menu";
import { hostOf } from "@/components/resource-card";
import { TypeIcon } from "@/components/type-icon";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useUi } from "@/components/ui-store";
import { useCopyResource } from "@/hooks/use-copy-resource";
import { api, useCollections, useInvalidate, useResources } from "@/lib/api";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openAddUrl } = useUi();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const copy = useCopyResource();
  const createOfType = useCreateOfType();
  const invalidate = useInvalidate();
  const { data: collections = [] } = useCollections();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (paletteOpen) setSearch("");
        setPaletteOpen(!paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  const setOpen = (open: boolean) => {
    if (!open) setSearch("");
    setPaletteOpen(open);
  };

  const { data: results = [] } = useResources({ q: debounced }, { enabled: paletteOpen });
  const shown = results.slice(0, debounced ? 20 : 8);
  const { data: sources = [] } = useResources({ type: "source", sort: "title" }, { enabled: paletteOpen });
  const searchable = sources.flatMap((s) =>
    typeof s.meta.searchUrl === "string" && s.meta.searchUrl.includes("{q}")
      ? [{ ...s, template: s.meta.searchUrl }]
      : [],
  );

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setOpen} className="sm:max-w-2xl">
      <Command
        className="rounded-none!"
        value={highlighted}
        onValueChange={setHighlighted}
        onKeyDown={(e) => {
          // ⌘↵ copies the highlighted resource instead of opening it (cmdk skips prevented events).
          if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
          const r = shown.find((x) => `${x.title} ${x.id}`.toLowerCase() === highlighted.toLowerCase());
          if (!r) return;
          e.preventDefault();
          run(() => copy(r));
        }}
      >
        <CommandInput placeholder="Search resources, or type a command…" value={search} onValueChange={setSearch} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No results.</CommandEmpty>
          {shown.length > 0 && (
            <CommandGroup heading={debounced ? "Resources" : "Recent"}>
              {shown.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.title} ${r.id}`}
                  keywords={[debounced]}
                  onSelect={() => run(() => router.push(`/r/${r.id}`))}
                >
                  <TypeIcon type={r.type} className="text-muted-foreground" />
                  <span className="truncate">{r.title}</span>
                  <span className="ml-1 truncate text-xs text-muted-foreground">
                    {hostOf(r.sourceUrl) ?? TYPE_DEFS[r.type].label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {search.trim() && searchable.length > 0 && (
            <CommandGroup heading={`Search the sources for “${search.trim()}”`}>
              {searchable.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`Search on ${s.title} ${s.id}`}
                  keywords={[search]}
                  onSelect={() =>
                    run(() => window.open(sourceSearchUrl(s.template, search), "_blank", "noopener,noreferrer"))
                  }
                >
                  <Search className="text-muted-foreground" />
                  <span className="truncate">Search on {s.title}</span>
                  <span className="ml-1 truncate text-xs text-muted-foreground">{hostOf(s.sourceUrl)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => run(() => openAddUrl())}>
              <Link2 /> Add from URL…
            </CommandItem>
            {RESOURCE_TYPES.filter((t) => TYPE_DEFS[t].url !== "primary").map((t) => (
              <CommandItem key={t} value={`New ${TYPE_DEFS[t].label}`} onSelect={() => run(() => createOfType(t))}>
                <TypeIcon type={t} /> New {TYPE_DEFS[t].label.toLowerCase()}
              </CommandItem>
            ))}
            <CommandItem
              onSelect={() =>
                run(async () => {
                  const r = await api<{ created: number; updated: number; total: number }>("/api/skills/sync", {
                    method: "POST",
                  }).catch((e) => {
                    toast.error(e.message);
                    return null;
                  });
                  if (r) {
                    invalidate();
                    toast.success(`Synced ${r.total} skills · ${r.created} imported · ${r.updated} updated`);
                  }
                })
              }
            >
              <FolderSync /> Sync skills from disk
            </CommandItem>
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              <Moon /> Toggle theme
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            <CommandItem onSelect={() => run(() => router.push("/"))}>
              <Layers /> All resources
            </CommandItem>
            {RESOURCE_TYPES.map((t) => (
              <CommandItem
                key={t}
                value={`Go ${TYPE_DEFS[t].plural}`}
                onSelect={() => run(() => router.push(`/?type=${t}`))}
              >
                <TypeIcon type={t} /> {TYPE_DEFS[t].plural}
              </CommandItem>
            ))}
            {collections.map((c) => (
              <CommandItem
                key={c.id}
                value={`Collection ${c.name}`}
                onSelect={() => run(() => router.push(`/collections/${c.id}`))}
              >
                <span className="block size-3 rounded-[3px] border border-current" /> {c.name}
                <CommandShortcut>collection</CommandShortcut>
              </CommandItem>
            ))}
            <CommandItem onSelect={() => run(() => router.push("/trash"))}>
              <Trash2 /> Trash
            </CommandItem>
            <CommandItem onSelect={() => run(() => router.push("/settings"))}>
              <Settings /> Settings
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          <span>↵ open</span>
          <span>⌘↵ copy</span>
          <span>esc close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
