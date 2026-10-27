"use client";

import { Check, ClipboardCopy, FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUi } from "@/components/ui-store";
import { api, useSettings } from "@/lib/api";
import { copyText, formatTokens } from "@/lib/clipboard";

interface Tokens {
  text: number;
  images: number;
  total: number;
  imageCount: number;
}

const LAST_DIR_KEY = "stan-bag:last-export-dir";

function readLastDir() {
  try {
    return localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

export function ExportDialog() {
  const { exportTarget, closeExport } = useUi();
  return (
    <Dialog open={!!exportTarget} onOpenChange={(o) => !o && closeExport()}>
      <DialogContent className="sm:max-w-lg">
        {exportTarget && <ExportBody key={exportTarget.ids.join(",")} ids={exportTarget.ids} initialName={exportTarget.name} onClose={closeExport} />}
      </DialogContent>
    </Dialog>
  );
}

function ExportBody({ ids, initialName, onClose }: { ids: string[]; initialName: string; onClose: () => void }) {
  const { data: settings } = useSettings();
  const [name, setName] = useState(initialName);
  const [dirInput, setDir] = useState<string | null>(() => readLastDir());
  const dir = dirInput ?? settings?.exportsDir ?? "";
  const [resize, setResize] = useState(true);
  const [full, setFull] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ path: string; fileCount: number; tokens: Tokens } | null>(null);

  const estimate = useQuery({
    queryKey: ["estimate", ids, full],
    queryFn: () => api<{ tokens: Tokens }>("/api/context", { method: "POST", json: { ids, includeFullScreenshots: full } }),
  });

  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ path: string; fileCount: number; tokens: Tokens }>("/api/export", {
        method: "POST",
        json: { ids, targetDir: dir, bundleName: name, resizeImages: resize, includeFullScreenshots: full },
      });
      setResult(r);
      try {
        localStorage.setItem(LAST_DIR_KEY, dir);
      } catch {}
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const t = result?.tokens ?? estimate.data?.tokens;

  return (
    <>
        <DialogHeader>
          <DialogTitle>{result ? "Bundle exported" : "Export for Claude Code"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Point Claude Code at context.md — it lists every resource and links the copied files."
              : `Writes context.md, prompts, skills and copies of ${ids.length} resource${ids.length === 1 ? "" : "s"}' files into a new folder.`}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 font-mono text-xs break-all">
              <Check className="size-3.5 shrink-0 text-primary" aria-hidden /> {result.path}
            </div>
            <p className="text-xs text-muted-foreground">
              {result.fileCount} files · ~{formatTokens(result.tokens.total)} tokens
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copyText(`Read ${result.path}/context.md and use it as context for this task.`, "Prompt copied")}>
                <ClipboardCopy /> Copy prompt for Claude
              </Button>
              <Button size="sm" variant="outline" onClick={() => copyText(result.path, "Path copied")}>
                <ClipboardCopy /> Copy path
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => api("/api/reveal", { method: "POST", json: { path: result.path } }).catch((e) => toast.error(e.message))}
              >
                <FolderOpen /> Reveal in Finder
              </Button>
            </div>
          </div>
        ) : (
          <form
            id="export-form"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="export-name">Bundle name</Label>
              <Input id="export-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-dir">Destination folder</Label>
              <Input id="export-dir" value={dir} onChange={(e) => setDir(e.target.value)} className="font-mono text-xs" placeholder="~/Projects/my-app/.claude/context" required />
              <p className="text-xs text-muted-foreground">A new sub-folder is created; nothing existing is overwritten.</p>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={resize} onCheckedChange={(v) => setResize(!!v)} /> Resize large images to 1568px (Claude’s limit)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={full} onCheckedChange={(v) => setFull(!!v)} /> Include full-page screenshots
              </label>
            </div>
          </form>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            {t ? (
              <>
                ~<span className="font-mono text-foreground">{formatTokens(t.total)}</span> tokens · text {formatTokens(t.text)} · {t.imageCount} image
                {t.imageCount === 1 ? "" : "s"} {formatTokens(t.images)}
              </>
            ) : (
              "Estimating…"
            )}
          </span>
          <DialogFooter className="m-0 p-0">
            {result ? (
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button size="sm" type="submit" form="export-form" disabled={busy || !dir.trim() || !name.trim()}>
                {busy && <Loader2 className="animate-spin" />} Export
              </Button>
            )}
          </DialogFooter>
        </div>
    </>
  );
}
