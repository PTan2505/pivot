"use client";

import { Camera, Download, ExternalLink, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AssetDTO, ResourceDetailDTO } from "@stan-bag/core/types";
import { AssetPreview, formatBytes } from "@/components/asset-preview";
import { ConfirmButton } from "@/components/confirm-button";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, assetUrl, uploadToResource, useInvalidate, useUpdateResource } from "@/lib/api";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<AssetDTO["role"], string> = {
  screenshot: "Screenshot",
  "screenshot-full": "Full page",
  attachment: "File",
};

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
  const selected =
    assets.find((a) => a.id === selectedId) ?? assets.find((a) => a.id === resource.coverAssetId) ?? assets[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const attach = useAttach(resource.id);
  const invalidate = useInvalidate();
  const update = useUpdateResource(resource.id);
  const [over, setOver] = useState(false);

  const recapture = async () => {
    try {
      await api(`/api/resources/${resource.id}/capture`, { method: "POST" });
      invalidate(resource.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start capture");
    }
  };

  const remove = async (asset: AssetDTO) => {
    await api(`/api/resources/${resource.id}/assets/${asset.id}`, { method: "DELETE" });
    setSelectedId(null);
    invalidate(resource.id);
  };

  const capturing = resource.captureStatus === "pending";

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
          {!capturing && (
            <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={recapture}>
              Retry
            </Button>
          )}
        </div>
      )}

      {selected ? (
        <div className={cn("overflow-auto rounded-[14px] bg-surface", compact ? "max-h-80" : "max-h-[75vh]")}>
          <div className="grid min-h-48 place-items-center">
            <AssetPreview asset={selected} />
          </div>
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
            aria-label={`${ROLE_LABEL[a.role]}: ${a.fileName}`}
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
        {resource.sourceUrl && ["reference", "library", "animation"].includes(resource.type) && (
          <Button variant="secondary" onClick={recapture} disabled={capturing} className="ml-auto">
            <Camera /> {resource.captureStatus === "done" ? "Retake screenshot" : "Capture screenshot"}
          </Button>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
          <span className="rounded-full bg-surface px-2.5 py-0.5 text-ink-secondary">{ROLE_LABEL[selected.role]}</span>
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
    </section>
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
