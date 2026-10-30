"use client";

import { Check, Copy, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { TAG_KIND_LABELS, TYPE_DEFS, type ResourceDTO } from "@pivot/core/types";
import { TypeIcon } from "@/components/type-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyResource } from "@/hooks/use-copy-resource";
import { assetUrl, faviconUrl } from "@/lib/api";
import { openableUrl } from "@/lib/url";
import { cn } from "@/lib/utils";

export function hostOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stop(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

/** Plain-text excerpt for a note card: no frontmatter, no markdown syntax. */
function excerpt(r: ResourceDTO) {
  if (r.type === "skill" && r.description) return r.description;
  return r.content
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[-*]\s+(\[[ x]\]\s*)?/gim, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function SelectBox({
  selected,
  onToggle,
  visible,
}: {
  selected: boolean;
  onToggle: (e: MouseEvent) => void;
  visible: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? "Deselect" : "Select"}
      onClick={(e) => {
        stop(e);
        onToggle(e);
      }}
      className={cn(
        "absolute top-3 left-3 grid size-6 place-items-center rounded-full border-2 transition-opacity duration-150",
        selected
          ? "border-inverse bg-inverse text-on-inverse opacity-100"
          : "border-ink-muted bg-surface-raised text-ink group-hover:opacity-100 focus-visible:opacity-100",
        !selected && (visible ? "opacity-100" : "opacity-0"),
      )}
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

function CardActions({ resource, glass, className }: { resource: ResourceDTO; glass?: boolean; className?: string }) {
  const copy = useCopyResource();
  const def = TYPE_DEFS[resource.type];
  const href = openableUrl(resource.sourceUrl);
  const pill = glass
    ? "grid size-7 place-items-center rounded-full bg-ink/10 text-ink transition-colors hover:bg-ink/16"
    : "grid size-8 place-items-center rounded-full bg-surface-raised text-ink-secondary transition-colors hover:text-ink";
  return (
    <div
      className={cn(
        "flex gap-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100",
        className,
      )}
    >
      {href && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={pill}
              aria-label="Open source URL"
              onClick={(e) => {
                stop(e);
                window.open(href, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Open source</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={pill}
            aria-label={def.content === "none" ? "Copy as context" : "Copy content"}
            onClick={(e) => {
              stop(e);
              copy(resource);
            }}
          >
            <Copy className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{def.content === "none" ? "Copy as context" : "Copy"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function Cover({ resource }: { resource: ResourceDTO }) {
  const colors = Array.isArray(resource.meta.colors) ? (resource.meta.colors as string[]) : [];
  if (resource.coverAssetId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={assetUrl(resource.coverAssetId, { thumb: true })}
        alt=""
        loading="lazy"
        className="size-full object-cover object-top"
        onError={(e) => {
          // SVG and video covers have no raster thumbnail; fall back to the original file.
          const img = e.currentTarget;
          if (!img.dataset.fallback) {
            img.dataset.fallback = "1";
            img.src = assetUrl(resource.coverAssetId!);
            img.className = "size-full object-contain p-8";
          }
        }}
      />
    );
  }
  if (colors.length) {
    return (
      <div className="flex size-full">
        {colors.slice(0, 8).map((c, i) => (
          <div key={`${c}-${i}`} className="h-full flex-1" style={{ background: c }} />
        ))}
      </div>
    );
  }
  if (resource.captureStatus === "pending") {
    return (
      <div className="grid size-full animate-pulse place-items-center text-[14px] text-ink-muted [animation-duration:1.6s]">
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Capturing…
        </span>
      </div>
    );
  }
  return (
    <div className="grid size-full place-items-center text-ink-subtle">
      {resource.captureStatus === "failed" ? (
        <ImageOff className="size-6" aria-label="No preview" />
      ) : (
        <TypeIcon type={resource.type} className="size-7" />
      )}
    </div>
  );
}

type FullShot = NonNullable<ResourceDTO["fullShot"]>;

/**
 * A reference's full-page screenshot in the 16:10 frame: it rests on the top of the page and, on hover or
 * keyboard focus, scrolls to the bottom at a steady pace like a screen recording, then glides back.
 */
function ScrollShot({ shot }: { shot: FullShot }) {
  const ratio = shot.width && shot.height ? shot.height / shot.width : 0;
  // The frame is 16:10, so the page is ratio / 0.625 frames tall; travel about one frame per second.
  const frames = ratio / 0.625 - 1;
  const scrolls = frames > 0.1;
  const seconds = Math.min(30, Math.max(1.5, frames * 1.1));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={assetUrl(shot.id, { preview: true })}
      alt=""
      loading="lazy"
      style={{ "--scroll-duration": `${seconds.toFixed(1)}s` } as CSSProperties}
      className={cn(
        "absolute inset-x-0 top-0 h-auto w-full max-w-none transition-transform duration-500 ease-out",
        scrolls &&
          "motion-safe:group-hover:[transform:translateY(calc(-100%_+_100cqh))] motion-safe:group-hover:[transition:transform_var(--scroll-duration)_linear] motion-safe:group-focus-visible:[transform:translateY(calc(-100%_+_100cqh))] motion-safe:group-focus-visible:[transition:transform_var(--scroll-duration)_linear]",
      )}
    />
  );
}

interface CardProps {
  resource: ResourceDTO;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: MouseEvent) => void;
  /** Replaces the line under the title. */
  meta?: string;
}

function metaLine(r: ResourceDTO) {
  const def = TYPE_DEFS[r.type];
  if (def.visual) return hostOf(r.sourceUrl) ?? def.label;
  if (r.type === "skill")
    return [(r.meta.invocation as string) || def.label, r.meta.readonly ? "plugin" : ""].filter(Boolean).join(" · ");
  const purpose = (r.meta.whenToUse as string) || (r.meta.purpose as string) || r.description;
  return [def.label, purpose].filter(Boolean).join(" · ");
}

/** The site's icon on a 20px tile; a letter when the site has none, the type's icon when there is no site. */
function SiteIcon({ resource }: { resource: ResourceDTO }) {
  const host = /^https?:/i.test(resource.sourceUrl ?? "") ? hostOf(resource.sourceUrl) : null;
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-surface-raised text-ink-secondary"
    >
      {host && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl(host)} alt="" loading="lazy" className="size-3.5" onError={() => setFailed(true)} />
      ) : host ? (
        <span className="text-[11px] font-medium">{host[0].toUpperCase()}</span>
      ) : (
        <TypeIcon type={resource.type} className="size-3" />
      )}
    </span>
  );
}

const MAX_CHIPS = 3;

/** Facets and tags with their kind, so "SaaS" reads as a domain; a linked card without any shows its type. */
function Chips({ resource }: { resource: ResourceDTO }) {
  const def = TYPE_DEFS[resource.type];
  const tags = [...resource.tags].sort((a, b) => Number(a.kind === "tag") - Number(b.kind === "tag"));
  const chip = "inline-flex h-6 items-center gap-1 rounded-full bg-ink/8 px-2.5 text-xs font-medium text-ink";
  if (!tags.length) {
    // a note card already shows its type inside the frame
    return resource.sourceUrl ? (
      <div className="flex">
        <span className={chip}>{def.label}</span>
      </div>
    ) : null;
  }
  const rest = tags.slice(MAX_CHIPS);
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.slice(0, MAX_CHIPS).map((t) => (
        <span key={t.id} className={chip}>
          {t.kind !== "tag" && <span className="font-normal text-ink-secondary">{TAG_KIND_LABELS[t.kind]}</span>}
          {t.name}
        </span>
      ))}
      {rest.length > 0 && (
        <span className={chip} title={rest.map((t) => t.name).join(", ")}>
          +{rest.length}
        </span>
      )}
    </div>
  );
}

/** Feeds the pointer to the glass: the art drifts, the highlight and the ember edge follow it. */
function trackPointer(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  el.style.setProperty("--mx", `${x}px`);
  el.style.setProperty("--my", `${y}px`);
  el.style.setProperty("--px", (x / r.width - 0.5).toFixed(3));
  el.style.setProperty("--py", (y / r.height - 0.5).toFixed(3));
}

function releasePointer(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--px", "0");
  e.currentTarget.style.setProperty("--py", "0");
}

export function ResourceCard({ resource, selected, selecting, onToggle, meta }: CardProps) {
  const def = TYPE_DEFS[resource.type];
  const onClick = (e: MouseEvent) => {
    if (selecting || e.shiftKey || e.metaKey) {
      stop(e);
      onToggle(e);
    }
  };
  const isCode = def.content === "code" || def.content === "json";
  const shot = resource.type === "reference" ? resource.fullShot : null;
  const art = resource.coverAssetId ? assetUrl(resource.coverAssetId, { thumb: true }) : null;

  return (
    <Link
      href={`/r/${resource.id}`}
      onClick={onClick}
      onPointerMove={trackPointer}
      onPointerLeave={releasePointer}
      style={art ? ({ "--card-art": `url("${art}")` } as CSSProperties) : undefined}
      className={cn(
        "glass-card group flex min-w-0 flex-col gap-3 p-2 pb-3.5",
        selected && "outline-2 outline-offset-3 outline-accent-text",
      )}
    >
      {art && <span aria-hidden className="glass-card-art" />}
      <span aria-hidden className="glass-card-tint" />
      <div
        className={cn(
          "relative aspect-[16/10] max-w-full overflow-hidden rounded-[11px] bg-canvas",
          // the scroll distance is measured against the frame's own height (cqh)
          shot && "[container-type:size]",
        )}
      >
        {shot ? (
          <ScrollShot shot={shot} />
        ) : def.visual ? (
          <Cover resource={resource} />
        ) : (
          <div className="flex size-full flex-col justify-between gap-3 p-6">
            {isCode ? (
              <pre className="line-clamp-6 overflow-hidden font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                {resource.content.slice(0, 400) || "Empty"}
              </pre>
            ) : (
              <p className="line-clamp-3 text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink">
                {excerpt(resource) || <span className="text-ink-subtle">Empty</span>}
              </p>
            )}
            <span className="self-start rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-ink-secondary">
              {def.label}
            </span>
          </div>
        )}
        <SelectBox selected={selected} onToggle={onToggle} visible={selecting} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 px-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <SiteIcon resource={resource} />
          <h3 className="min-w-0 flex-1 truncate text-[16px] leading-[1.4] font-medium text-ink" title={resource.title}>
            {resource.title}
          </h3>
          <CardActions resource={resource} glass />
        </div>
        <p className="truncate text-[14px] leading-[1.4] text-ink-muted">{meta ?? metaLine(resource)}</p>
        <Chips resource={resource} />
      </div>
    </Link>
  );
}

export function ResourceRow({ resource, selected, selecting, onToggle, meta }: CardProps) {
  return (
    <Link
      href={`/r/${resource.id}`}
      onClick={(e) => {
        if (selecting || e.shiftKey || e.metaKey) {
          stop(e);
          onToggle(e);
        }
      }}
      className={cn(
        "group relative flex h-16 items-center gap-4 rounded-[14px] px-3 transition-colors duration-150 hover:bg-surface focus-visible:bg-surface",
        selected && "bg-surface outline-2 outline-offset-0 outline-accent-text",
      )}
    >
      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-[8px] bg-surface">
        {resource.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetUrl(resource.coverAssetId, { thumb: true })}
            alt=""
            loading="lazy"
            className="size-full object-cover object-top"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        ) : (
          <div className="grid size-full place-items-center text-ink-subtle">
            <TypeIcon type={resource.type} className="size-4" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-medium text-ink">{resource.title}</div>
        <div className="truncate text-[14px] text-ink-subtle">{meta ?? metaLine(resource)}</div>
      </div>
      <time
        className="hidden w-20 shrink-0 text-right font-mono text-xs text-ink-subtle tabular-nums sm:block"
        dateTime={resource.updatedAt}
      >
        {new Date(resource.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </time>
      <CardActions resource={resource} />
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          stop(e);
          onToggle(e);
        }}
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-opacity",
          selected
            ? "border-inverse bg-inverse text-on-inverse"
            : "border-ink-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          selecting && "opacity-100",
        )}
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </button>
    </Link>
  );
}
