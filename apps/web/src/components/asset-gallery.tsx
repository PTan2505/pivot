"use client";

import {
  Camera,
  ChevronDown,
  Download,
  ExternalLink,
  ImageUp,
  Info,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AssetDTO, CaptureAttemptDTO, CaptureOptions, ResourceDetailDTO } from "@pivot/core/types";
import { AnnotationLayer } from "@/components/annotation-layer";
import { AssetPreview, formatBytes } from "@/components/asset-preview";
import { ConfirmButton } from "@/components/confirm-button";
import { ScreenshotViewer } from "@/components/screenshot-viewer";
import { TypeIcon } from "@/components/type-icon";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, assetUrl, uploadToResource, useInvalidate, useUpdateResource } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

const ROLE_LABEL: Record<AssetDTO["role"], string> = {
  screenshot: "Screenshot",
  "screenshot-full": "Full page",
  "screenshot-original": "Original",
  "screenshot-full-original": "Original full page",
  "screenshot-variant": "Other theme",
  "screenshot-full-variant": "Other theme, full page",
  "screenshot-responsive": "Viewport",
  "screenshot-full-responsive": "Full page",
  "motion-video": "Motion",
  "motion-keyframe": "Keyframe",
  state: "State",
  attachment: "File",
};

/** "Screenshot · dark": the role, plus the colour scheme it was captured in when known. */
function labelOf(asset: AssetDTO) {
  const m = asset.meta ?? {};
  if (asset.role === "state" && typeof m.state === "string") return `State · ${m.state}`;
  if (asset.role === "motion-keyframe" && typeof m.keyframe === "number") return `Keyframe ${m.keyframe}`;
  const parts = [ROLE_LABEL[asset.role]];
  if (typeof m.viewportName === "string") parts.push(m.viewportName);
  if (typeof m.colorScheme === "string" && asset.role !== "attachment" && asset.role !== "state")
    parts.push(m.colorScheme);
  return parts.join(" · ");
}

const ACCEPT = "image/*,video/*,.svg,.json,.lottie,.woff,.woff2,.ttf,.otf,.txt,.md,.css,.ts,.tsx,.js,.jsx,.html";

