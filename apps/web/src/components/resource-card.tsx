"use client";

import { Check, Copy, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, MouseEvent } from "react";
import { TYPE_DEFS, type ResourceDTO } from "@stan-bag/core/types";
import { TypeIcon } from "@/components/type-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyResource } from "@/hooks/use-copy-resource";
import { assetUrl } from "@/lib/api";
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
          : "border-white/70 bg-black/40 text-white backdrop-blur group-hover:opacity-100 focus-visible:opacity-100",
        !selected && (visible ? "opacity-100" : "opacity-0"),
      )}
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

function CardActions({ resource, className }: { resource: ResourceDTO; className?: string }) {
  const copy = useCopyResource();
  const def = TYPE_DEFS[resource.type];
  const pill =
    "grid size-8 place-items-center rounded-full bg-surface-raised/90 text-ink-secondary backdrop-blur transition-colors hover:text-ink";
  return (
    <div
      className={cn(
        "flex gap-1.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100",
        className,
      )}
    >
      {resource.sourceUrl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={pill}
              aria-label="Open source URL"
              onClick={(e) => {
                stop(e);
                window.open(resource.sourceUrl!, "_blank", "noopener,noreferrer");
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
      <div className="grid size-full animate-pulse place-items-center text-[13px] text-ink-muted [animation-duration:1.6s]">
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
  if (def.visual) return [hostOf(r.sourceUrl) ?? def.label, r.tags[0]?.name].filter(Boolean).join(" · ");
  if (r.type === "skill")
    return [(r.meta.invocation as string) || def.label, r.meta.readonly ? "plugin" : ""].filter(Boolean).join(" · ");
  const purpose = (r.meta.whenToUse as string) || (r.meta.purpose as string) || r.description;
  return [def.label, purpose].filter(Boolean).join(" · ");
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

  return (
    <Link href={`/r/${resource.id}`} onClick={onClick} className="group flex min-w-0 flex-col gap-3 outline-none">
      <div
        className={cn(
          "relative aspect-[16/10] max-w-full overflow-hidden rounded-[14px] bg-surface transition-colors duration-150",
          "group-focus-visible:outline-2 group-focus-visible:outline-offset-3 group-focus-visible:outline-accent-text",
          selected && "outline-2 outline-offset-3 outline-accent-text",
          !def.visual && "group-hover:bg-surface-raised",
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
            <span className="self-start rounded-full bg-surface-raised px-3 py-1 text-xs font-medium text-ink-secondary group-hover:bg-surface">
              {def.label}
            </span>
          </div>
        )}
        <SelectBox selected={selected} onToggle={onToggle} visible={selecting} />
        <CardActions resource={resource} className="absolute top-3 right-3" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <h3 className="truncate text-[15px] leading-[1.4] font-medium text-ink" title={resource.title}>
          {resource.title}
        </h3>
        <p className="truncate text-[13px] leading-[1.4] text-ink-subtle">{meta ?? metaLine(resource)}</p>
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
        <div className="truncate text-[15px] font-medium text-ink">{resource.title}</div>
        <div className="truncate text-[13px] text-ink-subtle">{meta ?? metaLine(resource)}</div>
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
