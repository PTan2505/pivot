"use client";

import { gsap } from "gsap";
import {
  AppWindow,
  Blocks,
  BookOpen,
  ChevronDown,
  Globe,
  Layers,
  Lightbulb,
  Orbit,
  Shapes,
  Sparkles,
  SwatchBook,
  Type as TypeIcon2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  isResourceType,
  isSectionId,
  SECTIONS,
  sectionOf,
  SOURCE_CATEGORIES,
  TYPE_DEFS,
  type Section,
  type SectionId,
  type SourceCategory,
} from "@pivot/core/types";
import { clip, clipTo, eases, reducedMotion, useIndicator } from "@/components/nav-motion";
import { TypeIcon } from "@/components/type-icon";
import { sectionHref } from "@/hooks/use-library-params";
import { useCounts, useResources } from "@/lib/api";
import { cn } from "@/lib/utils";

export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  library: Layers,
  knowledge: BookOpen,
  sources: Globe,
  skills: Sparkles,
};

/** The section the page belongs to (the library list only), its type and, for sources, its category. */
export function useActiveSection() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const type = sp.get("type");
  const sectionParam = sp.get("section");
  const active: SectionId | null =
    pathname !== "/"
      ? null
      : isResourceType(type)
        ? sectionOf(type).id
        : isSectionId(sectionParam)
          ? sectionParam
          : "library";
  const currentType = isResourceType(type) ? type : null;
  const currentCategory = currentType === "source" ? sp.get("category") : null;
  return { active, currentType, currentCategory, routeKey: `${pathname}?${sp.toString()}` };
}

/** A section opened by click moves the highlight at once, before the route has resolved; the route then takes over. */
export function useOptimisticSection(active: SectionId | null, routeKey: string) {
  const [pending, setPending] = useState<{ id: SectionId; from: string } | null>(null);
  const shown = pending && pending.from === routeKey ? pending.id : active;
  return [shown, (id: SectionId) => setPending({ id, from: routeKey })] as const;
}

const hasPanel = (s: Section) => s.types.length > 1 || s.id === "sources";
type PanelKey = SectionId;

const item =
  "relative flex h-9 shrink-0 items-center rounded-full text-[15px] font-medium whitespace-nowrap text-ink transition-colors duration-150 pointer-fine:hover:bg-ink/7";
const focus = "outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text";

/**
 * Library · Knowledge · Sources · Skills in the top bar's capsule. The name opens the section; the chevron (or ↓ on
 * the name) opens a panel of its types, or of the source categories. Once a panel is open, pointing at another
 * section moves it there. An inverse copy of the list, clipped to the current section, slides between them (M1).
 */