export function useAttach(resourceId: string) {
  const invalidate = useInvalidate();
  return async (files: File[]) => {
    if (!files.length) return;
    const id = toast.loading(`Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`);
    try {
      await uploadToResource(resourceId, files);
      invalidate(resourceId);
      toast.success("Attached", { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed", { id });
    }
  };
}

export function AssetGallery({ resource, compact = false }: { resource: ResourceDetailDTO; compact?: boolean }) {
  const assets = resource.assets;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The first capture (Original) is shown first once a retake has replaced it; otherwise the cover.
  const selected =
    assets.find((a) => a.id === selectedId) ??
    assets.find((a) => a.role === "screenshot-original") ??
    assets.find((a) => a.id === resource.coverAssetId) ??
    assets[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const shotRef = useRef<HTMLInputElement>(null);
  const attach = useAttach(resource.id);
  const invalidate = useInvalidate();
  const update = useUpdateResource(resource.id);
  const [over, setOver] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [annotating, setAnnotating] = useState(false);

  const recapture = async (options: CaptureOptions & { defer?: boolean } = {}) => {
    try {
      await api(`/api/resources/${resource.id}/capture`, { method: "POST", json: options });
      invalidate(resource.id);
      if (options.defer) toast.success("Saved as a request. Start it from the capture queue when you want.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start capture");
    }
  };

  const cancel = async () => {
    try {
      await api(`/api/resources/${resource.id}/capture`, { method: "DELETE" });
      invalidate(resource.id);
      toast.success("Capture cancelled. Screenshots already saved are kept.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the capture");
    }
  };

  const remove = async (asset: AssetDTO) => {
    await api(`/api/resources/${resource.id}/assets/${asset.id}`, { method: "DELETE" });
    setSelectedId(null);
    invalidate(resource.id);
  };

  const replaceShot = async (file: File | undefined) => {
    if (!file) return;
    const id = toast.loading("Replacing the screenshot…");
    try {
      await uploadToResource(resource.id, [file], { as: "screenshot" });
      setSelectedId(null);
      invalidate(resource.id);
      toast.success("Screenshot replaced", { id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not replace the screenshot", { id });
    }
  };

  const capturing = resource.captureStatus === "pending";
  // A partial capture, a suspicious one, or a retake that kept the previous shot leaves a note.
  const note = !capturing && resource.captureStatus !== "failed" ? resource.captureError : null;
  const capturable = !!resource.sourceUrl && ["reference", "library", "animation", "source"].includes(resource.type);

  return (
    <section
      data-dropzone
      aria-label="Files"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        attach([...e.dataTransfer.files]);
      }}
      className={cn("space-y-3 rounded-[14px]", over && "outline-2 outline-offset-4 outline-accent-text")}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => (attach([...(e.target.files ?? [])]), (e.target.value = ""))}
      />
      <input
        ref={shotRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => (replaceShot(e.target.files?.[0]), (e.target.value = ""))}
      />

      {(capturing || resource.captureStatus === "failed") && (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs",
            capturing ? "text-ink-muted" : "text-danger",
          )}
        >
          {capturing ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          <span className="min-w-0 flex-1 truncate">
            {capturing ? "Capturing screenshots…" : `Screenshot failed: ${resource.captureError ?? "unknown error"}`}
          </span>
          {capturing ? (
            <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                variant="secondary"
                className="bg-surface-raised"
                onClick={() => shotRef.current?.click()}
              >
                Upload one
              </Button>
              <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={() => recapture()}>
                Retry
              </Button>
            </>
          )}
        </div>
      )}

      {note && (
        <div role="status" className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs text-ink-muted">
          <Info className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{note}</span>
          {capturable && (
            <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={() => recapture()}>
              Retake
            </Button>
          )}
        </div>
      )}

      {selected && annotating && selected.kind === "image" && !selected.missing ? (
        <AnnotationLayer resourceId={resource.id} asset={selected} annotations={resource.annotations ?? []} />
      ) : selected ? (
        <div className="relative">
          <div className={cn("overflow-auto rounded-[14px] bg-surface", compact ? "max-h-80" : "max-h-[75vh]")}>
            <div className="grid min-h-48 place-items-center">
              {selected.kind === "image" && !selected.missing ? (
                <button
                  type="button"
                  onClick={() => setViewing(true)}
                  aria-label="View at full size"
                  className="block w-full cursor-zoom-in"
                >
                  <AssetPreview asset={selected} />
                </button>
              ) : (
                <AssetPreview asset={selected} />
              )}
            </div>
          </div>
          {selected.kind === "image" && !selected.missing && (
            <>
              {/* solid, like the card controls: nothing see-through on the screenshot */}
              <Button
                variant="secondary"
                size="icon"
                aria-label="View at full size"
                className="absolute top-3 right-3 bg-surface-raised"
                onClick={() => setViewing(true)}
              >
                <Maximize2 />
              </Button>
              <ScreenshotViewer asset={selected} open={viewing} onOpenChange={setViewing} />
            </>
          )}
        </div>
      ) : (
        !compact && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid aspect-[16/10] w-full place-items-center rounded-[14px] bg-surface text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink"
          >
            <span className="flex flex-col items-center gap-2">
              <TypeIcon type={resource.type} className="size-6" />
              Drop, paste or click to add files
            </span>
          </button>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setSelectedId(a.id)}
            aria-pressed={selected?.id === a.id}
            aria-label={`${labelOf(a)}: ${a.fileName}`}
            className={cn(
              "relative size-14 overflow-hidden rounded-[10px] bg-surface transition-colors hover:bg-surface-raised",
              selected?.id === a.id && "outline-2 outline-offset-2 outline-accent-text",
            )}
          >
            {a.kind === "image" || a.kind === "svg" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetUrl(a.id, { thumb: a.kind === "image" })}
                alt=""
                className="size-full object-cover object-top"
              />
            ) : (
              <span className="grid size-full place-items-center font-mono text-[12px] text-ink-subtle uppercase">
                {a.kind}
              </span>
            )}
            {a.id === resource.coverAssetId && (
              <Star className="absolute top-1 right-1 size-3 fill-ink text-ink drop-shadow" aria-label="Cover" />
            )}
          </button>
        ))}
        <Button
          variant="secondary"
          size="icon"
          className="size-14 rounded-[10px]"
          onClick={() => fileRef.current?.click()}
          aria-label="Add files"
        >
          <Plus />
        </Button>
        {capturable && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => shotRef.current?.click()} disabled={capturing}>
              <ImageUp /> Replace screenshot
            </Button>
            <div className="flex">
              <Button variant="secondary" className="rounded-r-none" onClick={() => recapture()} disabled={capturing}>
                <Camera />{" "}
                {resource.captureStatus === "done" || resource.captureStatus === "partial"
                  ? "Retake screenshot"
                  : "Capture screenshot"}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="rounded-l-none border-l border-canvas"
                    aria-label="Capture options"
                    disabled={capturing}
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-60">
                  <DropdownMenuLabel>Capture once with</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => recapture({ expandContent: true })}>
                    Expand content (click “Load more”)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => recapture({ theme: "light" })}>Light theme</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => recapture({ theme: "dark" })}>Dark theme</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => recapture({ theme: "both" })}>Both themes</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => recapture({ viewports: ["tablet", "mobile"] })}>
                    Tablet and mobile too
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => recapture({ motion: true })}>
                    Record motion (video and keyframes)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => recapture({ defer: true })}>Capture later…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
          <span className="rounded-full bg-surface px-2.5 py-0.5 text-ink-secondary">{labelOf(selected)}</span>
          {selected.kind === "image" && !selected.missing && (
            <Button
              size="xs"
              variant={annotating ? "secondary" : "ghost"}
              aria-pressed={annotating}
              onClick={() => setAnnotating((a) => !a)}
            >
              <MessageSquarePlus />
              {annotating
                ? "Done"
                : `Notes${(resource.annotations ?? []).filter((a) => a.assetId === selected.id).length ? ` (${(resource.annotations ?? []).filter((a) => a.assetId === selected.id).length})` : ""}`}
            </Button>
          )}
          <span className="max-w-60 truncate font-mono" title={selected.fileName}>
            {selected.fileName}
          </span>
          <span className="font-mono tabular-nums">
            {selected.width && selected.height ? `${selected.width}×${selected.height} · ` : ""}
            {formatBytes(selected.size)}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            {(selected.kind === "image" || selected.kind === "svg") && selected.id !== resource.coverAssetId && (
              <Button size="xs" variant="ghost" onClick={() => update.mutate({ coverAssetId: selected.id })}>
                <Star /> Set as cover
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-xs" variant="ghost" asChild aria-label="Open original">
                  <a href={assetUrl(selected.id)} target="_blank" rel="noreferrer">
                    <ExternalLink />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open original</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-xs" variant="ghost" asChild aria-label="Download">
                  <a href={assetUrl(selected.id, { download: true })}>
                    <Download />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
            <ConfirmButton
              title="Remove this file?"
              description="It is detached from this resource. The file is deleted from disk if no other resource uses it."
              confirmLabel="Remove"
              onConfirm={() => remove(selected)}
            >
              <Button size="icon-xs" variant="ghost" aria-label="Remove file" className="hover:text-danger">
                <Trash2 />
              </Button>
            </ConfirmButton>
          </div>
          <AssetNotes key={selected.id} asset={selected} resourceId={resource.id} />
        </div>
      )}

      {capturable && assets.some((a) => a.role === "screenshot-original") && (
        <CompareOriginal resourceId={resource.id} />
      )}
      {capturable && (
        <CaptureHistory
          resourceId={resource.id}
          status={resource.captureStatus}
          hasMotion={assets.some((a) => a.role === "motion-video")}
          onRecordMotion={() => recapture({ motion: true })}
        />
      )}
    </section>
  );
}

