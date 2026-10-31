"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useInvalidate } from "@/lib/api";

type Choice = "keep" | "new" | "merge";
interface Preview {
  counts: {
    resources: number;
    new: number;
    conflicts: number;
    assets: number;
    collections: number;
    designSessions: number;
  };
  items: { id: string; title: string; status: "new" | "same_id" | "same_url" }[];
}

const CHOICE_LABEL: Record<Choice, string> = {
  keep: "Keep what I have (skip)",
  merge: "Merge: fill only empty fields, add what's missing",
  new: "Import as separate copies",
};

const reveal = (path: string) =>
  api("/api/reveal", { method: "POST", json: { path } }).catch((e: Error) => toast.error(e.message));

/**
 * Settings › Backup & restore: a full portable backup (a folder with the data and files), and a restore that shows what
 * it would do first and keeps your library as it is unless you choose otherwise.
 */
export function BackupSection() {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const [made, setMade] = useState<{ path: string; counts: Record<string, number> } | null>(null);
  const [dir, setDir] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [conflicts, setConflicts] = useState<Choice>("keep");
  const [restored, setRestored] = useState<Record<string, number> | null>(null);

  const run = async <T,>(what: string, fn: () => Promise<T>) => {
    setBusy(what);
    try {
      return await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">Backup & restore</h2>
        <p className="text-sm text-muted-foreground">
          A backup is a folder with every reference, collection, link, note, design session and file. It never holds the
          API token. Restoring shows what it would do before it writes anything.
        </p>
      </div>
      <div className="space-y-4 rounded-[14px] bg-surface p-5 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={!!busy}
            onClick={async () => {
              const res = await run("backup", () =>
                api<{ path: string; counts: Record<string, number> }>("/api/backup", { method: "POST", json: {} }),
              );
              if (res) setMade(res);
            }}
          >
            {busy === "backup" && <Loader2 className="animate-spin" />} Back up the library
          </Button>
          {made && (
            <span className="text-xs text-muted-foreground">
              {made.counts.resources} references, {made.counts.assets} files
              {made.counts.missingFiles ? ` (${made.counts.missingFiles} files were missing)` : ""} ·{" "}
              <button type="button" className="font-mono break-all hover:underline" onClick={() => reveal(made.path)}>
                {made.path}
              </button>
            </span>
          )}
        </div>
        <div className="space-y-2 border-t border-divider pt-4">
          <label htmlFor="restore-dir" className="block text-xs text-muted-foreground">
            Restore from a backup folder
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="restore-dir"
              value={dir}
              onChange={(e) => {
                setDir(e.target.value);
                setPreview(null);
                setRestored(null);
              }}
              placeholder="/Users/you/Downloads/pivot-backup-…"
              className="min-w-64 flex-1 font-mono text-xs"
            />
            <Button
              variant="secondary"
              disabled={!dir.trim() || !!busy}
              onClick={async () => {
                const res = await run("preview", () =>
                  api<Preview>("/api/backup/preview", { method: "POST", json: { dir } }),
                );
                if (res) setPreview(res);
              }}
            >
              {busy === "preview" && <Loader2 className="animate-spin" />} Preview
            </Button>
          </div>
          {preview && (
            <div className="space-y-2">
              <p>
                {preview.counts.resources} references: <strong>{preview.counts.new} new</strong>,{" "}
                {preview.counts.conflicts} already here (same reference or same URL). {preview.counts.assets} files,{" "}
                {preview.counts.collections} collections, {preview.counts.designSessions} design sessions.
              </p>
              {preview.counts.conflicts > 0 && (
                <>
                  <ul className="max-h-40 space-y-0.5 overflow-auto text-xs text-muted-foreground">
                    {preview.items
                      .filter((i) => i.status !== "new")
                      .map((i) => (
                        <li key={i.id}>
                          {i.title} — {i.status === "same_id" ? "this reference is here" : "same URL as one here"}
                        </li>
                      ))}
                  </ul>
                  <Select value={conflicts} onValueChange={(v) => setConflicts(v as Choice)}>
                    <SelectTrigger className="w-full max-w-md" aria-label="For references already here">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CHOICE_LABEL) as Choice[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {CHOICE_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              <Button
                disabled={!!busy}
                onClick={async () => {
                  const res = await run("restore", () =>
                    api<Record<string, number>>("/api/backup/restore", { method: "POST", json: { dir, conflicts } }),
                  );
                  if (res) {
                    setRestored(res);
                    invalidate();
                  }
                }}
              >
                {busy === "restore" && <Loader2 className="animate-spin" />} Restore
              </Button>
              {restored && (
                <p role="status" className="text-xs text-muted-foreground">
                  Imported {restored.imported}, merged {restored.merged}, copied {restored.copied}, kept {restored.kept}
                  ; {restored.files} files added
                  {restored.skippedFiles ? `, ${restored.skippedFiles} unreadable files skipped` : ""}. Restoring again
                  adds nothing twice.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