export function SectionNav() {
  const { active, currentType, currentCategory, routeKey } = useActiveSection();
  const [shown, select] = useOptimisticSection(active, routeKey);
  const listRef = useRef<HTMLUListElement>(null);
  const indRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<PanelKey | null>(null);
  const [mounted, setMounted] = useState(false);
  const openRef = useRef<PanelKey | null>(null);
  const prev = useRef<PanelKey | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);

  useIndicator(listRef, indRef, shown, 999);

  const show = (key: PanelKey | null, focusFirst = false) => {
    if (key) setMounted(true);
    setOpen(key);
    if (key && focusFirst)
      requestAnimationFrame(() =>
        panelRef.current?.querySelector<HTMLElement>(`[data-for="${key}"] a`)?.focus({ preventScroll: true }),
      );
  };

  // Leaving the page closes the panel.
  const [lastRoute, setLastRoute] = useState(routeKey);
  if (lastRoute !== routeKey) {
    setLastRoute(routeKey);
    setOpen(null);
  }

  // M4: open from the section, morph between sections, close back toward it.
  useLayoutEffect(() => {
    openRef.current = open;
    const from = prev.current;
    prev.current = open;
    const panel = panelRef.current;
    const bg = bgRef.current;
    const list = listRef.current;
    if (!panel || !bg || !list || from === open) return;
    eases();
    const R = reducedMotion();
    const geom = (key: PanelKey) => {
      const content = panel.querySelector<HTMLElement>(`[data-for="${key}"]`)!;
      const trigger = list.querySelector<HTMLElement>(`:scope > [data-key="${key}"]`)!;
      const pw = panel.offsetWidth;
      const cw = content.offsetWidth;
      const ch = content.offsetHeight;
      const cl = Math.max(0, Math.min(pw - cw - 16, trigger.offsetLeft - 8));
      return { content, cl, bg: clip(0, pw - (cl + cw + 16), panel.offsetHeight - (ch + 16), cl, 20) };
    };
    if (open && !from) {
      panel.style.display = "block";
      const g = geom(open);
      panel.querySelectorAll<HTMLElement>("[data-for]").forEach((c) =>
        gsap.set(c, {
          opacity: c === g.content ? 1 : 0,
          x: 0,
          left: g.cl + 8,
          visibility: c === g.content ? "visible" : "hidden",
        }),
      );
      gsap.set(bg, { clipPath: g.bg });
      panel.style.transformOrigin = `${g.cl + 40}px 0px`;
      gsap.fromTo(
        panel,
        { opacity: 0, scale: R ? 1 : 0.97 },
        { opacity: 1, scale: 1, duration: R ? 0.12 : 0.18, ease: R ? "none" : "pivot-out", overwrite: true },
      );
    } else if (open && from) {
      const was = geom(from);
      const g = geom(open);
      const dir = g.cl >= was.cl ? 1 : -1;
      gsap.set(g.content, { left: g.cl + 8, visibility: "visible" });
      const hide = () => gsap.set(was.content, { visibility: "hidden" });
      if (R) {
        gsap.set(bg, { clipPath: g.bg });
        gsap.to(was.content, { opacity: 0, duration: 0.1, overwrite: true, onComplete: hide });
        gsap.fromTo(g.content, { opacity: 0, x: 0 }, { opacity: 1, duration: 0.12, overwrite: true });
      } else {
        clipTo(bg, g.bg, { duration: 0.27, ease: "pivot-panel", overwrite: true });
        gsap.to(was.content, {
          opacity: 0,
          x: -8 * dir,
          duration: 0.1,
          ease: "pivot-out",
          overwrite: true,
          onComplete: hide,
        });
        gsap.fromTo(
          g.content,
          { opacity: 0, x: 8 * dir },
          { opacity: 1, x: 0, duration: 0.15, delay: 0.1, ease: "pivot-out", overwrite: true },
        );
      }
    } else {
      gsap.to(panel, {
        opacity: 0,
        scale: R ? 1 : 0.97,
        duration: R ? 0.12 : 0.14,
        ease: "pivot-out",
        overwrite: true,
        onComplete: () => {
          if (!openRef.current) panel.style.display = "none";
        },
      });
    }
  }, [open, mounted]);

  // Outside clicks, Escape, focus leaving the nav, and scrolling the bar into its compact form close the panel.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || (t as Element).closest?.("[data-panel-trigger]")) return;
      setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(null);
      listRef.current?.querySelector<HTMLElement>(`[data-key="${open}"] [data-panel-trigger]`)?.focus();
    };
    const close = () => setOpen(null);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("pivot:condense", close);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("pivot:condense", close);
    };
  }, [open]);

  const onPanelKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const box = panelRef.current?.querySelector(`[data-for="${open}"]`);
    if (!box) return;
    const links = [...box.querySelectorAll<HTMLElement>("a")];
    const i = links.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus({ preventScroll: true });
  };

  const items = (copy: boolean) =>
    SECTIONS.map((s) => {
      const panel = hasPanel(s);
      const current = active === s.id && (panel && s.types.length > 1 ? !currentType : !currentCategory);
      if (copy)
        return (
          <div key={s.id} className={item}>
            <span className={panel ? "pr-0.5 pl-3.5" : "px-3.5"}>{s.label}</span>
            {panel && (
              <span className="mr-1 grid size-6 place-items-center opacity-70">
                <ChevronDown className="size-3.5" />
              </span>
            )}
          </div>
        );
      return (
        <li
          key={s.id}
          data-key={s.id}
          data-active={shown === s.id || undefined}
          className={item}
          onPointerEnter={() => {
            // a short pause, so a diagonal move toward the open panel can cross a neighbour without switching
            if (panel && openRef.current && openRef.current !== s.id)
              hover.current = setTimeout(() => openRef.current && show(s.id), 120);
          }}
          onPointerLeave={() => clearTimeout(hover.current)}
        >
          <Link
            href={sectionHref(s)}
            aria-current={current ? "page" : undefined}
            onClick={() => {
              select(s.id);
              setOpen(null);
            }}
            onKeyDown={(e) => {
              if (panel && e.key === "ArrowDown") {
                e.preventDefault();
                show(s.id, true);
              }
            }}
            className={cn("flex h-full items-center rounded-full", panel ? "pr-0.5 pl-3.5" : "px-3.5", focus)}
          >
            {s.label}
          </Link>
          {panel && (
            <button
              type="button"
              data-panel-trigger
              aria-label={`${s.label} ${s.id === "sources" ? "categories" : "types"}`}
              aria-expanded={open === s.id}
              aria-controls="section-panel"
              onClick={(e) => show(open === s.id ? null : s.id, e.detail === 0)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  show(s.id, true);
                }
              }}
              className={cn("mr-1 grid size-6 place-items-center rounded-full opacity-70", focus)}
            >
              <ChevronDown
                aria-hidden
                className={cn("size-3.5 transition-transform duration-200", open === s.id && "rotate-180")}
              />
            </button>
          )}
        </li>
      );
    });

  return (
    <nav
      ref={navRef}
      aria-label="Main"
      className="relative"
      onBlur={(e) => {
        // Tab leaving the nav closes it; pointer moves are handled by the outside-click listener
        const to = e.relatedTarget as Node | null;
        if (open && to && !navRef.current?.contains(to)) setOpen(null);
      }}
    >
      <div data-nav-list className="relative">
        <ul ref={listRef} className="flex items-center gap-0.5">
          {items(false)}
        </ul>
        <div
          ref={indRef}
          aria-hidden
          inert
          className="nav-ind pointer-events-none absolute inset-0 flex items-center gap-0.5 bg-inverse text-on-inverse [&_*]:text-on-inverse"
          style={{ clipPath: "inset(0px 100% 0px 0px round 999px)" }}
        >
          {items(true)}
        </div>
      </div>

      {/* An oversized, click-through box: its glass is clipped to the open section's options and morphs between them. */}
      <div
        ref={panelRef}
        id="section-panel"
        className="pointer-events-none absolute top-[calc(100%+14px)] -left-2 z-50 hidden h-[440px] w-[min(980px,calc(100vw-48px))]"
        onKeyDown={onPanelKey}
      >
        <div ref={bgRef} aria-hidden className="glass-strong absolute inset-0 rounded-none border-0" />
        {mounted && (
          <>
            <PanelContent for="library" label="Library types">
              <TypePanel section={SECTIONS[0]} currentType={currentType} onPick={() => setOpen(null)} />
            </PanelContent>
            <PanelContent for="knowledge" label="Knowledge types">
              <TypePanel section={SECTIONS[1]} currentType={currentType} onPick={() => setOpen(null)} />
            </PanelContent>
            <PanelContent for="sources" label="Source categories">
              <SourcePanel currentCategory={currentCategory} onPick={() => setOpen(null)} />
            </PanelContent>
          </>
        )}
      </div>
    </nav>
  );
}