const ATTEMPT_STATUS: Record<CaptureAttemptDTO["status"], string> = {
  deferred: "Requested for later",
  queued: "Queued",
  capturing: "Capturing",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Every capture of this resource: when, how, what came out. Collapsed by default. */
function CaptureHistory({
  resourceId,
  status,
  hasMotion,
  onRecordMotion,
}: {
  resourceId: string;
  status: string | null;
  /** A recording is already there: no need to suggest one. */
  hasMotion: boolean;
  onRecordMotion: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["capture-attempts", resourceId, status],
    queryFn: () => api<{ attempts: CaptureAttemptDTO[] }>(`/api/resources/${resourceId}/capture`),
  });
  const attempts = data?.attempts ?? [];
  if (!attempts.length) return null;
  const latestDone = attempts.find((a) => a.status === "completed" || a.status === "partial");
  const suggestMotion = latestDone?.context.motionLikely === true && !latestDone.context.motion && !hasMotion;
  return (
    <>
      {suggestMotion && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          The last capture saw animation on this page; a still image may miss it.
          <Button size="xs" variant="secondary" onClick={onRecordMotion}>
            Record motion
          </Button>
        </p>
      )}
      <details className="text-xs text-ink-muted">
        <summary className="w-fit cursor-pointer rounded-full px-2 py-1 hover:text-ink">
          Capture history ({attempts.length})
        </summary>
        <ol className="mt-2 space-y-1.5">
          {attempts.map((a) => {
            const ctx = a.context as {
              theme?: string;
              colorScheme?: string;
              variantColorScheme?: string;
              expandContent?: boolean;
              retries?: number;
            };
            const details = [
              [ctx.colorScheme ?? ctx.theme, ctx.variantColorScheme].filter(Boolean).join(" + "),
              ctx.expandContent ? "expanded content" : null,
              ctx.retries ? `${ctx.retries} retr${ctx.retries > 1 ? "ies" : "y"}` : null,
              a.quality === "needs_review" ? "needs review" : null,
            ].filter(Boolean);
            return (
              <li key={a.id} className="flex flex-wrap gap-x-2 rounded-[10px] bg-surface px-3 py-2">
                <span className="text-ink-secondary">{ATTEMPT_STATUS[a.status]}</span>
                <time className="font-mono tabular-nums" dateTime={a.requestedAt}>
                  {new Date(a.requestedAt).toLocaleString()}
                </time>
                {details.length > 0 && <span>{details.join(" · ")}</span>}
                {a.error && <span className="basis-full">{a.error}</span>}
              </li>
            );
          })}
        </ol>
      </details>
    </>
  );
}

