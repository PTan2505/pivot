"use client";

import { Archive, FolderPlus, Layers, Moon, Search, Settings, Sun, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RESOURCE_TYPES, TYPE_DEFS, type ResourceType } from "@stan-bag/core/types";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUi } from "@/components/ui-store";
import { api, useCollections, useCounts, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r md:flex border-sidebar-border bg-sidebar text-sidebar-foreground">
        <Suspense fallback={<div className="flex-1" />}>
          <Sidebar />
        </Suspense>
      </aside>
      <main id="main" className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function NavItem({
  href,
  active,
  icon,
  label,
  count,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <span className={cn("text-muted-foreground [&_svg]:size-3.5", active && "text-primary")}>{icon}</span>
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{count}</span>
      )}
    </Link>
  );
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 mb-1 flex h-6 items-center justify-between px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
      {action}
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: counts } = useCounts();
  const { data: collections } = useCollections();
  const { setPaletteOpen } = useUi();
  const { resolvedTheme, setTheme } = useTheme();
  const activeType = pathname === "/" ? sp.get("type") : null;

  const typeLink = (type: ResourceType) => (
    <NavItem
      key={type}
      href={`/?type=${type}`}
      active={activeType === type}
      icon={<TypeIcon type={type} />}
      label={TYPE_DEFS[type].plural}
      count={counts?.[type]}
    />
  );

  return (
    <>
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-primary-foreground">
          <Archive className="size-3" aria-hidden />
        </span>
        <span className="text-sm font-semibold tracking-tight">Stan Bag</span>
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/40 px-2 text-[13px] text-muted-foreground transition-colors hover:border-input hover:text-foreground"
        >
          <Search className="size-3.5" aria-hidden />
          Search or jump to…
          <Kbd className="ml-auto">⌘K</Kbd>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Library">
        <div className="mt-3">
          <NavItem href="/" active={pathname === "/" && !activeType} icon={<Layers />} label="All resources" count={counts?.all} />
        </div>
        <SectionLabel>Visual</SectionLabel>
        {RESOURCE_TYPES.filter((t) => TYPE_DEFS[t].group === "visual").map(typeLink)}
        <SectionLabel>Knowledge</SectionLabel>
        {RESOURCE_TYPES.filter((t) => TYPE_DEFS[t].group === "knowledge").map(typeLink)}
        <SectionLabel action={<NewCollectionButton />}>Collections</SectionLabel>
        {collections?.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Group resources for a task.</p>}
        {collections?.map((c) => (
          <NavItem
            key={c.id}
            href={`/collections/${c.id}`}
            active={pathname === `/collections/${c.id}`}
            icon={<span className="block size-2 rounded-[3px] border border-current" />}
            label={c.name}
            count={c.count}
          />
        ))}
      </nav>
      <div className="flex items-center gap-1 border-t border-sidebar-border px-3 py-2">
        <div className="flex-1 space-y-0.5">
          <NavItem href="/trash" active={pathname === "/trash"} icon={<Trash2 />} label="Trash" count={counts?.trash} />
          <NavItem href="/settings" active={pathname === "/settings"} icon={<Settings />} label="Settings" />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="self-end"
        >
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </>
  );
}

function NewCollectionButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const invalidate = useInvalidate();
  const router = useRouter();
  const create = async () => {
    if (!name.trim()) return;
    try {
      const c = await api<{ id: string }>("/api/collections", { method: "POST", json: { name } });
      invalidate();
      setOpen(false);
      setName("");
      router.push(`/collections/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create collection");
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="New collection" className="normal-case">
          <FolderPlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
          className="flex gap-2"
        >
          <Input autoFocus placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