function PanelContent({ for: key, label, children }: { for: PanelKey; label: string; children: ReactNode }) {
  return (
    <div data-for={key} role="group" aria-label={label} className="pointer-events-auto invisible absolute top-2">
      {children}
    </div>
  );
}

interface PanelOption {
  key: string;
  href: string;
  icon: ReactNode;
  title: string;
  blurb: string;
  count: number;
  current: boolean;
}

/** The choices inside a section's panel: icon tile, name and count, then a one-line description. */
function OptionGrid({ options, onPick }: { options: PanelOption[]; onPick: () => void }) {
  return (
    <ul className={cn("grid gap-0.5", options.length > 5 ? "w-[600px] grid-cols-2" : "w-[340px] grid-cols-1")}>
      {options.map((o) => (
        <li key={o.key}>
          <Link
            href={o.href}
            onClick={onPick}
            aria-current={o.current ? "page" : undefined}
            className={cn(
              "flex items-start gap-3 rounded-[12px] p-2.5 transition-colors duration-100 outline-none hover:bg-surface focus-visible:bg-surface focus-visible:outline-2 focus-visible:outline-accent-text",
              o.current && "bg-surface",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-surface text-ink-secondary [&_svg]:size-[18px]">
              {o.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[15px] font-medium text-ink">{o.title}</span>
                <span className="ml-auto font-mono text-[12px] text-ink-subtle tabular-nums">{o.count}</span>
              </span>
              <span className="mt-0.5 block text-[14px] leading-[1.35] text-ink-muted">{o.blurb}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Library, Knowledge: their types. */
function TypePanel({
  section,
  currentType,
  onPick,
}: {
  section: Section;
  currentType: string | null;
  onPick: () => void;
}) {
  const { data: counts } = useCounts();
  return (
    <OptionGrid
      onPick={onPick}
      options={section.types.map((t) => ({
        key: t,
        href: `/?type=${t}`,
        icon: <TypeIcon type={t} />,
        title: TYPE_DEFS[t].plural,
        blurb: TYPE_DEFS[t].blurb,
        count: counts?.[t] ?? 0,
        current: currentType === t,
      }))}
    />
  );
}

const CATEGORY_ICONS: Record<SourceCategory, LucideIcon> = {
  inspiration: Lightbulb,
  "product-ui": AppWindow,
  "styles-systems": SwatchBook,
  components: Blocks,
  motion: Orbit,
  "type-color": TypeIcon2,
  assets: Shapes,
};

/** Sources: one type, so its panel lists the source categories instead. */
function SourcePanel({ currentCategory, onPick }: { currentCategory: string | null; onPick: () => void }) {
  const { data: sources = [] } = useResources({ type: "source" });
  return (
    <OptionGrid
      onPick={onPick}
      options={SOURCE_CATEGORIES.map((c) => {
        const Icon = CATEGORY_ICONS[c.value];
        return {
          key: c.value,
          href: `/?type=source&category=${c.value}`,
          icon: <Icon />,
          title: c.label,
          blurb: c.hint,
          count: sources.filter((r) => r.meta.category === c.value).length,
          current: currentCategory === c.value,
        };
      })}
    />
  );
}
