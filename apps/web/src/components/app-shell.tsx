"use client";

import { ChevronDown, FolderPlus, Folders, PenTool, Search, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isResourceType } from "@pivot/core/types";
import { AddMenu } from "@/components/add-menu";
import { PivotMark, PivotWordmark } from "@/components/brand";
import { SectionNav } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useUi } from "@/components/ui-store";
import { api, useCollections, useCounts, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={<div className="h-[76px] shrink-0" />}>
        <TopBar />
      </Suspense>
      {/* The page scrolls (not an inner panel) so the work passes under the glass top bar, which is fixed from md
          up; the main area starts below it using the bar's measured height. */}
      <main id="main" className="flex-1 md:pt-(--topbar-h)">
        {children}
      </main>
    </div>
  );
}

const LIBRARY_ROUTES = /^\/($|collections\/|trash$)/;

/** The search field filters the current library view; elsewhere it jumps to the library with the query. */
function SearchField() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const { setPaletteOpen } = useUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const onLibrary = LIBRARY_ROUTES.test(pathname);
  const urlQuery = onLibrary ? (sp.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);

  // Follow the URL when it changes from elsewhere (back/forward, clearing filters).
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (!onLibrary || value === urlQuery) return;
    const t = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 200);
    return () => clearTimeout(t);
  }, [value, urlQuery, onLibrary, sp, router, pathname]);

  // "/" focuses search from anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <label className="flex h-11 w-full max-w-[560px] items-center gap-2.5 rounded-full bg-surface px-[18px] text-ink-muted focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-accent-text">
      <Search className="size-4 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        id="global-search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            e.currentTarget.blur();
          }
          if (e.key === "Enter" && !onLibrary && value.trim()) router.push(`/?q=${encodeURIComponent(value.trim())}`);
        }}
        placeholder="Search your bag — sites, prompts, skills…"
        aria-label="Search your bag"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
      />
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="shrink-0 rounded-sm px-1 font-mono text-xs text-ink-subtle hover:text-ink max-md:hidden"
        aria-label="Open command palette"
      >
        ⌘K
      </button>
    </label>
  );
}

function CollectionsMenu() {
  const { data: collections = [] } = useCollections();
  const router = useRouter();
  const invalidate = useInvalidate();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = async () => {
    if (!name.trim()) return;
    try {
      const c = await api<{ id: string }>("/api/collections", { method: "POST", json: { name } });
      invalidate();
      setCreating(false);
      setName("");
      router.push(`/collections/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create collection");
    }
  };

  return (
    <Popover open={creating} onOpenChange={setCreating}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="lg" aria-label="Collections" className="max-sm:size-10 max-sm:px-0">
              {/* icon-only on phones so the action row fits */}
              <Folders className="sm:hidden" aria-hidden />
              <span className="max-sm:hidden">Collections</span>
              <ChevronDown className="opacity-60 max-sm:hidden" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-ink-subtle">Collections</DropdownMenuLabel>
          {collections.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-ink-muted">Group resources for a task.</p>
          )}
          {collections.map((c) => (
            <DropdownMenuItem key={c.id} onSelect={() => router.push(`/collections/${c.id}`)}>
              <span className="truncate">{c.name}</span>
              <span className="ml-auto font-mono text-[12px] text-ink-subtle">{c.count}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setTimeout(() => setCreating(true), 0)}>
            <FolderPlus /> New collection…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="w-72 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex gap-2"
        >
          <Input
            autoFocus
            placeholder="Collection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Collection name"
          />
          <Button type="submit" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function TopBar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: counts } = useCounts();
  const type = sp.get("type");
  const barRef = useRef<HTMLElement>(null);

  // The bar is fixed from md up, so the page reserves its height; it wraps to two rows between md and lg.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--topbar-h", `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  return (
    // Frosted glass over the ember light and the scrolling work; fixed from md up (on phones it wraps to several
    // rows and would take too much of the screen, so it stays in the flow there).
    <header
      ref={barRef}
      className="ember-bar relative isolate z-40 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 md:fixed md:inset-x-0 md:top-0 md:px-10"
    >
      {/* The glass is a layer, not the header itself: an element with backdrop-filter becomes the backdrop root of
          its children, so the section menu (rendered inside the header) could only blur the bar, not the page. */}
      <div aria-hidden className="glass absolute inset-0 -z-10 border-x-0 border-t-0" />
      <Link href="/" className="flex items-center gap-2.5 rounded-full text-ink" aria-label="PIVOT — library">
        <PivotMark className="h-[22px]" />
        <PivotWordmark className="h-[13px]" />
      </Link>
      <SectionNav />
      <div className="order-last flex basis-full justify-center lg:order-none lg:flex-1 lg:basis-auto">
        <SearchField />
      </div>
      <nav aria-label="App" className="ml-auto flex items-center gap-2">
        <CollectionsMenu />
        <Button
          variant="secondary"
          size="icon-lg"
          asChild
          aria-label={`Trash${counts?.trash ? `, ${counts.trash} items` : ""}`}
        >
          <Link
            href="/trash"
            className={cn("relative", pathname === "/trash" && "bg-inverse text-on-inverse hover:bg-inverse")}
          >
            <Trash2 />
            {!!counts?.trash && (
              <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-surface-raised px-1 font-mono text-[12px] text-ink-secondary">
                {counts.trash}
              </span>
            )}
          </Link>
        </Button>
        <Button variant="secondary" size="icon-lg" asChild aria-label="Design sessions">
          <Link
            href="/design"
            className={cn(pathname.startsWith("/design") && "bg-inverse text-on-inverse hover:bg-inverse")}
          >
            <PenTool />
          </Link>
        </Button>
        <Button variant="secondary" size="icon-lg" asChild aria-label="Settings">
          <Link
            href="/settings"
            className={cn(pathname === "/settings" && "bg-inverse text-on-inverse hover:bg-inverse")}
          >
            <Settings />
          </Link>
        </Button>
        <AddMenu preferType={pathname === "/" && isResourceType(type) ? type : undefined} />
      </nav>
    </header>
  );
}
