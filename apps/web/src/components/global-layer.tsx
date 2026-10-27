"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AddUrlDialog, parseUrls } from "@/components/add-url-dialog";
import { CommandPalette } from "@/components/command-palette";
import { ExportDialog } from "@/components/export-dialog";
import { PromptCopyDialog } from "@/components/prompt-copy-dialog";
import { useUi } from "@/components/ui-store";
import { uploadFiles, useInvalidate } from "@/lib/api";

function isEditable(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  return !!node && (node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName));
}

/** Dialogs, ⌘K, and the "paste or drop anywhere" capture flow. */
export function GlobalLayer() {
  const { openAddUrl } = useUi();
  const router = useRouter();
  const invalidate = useInvalidate();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    const upload = async (files: File[]) => {
      const id = toast.loading(`Adding ${files.length} file${files.length > 1 ? "s" : ""}…`);
      try {
        const { created } = await uploadFiles(files);
        invalidate();
        toast.success(`Added ${created.length} resource${created.length > 1 ? "s" : ""}`, {
          id,
          action: created.length === 1 ? { label: "Open", onClick: () => router.push(`/r/${created[0]}`) } : undefined,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed", { id });
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      // Dialogs (resource detail uploads, inputs) handle their own pastes.
      if (isEditable(e.target) || document.querySelector("[role=dialog]")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        upload(files);
        return;
      }
      const urls = parseUrls(e.clipboardData?.getData("text") ?? "");
      if (urls.length) {
        e.preventDefault();
        openAddUrl(urls);
      }
    };

    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e) || document.querySelector("[data-dropzone]:hover")) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      // Drop zones inside a page (e.g. resource attachments) take precedence.
      if (!hasFiles(e) || (e.target as HTMLElement).closest?.("[data-dropzone]")) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) upload(files);
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openAddUrl, invalidate, router]);

  return (
    <>
      <CommandPalette />
      <AddUrlDialog />
      <ExportDialog />
      <PromptCopyDialog />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-primary px-12 py-10 text-sm">
            <Upload className="size-6 text-primary" aria-hidden />
            Drop to add to your library
          </div>
        </div>
      )}
    </>
  );
}
