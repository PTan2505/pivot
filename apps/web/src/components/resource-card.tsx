"use client";

import { Check, Copy, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { TYPE_DEFS, type ResourceDTO } from "@stan-bag/core/types";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
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

export function SelectBox({ selected, onToggle, className }: { selected: boolean; onToggle: (e: MouseEvent) => void; className?: string }) {
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
        "grid size-5 place-items-center rounded-[5px] border border-white/40 bg-black/50 text-white backdrop-blur transition-opacity",
        selected ? "border-primary bg-primary text-primary-foreground opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

function CardActions({ resource }: { resource: ResourceDTO }) {
  const copy = useCopyResource();
  const def = TYPE_DEFS[resource.type];
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {resource.sourceUrl && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open source URL"
              onClick={(e) => {
                stop(e);
                window.open(resource.sourceUrl!, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open source</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={def.content === "none" ? "Copy as context" : "Copy content"}
            onClick={(e) => {
              stop(e);
              copy(resource);
            }}
          >
            <Copy />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{def.content === "none" ? "Copy as context" : "Copy"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function TagLine({ resource, max = 3 }: { resource: ResourceDTO; max?: number }) {
  if (!resource.tags.length) return null;
  const shown = resource.tags.slice(0, max);
  const rest = resource.tags.length - shown.length;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {shown.map((t) => (
        <span key={t.id} className="max-w-32 truncate rounded-[4px] bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
          {t.name}
        </span>
      ))}
      {rest > 0 && (
        <span className="rounded-[4px] px-1 py-px text-[11px] text-muted-foreground" title={resource.tags.slice(max).map((t) => t.name).join(", ")}>
          +{rest}
        </span>
      )}
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
            img.className = "size-full object-contain p-6";
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
      <div className="grid size-full animate-pulse place-items-center bg-muted text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Capturing…
        </span>
      </div>
    );
  }
  return (
    <div className="grid size-full place-items-center bg-surface-sunken text-muted-foreground">
      {resource.captureStatus === "failed" ? <ImageOff className="size-5" aria-label="No preview" /> : <TypeIcon type={resource.type} className="size-6 opacity-60" />}
    </div>
  );
}

interface CardProps {
  resource: ResourceDTO;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: MouseEvent) => void;
  extraAction?: ReactNode;
}

export function ResourceCard({ resource, selected, selecting, onToggle }: CardProps) {
  const def = TYPE_DEFS[resource.type];
  const host = hostOf(resource.sourceUrl);
  const onClick = (e: MouseEvent) => {
    if (selecting || e.shiftKey || e.metaKey) {
      stop(e);
      onToggle(e);
    }
  };

  if (def.visual) {
    return (
      <Link
        href={`/r/${resource.id}`}
        onClick={onClick}
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] hover:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          selected && "border-primary ring-1 ring-primary",
        )}
      >
        <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted">
          <Cover resource={resource} />
          <SelectBox selected={selected} onToggle={onToggle} className={cn("absolute top-2 left-2", selecting && "opacity-100")} />
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[13px] font-medium" title={resource.title}>
                {resource.title}
              </h3>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <TypeIcon type={resource.type} className="size-3 shrink-0" />
                <span className="truncate">{host ?? def.label}</span>
              </p>
            </div>
            <CardActions resource={resource} />
          </div>
          <TagLine resource={resource} />
        </div>
      </Link>
    );
  }

  const purpose = (resource.meta.purpose as string) || (resource.meta.whenToUse as string) || resource.description;
  return (
    <Link
      href={`/r/${resource.id}`}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-48 flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-[border-color,box-shadow] hover:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <SelectBox
          selected={selected}
          onToggle={onToggle}
          className={cn("border-input bg-muted text-foreground", selecting && "opacity-100")}
        />
        <TypeIcon type={resource.type} className="size-3.5" />
        <span>{def.label}</span>
        <div className="ml-auto">
          <CardActions resource={resource} />
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="line-clamp-2 text-[13px] font-medium" title={resource.title}>
          {resource.title}
        </h3>
        {purpose && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{purpose}</p>}
      </div>
      {resource.content && (
        <pre className="relative line-clamp-4 flex-1 overflow-hidden rounded-md bg-surface-sunken px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {resource.content.replace(/^---[\s\S]*?---\s*/, "").slice(0, 400)}
        </pre>
      )}
      <TagLine resource={resource} />
    </Link>
  );
}

export function ResourceRow({ resource, selected, selecting, onToggle }: CardProps) {
  const def = TYPE_DEFS[resource.type];
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
        "group flex h-12 items-center gap-3 border-b border-border px-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none",
        selected && "bg-primary/5",
      )}
    >
      <SelectBox selected={selected} onToggle={onToggle} className={cn("border-input bg-muted text-foreground", selecting && "opacity-100")} />
      <div className="size-8 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
        {resource.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(resource.coverAssetId, { thumb: true })} alt="" loading="lazy" className="size-full object-cover object-top" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <TypeIcon type={resource.type} className="size-3.5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{resource.title}</div>
        <div className="truncate text-xs text-muted-foreground">{hostOf(resource.sourceUrl) ?? resource.description}</div>
      </div>
      <span className="hidden w-28 shrink-0 items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <TypeIcon type={resource.type} className="size-3" />
        {def.label}
      </span>
      <div className="hidden w-56 shrink-0 lg:block">
        <TagLine resource={resource} max={2} />
      </div>
      <time className="w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums" dateTime={resource.updatedAt}>
        {new Date(resource.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </time>
      <CardActions resource={resource} />
    </Link>
  );
}
