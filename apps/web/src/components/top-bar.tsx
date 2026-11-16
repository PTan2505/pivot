"use client";

import { gsap } from "gsap";
import { Ellipsis, Folder, FolderPlus, Inbox, PenTool, Search, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import { isResourceType, SECTIONS } from "@pivot/core/types";
import { AddMenu } from "@/components/add-menu";
import { PivotMark, PivotWordmark } from "@/components/brand";
import { clip, clipTo, eases, reducedMotion, useIndicator, useScrollDirection } from "@/components/nav-motion";
import { SECTION_ICONS, SectionNav, useActiveSection, useOptimisticSection } from "@/components/section-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { sectionHref } from "@/hooks/use-library-params";
import { api, useCollections, useCounts, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

const LIBRARY_ROUTES = /^\/($|collections\/|trash$)/;
const focus = "outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text";
const wide = () => window.matchMedia("(min-width: 64rem)").matches;

/**
 * The top bar, direction "1 · Floating capsule" with the owner's major change "6 · Full width, then capsule · A content
 * stays" (design session "PIVOT navbar redesign", approved 2026-11-16). From 1024px: at the top of the page a glass bar
 * 72px tall across the full width, holding the logo, the four sections, a 320px search pill, Inbox (only while
 * something waits), More and Add inside a 1240px frame. Scrolling down shrinks the glass into a capsule 1240×60px,
 * 12px below the top (M2′); the content stays in its frame and drops 6px. Below 1024px: a full-width 64px row (logo,
 * search, Inbox) that shrinks into a 56px capsule the same way, and a dock at the bottom with the sections, More and
 * Add (M5). The bar is fixed and the page starts below it: its measured height is `--topbar-h`, which shrinking never
 * changes.
 */
export function TopBar() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const type = sp.get("type");
  const barRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const phoneShellRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const prowRef = useRef<HTMLDivElement>(null);
  const phoneSearchRef = useRef<HTMLButtonElement>(null);
  const deskFieldRef = useRef<HTMLDivElement>(null);
  const phoneFieldRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [newCollection, setNewCollection] = useState(false);
  const preferType = pathname === "/" && isResourceType(type) ? type : undefined;

  // The page starts below the bar.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--topbar-h", `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // M2′: shrink the full-width glass into the capsule. Built on the first condense, for the layout showing (desktop or
  // phone), from the bar at rest; a width change throws it away. Only clip-path and transforms move.
  const shrink = useRef<gsap.core.Timeline | null>(null);
  const buildShrink = () => {
    const desk = wide();
    const shell = desk ? shellRef.current : phoneShellRef.current;
    const row = desk ? rowRef.current : prowRef.current;
    if (!shell || !row || !shell.getClientRects().length) return null;
    eases();
    const X = desk ? Math.max(24, (shell.offsetWidth - 1240) / 2) : 12;
    const capsule = desk ? clip(12, X, 0, X, 30) : clip(8, X, 0, X, 28);
    return gsap
      .timeline({ paused: true, defaults: { duration: 0.27, ease: "pivot-panel" } })
      .fromTo(shell, { clipPath: "inset(0px 0px 0px 0px round 0px)" }, { clipPath: capsule }, 0)
      .to(row, { y: desk ? 6 : 4 }, 0);
  };
  const setCondensed = (on: boolean) => {
    window.dispatchEvent(new Event("pivot:condense"));
    // the glass's edge: a bottom hairline across the page, a ring around the capsule
    barRef.current?.toggleAttribute("data-condensed", on);
    if (on && !shrink.current) shrink.current = buildShrink();
    const tl = shrink.current;
    if (!tl) return;
    if (reducedMotion()) tl.progress(on ? 1 : 0).pause();
    else if (on) tl.play();
    else tl.reverse();
  };

  // M5: the phone dock slides away while scrolling down, and is back at the page end or when focused.
  const dockHidden = useRef(false);
  const setDock = (hidden: boolean) => {
    const dock = dockRef.current;
    if (!dock || wide()) return;
    if (hidden && dock.contains(document.activeElement)) hidden = false;
    if (dockHidden.current === hidden) return;
    dockHidden.current = hidden;
    eases();
    const h = dock.offsetHeight + 12 + 24;
    if (reducedMotion())
      gsap.to(dock, { opacity: hidden ? 0 : 1, y: 0, duration: 0.15, ease: "none", overwrite: true });
    else gsap.to(dock, { y: hidden ? h : 0, opacity: 1, duration: 0.24, ease: "pivot-glide", overwrite: true });
    dock.toggleAttribute("inert", hidden);
  };

  useScrollDirection(setCondensed, (down) => {
    const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 64;
    setDock(down && !atEnd);
  });

  // A change of width resets the bar to rest; height-only resizes (a phone browser's toolbar folding while scrolling)
  // leave it alone.
  useEffect(() => {
    let width = window.innerWidth;
    const reset = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      window.dispatchEvent(new Event("pivot:nav-reset"));
      shrink.current?.progress(0).kill();
      shrink.current = null;
      barRef.current?.removeAttribute("data-condensed");
      gsap.set([shellRef.current, rowRef.current, phoneShellRef.current, prowRef.current], {
        clearProps: "transform,clipPath",
      });
      dockHidden.current = false;
      if (dockRef.current) {
        gsap.set(dockRef.current, { clearProps: "transform,opacity" });
        dockRef.current.removeAttribute("inert");
      }
    };
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);

  const search = useSearch({
    desk: { host: rowRef, trigger: pillRef, field: deskFieldRef, width: 400 },
    phone: { host: prowRef, trigger: phoneSearchRef, field: phoneFieldRef, width: 600 },
  });

  const more = (side: "top" | "bottom", trigger: ReactNode) => (
    <MoreMenu side={side} onNewCollection={() => setNewCollection(true)}>
      {trigger}
    </MoreMenu>
  );

  return (
    <>
      <a
        href="#main"
        className="fixed top-[-60px] left-3 z-[60] rounded-full bg-inverse px-3.5 py-2 font-medium text-on-inverse focus:top-3"
      >
        Skip to content
      </a>
      <header ref={barRef} className="pointer-events-none fixed inset-x-0 top-0 z-40">
        {/* desktop: the full-width glass (clip-path shrinks it into the capsule; it also clips its hit area) and the
            content, which stays in the 1240px frame */}
        <div className="relative h-[72px] max-lg:hidden">
          <div ref={shellRef} aria-hidden className="nav-shell pointer-events-auto absolute inset-0" />
          <div
            ref={rowRef}
            className="pointer-events-auto absolute top-1.5 right-[max(24px,calc((100%-1240px)/2))] left-[max(24px,calc((100%-1240px)/2))] flex h-[60px] items-center justify-between gap-4 pr-3 pl-[22px]"
          >
            <div className="flex min-w-0 items-center gap-[22px]">
              <Logo />
              <SectionNav />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                ref={pillRef}
                type="button"
                aria-label="Search PIVOT"
                aria-expanded={search.open === "desk"}
                onClick={() => search.show("desk")}
                className={cn(
                  "flex h-10 w-80 shrink-0 items-center gap-2.5 rounded-full bg-surface px-3.5 text-[15px] text-ink-muted max-xl:w-52",
                  focus,
                )}
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate text-left">Search PIVOT</span>
                <kbd className="rounded-md border border-divider px-1.5 font-mono text-xs text-ink-subtle">⌘K</kbd>
              </button>
              <InboxLink data-nb className="size-9" />
              {more(
                "bottom",
                <Button
                  data-nb
                  variant="secondary"
                  size="icon"
                  aria-label="More: collections, design sessions, settings, trash"
                >
                  <Ellipsis />
                </Button>,
              )}
              <div data-nb>
                <AddMenu preferType={preferType} onNewCollection={() => setNewCollection(true)} />
              </div>
            </div>
            <SearchField fieldRef={deskFieldRef} search={search} host="desk" />
          </div>
        </div>

        {/* phone and tablet: a full-width row that shrinks into a 56px capsule */}
        <div className="relative h-16 lg:hidden">
          <div ref={phoneShellRef} aria-hidden className="nav-shell pointer-events-auto absolute inset-0" />
          <div ref={prowRef} className="pointer-events-auto relative flex h-full items-center gap-1 pr-5 pl-7">
            <Logo data-nb className="mr-auto" />
            <button
              ref={phoneSearchRef}
              type="button"
              data-nb
              aria-label="Search PIVOT"
              aria-expanded={search.open === "phone"}
              onClick={() => search.show("phone")}
              className={cn("grid size-11 place-items-center rounded-full text-ink [&_svg]:size-5", focus)}
            >
              <Search aria-hidden />
            </button>
            <InboxLink data-nb className="size-11 bg-transparent [&_svg]:size-5" />
            <SearchField fieldRef={phoneFieldRef} search={search} host="phone" />
          </div>
        </div>
      </header>

      <PhoneDock
        dockRef={dockRef}
        more={more}
        add={<AddMenu fab preferType={preferType} onNewCollection={() => setNewCollection(true)} />}
      />
      <NewCollectionDialog open={newCollection} onOpenChange={setNewCollection} />
    </>
  );
}

function Logo({ className, ...rest }: { className?: string; "data-nb"?: boolean }) {
  return (
    <Link
      {...rest}
      href="/"
      aria-label="PIVOT home"
      className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full text-ink", focus, className)}
    >
      <PivotMark className="h-6" />
      <PivotWordmark className="h-3.5" />
    </Link>
  );
}

/** Inbox: quick saves and suggestions waiting for review. Only there while something waits. */
function InboxLink({ className, ...rest }: { className?: string; "data-nb"?: boolean }) {
  const { data: counts } = useCounts();
  const n = (counts?.inbox ?? 0) + (counts?.suggestions ?? 0);
  if (!n) return null;
  return (
    <Link
      href="/?review=needs"
      aria-label={`Inbox, ${n} waiting`}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-surface text-ink-secondary transition-colors duration-150 hover:bg-surface-raised hover:text-ink [&_svg]:size-4",
        focus,
        className,
      )}
      {...rest}
    >
      <Inbox aria-hidden />
      <span className="absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] rounded-full bg-inverse px-1 text-center font-mono text-[12px] leading-[18px] font-medium text-on-inverse">
        {n}
      </span>
    </Link>
  );
}

