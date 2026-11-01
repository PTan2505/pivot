"use client";

import { ExternalLink, FolderSync, Layers, Link2, Search, Settings, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  externalPageFor,
  RESOURCE_TYPES,
  SECTIONS,
  sourceSearchUrl,
  TYPE_DEFS,
  type SearchScope,
} from "@pivot/core/types";
import { useCreateOfType } from "@/components/add-menu";
import { ScopeSwitch } from "@/components/external-search";
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
import { sectionHref } from "@/hooks/use-library-params";
import { api, useCollections, useExternalSearch, useInvalidate, useResources } from "@/lib/api";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, openAddUrl } = useUi();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
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

  const { data: results = [], isFetching: searching } = useResources(
    { q: debounced },
    { enabled: paletteOpen && scope !== "external" },
  );
  const shown = scope === "external" ? [] : results.slice(0, debounced ? 20 : 8);
  const external = useExternalSearch(debounced, { enabled: paletteOpen && scope !== "library", limit: 3 });
  // only results that answer what is typed now; the previous query's stay out while the new one loads
  const direct = scope === "library" ? [] : (externalPageFor(external.data, debounced)?.providers ?? []);
  const { data: sources = [], isLoading: loadingSources } = useResources(
    { type: "source", sort: "title" },
    { enabled: paletteOpen },
  );
  // While the typed query hasn't reached the list yet, an empty list means "not yet", not "nothing".
  const pending = search !== debounced || searching || loadingSources || (scope !== "library" && external.isFetching);
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
        {search.trim() && (
          <div className="flex items-center gap-2 border-b border-divider px-3 py-2">
            <ScopeSwitch value={scope} onChange={setScope} />
          </div>
        )}
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{pending ? "Searching…" : "No results."}</CommandEmpty>
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
          {direct.map(
            (p) =>
              p.results.length > 0 && (
                <CommandGroup key={p.id} heading={`${p.name} · Direct · ${p.licence.name}`}>
                  {p.results.map((r) => (
                    <CommandItem
                      key={r.externalId}
                      value={`${p.name} ${r.title} ${r.externalId}`}
                      keywords={[debounced]}
                      onSelect={() => run(() => window.open(r.url, "_blank", "noopener,noreferrer"))}
                    >
                      <ExternalLink className="text-muted-foreground" />
                      <span className="truncate">{r.title}</span>
                      <span className="ml-1 truncate text-xs text-muted-foreground">
                        {r.saved ? "In your library" : r.description}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
          )}
          {search.trim() && scope !== "library" && searchable.length > 0 && (
            <CommandGroup heading={`Search on your sources’ sites for “${search.trim()}” (opens their search)`}>
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
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {SECTIONS.filter((s) => s.types.length > 1).map((s) => (
              <CommandItem key={s.id} value={`Go ${s.label}`} onSelect={() => run(() => router.push(sectionHref(s)))}>
                <Layers /> {s.label}
              </CommandItem>
            ))}
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
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[12px] text-muted-foreground">
          <span>↵ open</span>
          <span>⌘↵ copy</span>
          <span>esc close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
