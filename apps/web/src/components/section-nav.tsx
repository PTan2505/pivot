"use client";

import {
  AppWindow,
  Blocks,
  ChevronDown,
  Lightbulb,
  Orbit,
  Shapes,
  SwatchBook,
  Type as TypeIcon2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavigationMenu } from "radix-ui";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
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
import { TypeIcon } from "@/components/type-icon";
import { sectionHref } from "@/hooks/use-library-params";
import { useCounts, useResources } from "@/lib/api";
import { cn } from "@/lib/utils";

const pill =
  "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[15px] font-medium transition-colors duration-150 max-sm:px-3";
const idle =
  "text-ink-secondary hover:bg-surface hover:text-ink data-[state=open]:bg-surface data-[state=open]:text-ink";
const on = "bg-inverse text-on-inverse";

/**
 * Library · Knowledge · Sources · Skills. Hovering a section with several types opens a panel of them, each with a
 * one-line description. Moving between sections slides the panel to the new one and resizes it while the content
 * slides in from that side. Clicking a section opens its landing page (its type folders); ↓ opens the panel.
 */
export function SectionNav() {
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

  const [value, setValue] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState(0);
  // The first open appears in place; only moves between sections glide.
  const [instant, setInstant] = useState(true);

  // Park the panel under its section.
  const change = (next: string) => {
    if (next) {
      const trigger = list.current?.querySelector<HTMLElement>(`[data-section="${next}"]`);
      if (trigger) setOffset(trigger.offsetLeft);
      setInstant(!value);
    }
    setValue(next);
  };

  const openWithKeyboard = (e: KeyboardEvent, id: string) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    change(id);
    // let the panel mount, then move focus into it
    setTimeout(() => document.querySelector<HTMLElement>("[data-section-panel] a")?.focus(), 50);
  };

  return (
    <NavigationMenu.Root
      value={value}
      onValueChange={change}
      delayDuration={60}
      aria-label="Sections"
      className="relative z-40 min-w-0"
    >
      <NavigationMenu.List ref={list} className="flex flex-wrap items-center gap-1">
        {SECTIONS.map((s) =>
          s.types.length > 1 || s.id === "sources" ? (
            <NavigationMenu.Item key={s.id} value={s.id}>
              <NavigationMenu.Trigger asChild>
                <Link
                  href={sectionHref(s)}
                  data-section={s.id}
                  aria-current={
                    active === s.id && (s.types.length > 1 ? !currentType : !currentCategory) ? "page" : undefined
                  }
                  onClick={() => setValue("")}
                  onKeyDown={(e) => openWithKeyboard(e, s.id)}
                  className={cn(pill, "group gap-1 sm:pr-3", active === s.id ? on : idle)}
                >
                  {s.label}
                  <ChevronDown
                    aria-hidden
                    className="size-3.5 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180 max-sm:hidden"
                  />
                </Link>
              </NavigationMenu.Trigger>
              <NavigationMenu.Content data-section-panel className="section-panel-content">
                {s.id === "sources" ? (
                  <SourcePanel currentCategory={currentCategory} onPick={() => setValue("")} />
                ) : (
                  <TypePanel section={s} currentType={currentType} onPick={() => setValue("")} />
                )}
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          ) : (
            <NavigationMenu.Item key={s.id}>
              <NavigationMenu.Link asChild active={active === s.id}>
                <Link
                  href={sectionHref(s)}
                  aria-current={active === s.id ? "page" : undefined}
                  className={cn(pill, active === s.id ? on : idle)}
                >
                  {s.label}
                </Link>
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          ),
        )}
      </NavigationMenu.List>

      <div
        className="section-panel-position absolute top-full left-0 pt-2"
        data-instant={instant || undefined}
        style={{ "--section-panel-x": `${offset}px` } as CSSProperties}
      >
        <NavigationMenu.Viewport className="section-panel-viewport overflow-hidden rounded-[20px] bg-surface-raised shadow-overlay" />
      </div>
    </NavigationMenu.Root>
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

/** The grid of choices inside a section's panel: icon tile, name and count, then a one-line description. */
function OptionGrid({ options, onPick }: { options: PanelOption[]; onPick: () => void }) {
  return (
    <ul className="grid w-[min(600px,calc(100vw-32px))] grid-cols-1 gap-1 p-2 sm:grid-cols-2">
      {options.map((o) => (
        <li key={o.key}>
          <NavigationMenu.Link asChild active={o.current}>
            <Link
              href={o.href}
              onClick={onPick}
              className={cn(
                "flex gap-3 rounded-[12px] p-3 transition-colors duration-100 outline-none hover:bg-surface focus-visible:bg-surface",
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
                <span className="mt-0.5 block text-[14px] leading-[1.4] text-ink-muted">{o.blurb}</span>
              </span>
            </Link>
          </NavigationMenu.Link>
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