/** More: the destinations (Collections, Design sessions), a divider, then the utilities (Settings, Trash). */
function MoreMenu({
  side,
  children,
  onNewCollection,
}: {
  side: "top" | "bottom";
  children: ReactNode;
  onNewCollection: () => void;
}) {
  const router = useRouter();
  const { data: counts } = useCounts();
  const { data: collections = [] } = useCollections();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" sideOffset={8} className="w-[232px] rounded-[14px] p-1.5">
        <DropdownMenuLabel className="text-xs font-normal text-ink-muted">Go to</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-9">
            <Folder /> Collections
            <span className="ml-auto font-mono text-[12px] text-ink-muted tabular-nums">{collections.length}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64 p-1.5">
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
            <DropdownMenuItem onSelect={() => setTimeout(onNewCollection, 0)}>
              <FolderPlus /> New collection…
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem className="h-9" onSelect={() => router.push("/design")}>
          <PenTool /> Design sessions
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-9" onSelect={() => router.push("/settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem className="h-9" onSelect={() => router.push("/trash")}>
          <Trash2 /> Trash
          {!!counts?.trash && (
            <span className="ml-auto font-mono text-[12px] text-ink-muted tabular-nums">{counts.trash}</span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Below 1024px: the four sections and More in a glass dock at the bottom, Add apart in ember. */
function PhoneDock({
  dockRef,
  more,
  add,
}: {
  dockRef: RefObject<HTMLDivElement | null>;
  more: (side: "top" | "bottom", trigger: ReactNode) => ReactNode;
  add: ReactNode;
}) {
  const { active, routeKey } = useActiveSection();
  const [shown, select] = useOptimisticSection(active, routeKey);
  const listRef = useRef<HTMLDivElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  useIndicator(listRef, indRef, shown, 16);
  const cell =
    "relative flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 text-[12px] leading-4 font-medium text-ink max-[359px]:min-w-11 [&_svg]:size-5";

  return (
    <div
      ref={dockRef}
      data-dock
      className="pointer-events-none fixed inset-x-0 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex items-center justify-center gap-2 lg:hidden [&>*]:pointer-events-auto"
    >
      <nav aria-label="Sections" className="glass-strong flex gap-0.5 rounded-[24px] p-1.5">
        <div data-nav-list className="relative">
          <div ref={listRef} className="flex gap-0.5">
            {SECTIONS.map((s) => {
              const Icon = SECTION_ICONS[s.id];
              return (
                <Link
                  key={s.id}
                  href={sectionHref(s)}
                  data-key={s.id}
                  data-active={shown === s.id || undefined}
                  aria-current={active === s.id ? "page" : undefined}
                  onClick={() => select(s.id)}
                  className={cn(cell, focus)}
                >
                  <Icon aria-hidden />
                  <span className="max-[359px]:sr-only">{s.label}</span>
                </Link>
              );
            })}
          </div>
          <div
            ref={indRef}
            aria-hidden
            inert
            className="pointer-events-none absolute inset-0 flex gap-0.5 bg-inverse text-on-inverse"
            style={{ clipPath: "inset(0px 100% 0px 0px round 16px)" }}
          >
            {SECTIONS.map((s) => {
              const Icon = SECTION_ICONS[s.id];
              return (
                <div key={s.id} className={cn(cell, "text-on-inverse")}>
                  <Icon />
                  <span className="max-[359px]:sr-only">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        {more(
          "top",
          <button
            type="button"
            aria-label="More: collections, design sessions, settings, trash"
            className={cn(cell, focus)}
          >
            <Ellipsis aria-hidden />
            <span className="max-[359px]:sr-only">More</span>
          </button>,
        )}
      </nav>
      {add}
    </div>
  );
}

function NewCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    try {
      const c = await api<{ id: string }>("/api/collections", { method: "POST", json: { name } });
      invalidate();
      onOpenChange(false);
      setName("");
      router.push(`/collections/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create collection");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}

/* ---------- M3: search ---------- */

type Host = "desk" | "phone";
interface HostRefs {
  host: RefObject<HTMLElement | null>;
  trigger: RefObject<HTMLElement | null>;
  field: RefObject<HTMLDivElement | null>;
  width: number;
  rect?: () => DOMRect;
}

/**
 * The search field filters the current library view; elsewhere Enter jumps to the library with the query. It lives
 * folded in a pill (or the phone's search icon) and grows from it over its neighbours (`data-nb`), which fade and stop
 * taking clicks. It folds back on Escape, or on blur when empty; `/` opens it at once; ⌘K stays the command palette.
 */
function useSearch(hosts: Record<Host, HostRefs>) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const onLibrary = LIBRARY_ROUTES.test(pathname);
  const urlQuery = onLibrary ? (sp.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  const [open, setOpen] = useState<Host | null>(null);
  const instant = useRef(false);
  const wantFocus = useRef(false);
  const focusBack = useRef(false);
  const shown = useRef<{ host: Host; nb: HTMLElement[] } | null>(null);

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

  const visibleHost = (): Host => (wide() ? "desk" : "phone");
  const show = (host: Host, now = false) => {
    instant.current = now;
    wantFocus.current = true;
    if (open === host) hosts[host].field.current?.querySelector("input")?.focus();
    else setOpen(host);
  };
  const hide = (back: boolean) => {
    focusBack.current = back;
    setOpen(null);
  };

  // A query in the URL keeps the field open (a reload, Back, a link with ?q=); clearing it elsewhere folds it.
  useEffect(() => {
    if (urlQuery && !open) {
      instant.current = true;
      // which host shows the field depends on the viewport, known only here on the client
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(visibleHost());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQuery]);

  // "/" opens search from anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      const dialog = document.querySelector('[role="dialog"],[role="menu"]');
      if (e.key === "/" && !typing && !dialog && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        show(visibleHost(), true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A resize across the breakpoint moves an open field to the other host.
  useEffect(() => {
    const onResize = () => {
      if (!shown.current) return;
      const h = visibleHost();
      if (h !== shown.current.host) {
        instant.current = true;
        setOpen(h);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const geom = (h: Host) => {
      const { host, trigger, field, width, rect } = hosts[h];
      const hr = host.current!.getBoundingClientRect();
      const pr = rect ? rect() : trigger.current!.getBoundingClientRect();
      const W = Math.min(hr.width - 16, Math.max(width, pr.width));
      let left = pr.width >= W - 1 ? pr.left - hr.left : pr.left + pr.width / 2 - W / 2 - hr.left;
      left = Math.max(8, Math.min(hr.width - 8 - W, left));
      const top = pr.top + pr.height / 2 - 20 - hr.top;
      const from = clip(
        pr.top - hr.top - top,
        left + W - (pr.right - hr.left),
        top + 40 - (pr.bottom - hr.top),
        pr.left - hr.left - left,
        999,
      );
      return { field: field.current!, host: host.current!, hr, left, top, W, from };
    };
    const R = reducedMotion();
    eases();
    const prev = shown.current;
    if (prev && prev.host !== open) {
      // fold the previous field back into its trigger
      shown.current = null;
      const g = geom(prev.host);
      const done = () => gsap.set(g.field, { visibility: "hidden" });
      if (R || open) {
        done();
        gsap.set(prev.nb, { opacity: 1, pointerEvents: "" });
        prev.nb.forEach((e) => e.removeAttribute("inert"));
      } else {
        clipTo(g.field, g.from, { duration: 0.15, ease: "pivot-panel", overwrite: true, onComplete: done });
        gsap.to(prev.nb, {
          opacity: 1,
          duration: 0.12,
          delay: 0.05,
          ease: "pivot-out",
          overwrite: true,
          onComplete: () => {
            gsap.set(prev.nb, { pointerEvents: "" });
            prev.nb.forEach((e) => e.removeAttribute("inert"));
          },
        });
      }
      if (focusBack.current) hosts[prev.host].trigger.current?.focus({ preventScroll: true });
      focusBack.current = false;
    }
    if (open && (!prev || prev.host !== open)) {
      const g = geom(open);
      const a = g.hr.left + g.left;
      const b = a + g.W;
      const nb = [...g.host.querySelectorAll<HTMLElement>("[data-nb]")].filter((e) => {
        if (!e.getClientRects().length) return false;
        const r = e.getBoundingClientRect();
        return r.right > a - 4 && r.left < b + 4;
      });
      shown.current = { host: open, nb };
      gsap.set(g.field, { left: g.left, top: g.top, width: g.W, visibility: "visible" });
      // covered neighbours leave the tab order too, so focus never lands on something hidden
      gsap.set(nb, { pointerEvents: "none" });
      nb.forEach((e) => e.setAttribute("inert", ""));
      if (instant.current || R) {
        gsap.set(g.field, { clipPath: clip(0, 0, 0, 0, 999) });
        gsap.set(nb, { opacity: 0 });
      } else {
        gsap.fromTo(
          g.field,
          { clipPath: g.from },
          { clipPath: clip(0, 0, 0, 0, 999), duration: 0.2, ease: "pivot-out", overwrite: true },
        );
        gsap.to(nb, { opacity: 0, duration: 0.12, ease: "pivot-out", overwrite: true });
      }
      instant.current = false;
      // focus only when asked for (a click, "/"), not when a query in the URL opened it
      if (wantFocus.current) g.field.querySelector("input")?.focus({ preventScroll: true });
      wantFocus.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return {
    open,
    value,
    setValue,
    show,
    onBlur: (input: HTMLInputElement) =>
      setTimeout(() => {
        if (!input.value && document.activeElement !== input) hide(false);
      }, 0),
    escape: () => {
      if (!shown.current) return;
      setValue("");
      hide(true);
    },
    submit: () => {
      if (!onLibrary && value.trim()) router.push(`/?q=${encodeURIComponent(value.trim())}`);
    },
  };
}

function SearchField({
  fieldRef,
  search,
  host,
}: {
  fieldRef: RefObject<HTMLDivElement | null>;
  search: ReturnType<typeof useSearch>;
  host: Host;
}) {
  return (
    <div
      ref={fieldRef}
      role="search"
      className="invisible absolute top-0 z-10 flex h-10 items-center gap-2.5 rounded-full bg-surface px-3.5 text-ink-muted shadow-[0_0_0_1px_var(--glass-edge)]"
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <input
        id={host === "desk" ? "global-search" : undefined}
        type="search"
        value={search.value}
        onChange={(e) => search.setValue(e.target.value)}
        onBlur={(e) => search.onBlur(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") search.submit();
          if (e.key === "Escape") search.escape();
        }}
        placeholder="Search PIVOT"
        aria-label="Search PIVOT"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="rounded-md border border-divider px-1.5 font-mono text-xs text-ink-subtle">Esc</kbd>
    </div>
  );
}