function AssetNotes({ asset, resourceId }: { asset: AssetDTO; resourceId: string }) {
  const [notes, setNotes] = useState(asset.notes);
  const invalidate = useInvalidate();
  const save = async () => {
    if (notes === asset.notes) return;
    await api(`/api/assets/${asset.id}`, { method: "PATCH", json: { notes } });
    invalidate(resourceId);
  };
  return (
    <Input
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      onBlur={save}
      placeholder="Note about this file — where it came from, what to look at…"
      aria-label="File note"
      className="h-8 basis-full text-xs"
    />
  );
}

interface CompareSide {
  capturedAt: string | null;
  createdAt: string;
  colorScheme: string | null;
}

/**
 * Original against Latest: how much changed, a picture of where, and when each was taken. A big change can be kept as
 * a new design version instead of replacing the old one.
 */
function CompareOriginal({ resourceId }: { resourceId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data, error, isLoading } = useQuery({
    queryKey: ["compare", resourceId],
    queryFn: () =>
      api<{ changedRatio: number; redesignHint: boolean; a: CompareSide; b: CompareSide }>(
        `/api/resources/${resourceId}/compare`,
      ),
    enabled: open,
  });
  const saveVersion = async () => {
    setSaving(true);
    try {
      const res = await api<{ path: string }>(`/api/resources/${resourceId}/versions`, { method: "POST" });
      toast.success("Saved as a new design version", {
        action: { label: "Open", onClick: () => (location.href = res.path) },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the version");
    } finally {
      setSaving(false);
    }
  };
  const when = (x: CompareSide) =>
    `${new Date(x.capturedAt ?? x.createdAt).toLocaleString()}${x.colorScheme ? ` · ${x.colorScheme}` : ""}`;
  return (
    <details className="text-xs text-ink-muted" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="w-fit cursor-pointer rounded-full px-2 py-1 hover:text-ink">
        Compare Original and Latest
      </summary>
      <div className="mt-2 space-y-2 rounded-[14px] bg-surface p-3">
        {isLoading && <Loader2 className="size-3.5 animate-spin" aria-label="Comparing" />}
        {error && <p className="text-danger">{error.message}</p>}
        {data && (
          <>
            <p className="text-ink">
              {(data.changedRatio * 100).toFixed(1)}% of the pixels changed.{" "}
              <span className="text-ink-muted">
                Original {when(data.a)}; Latest {when(data.b)}. Dates, carousels and ads count as change too.
              </span>
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/resources/${resourceId}/compare/image`}
              alt="The Latest screenshot dimmed, with the pixels that changed since the Original in orange"
              className="max-h-[60vh] w-full rounded-[10px] object-contain object-top"
            />
            <div className="flex flex-wrap items-center gap-2">
              {data.redesignHint && <span className="text-ink">This looks like a redesign.</span>}
              <Button
                size="xs"
                variant={data.redesignHint ? "secondary" : "ghost"}
                className={data.redesignHint ? "bg-surface-raised" : undefined}
                disabled={saving}
                onClick={saveVersion}
              >
                Save Latest as a new design version
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
