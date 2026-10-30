"use client";

import { ExternalLink, X } from "lucide-react";
import type { AssetDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { assetUrl } from "@/lib/api";

/**
 * A screenshot at reading size: the page as wide as it was captured (at most 1440px, the capture viewport), scrolling
 * top to bottom inside a full-height sheet, so a 12000px full-page shot can be read instead of squinted at.
 */
export function ScreenshotViewer({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-4 block h-[calc(100dvh-2rem)] max-w-[min(1440px,calc(100%-2rem))] translate-y-0 gap-0 overflow-auto bg-canvas p-0 sm:max-w-[min(1440px,calc(100%-2rem))] data-open:zoom-in-100"
      >
        {/* solid, so nothing see-through sits on the screenshot while it scrolls under */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-surface px-4 py-2.5">
          <DialogTitle className="min-w-0 flex-1 truncate font-mono text-xs font-normal text-ink-muted">
            {asset.fileName}
            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          </DialogTitle>
          <Button variant="ghost" size="sm" asChild>
            <a href={assetUrl(asset.id)} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden /> Original file
            </a>
          </Button>
          <DialogClose asChild>
            <Button variant="secondary" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl(asset.id)} alt={asset.notes || asset.fileName} className="block h-auto w-full" />
      </DialogContent>
    </Dialog>
  );
}
