"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { BookmarkRow } from "@stan-bag/core/sources";
import { SOURCE_CATEGORIES, type SourceCategory } from "@stan-bag/core/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

type Row = BookmarkRow & { checked: boolean; type: "source" | "reference"; choice: SourceCategory | "" };

export function BookmarkImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        {open && <ImportBody onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportBody({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reading, setReading] = useState(false);
  const [show, setShow] = useState<"suggested" | "all">("suggested");
  const [query, setQuery] = useState("");
  const [capture, setCapture] = useState(true);
  const [saving, setSaving] = useState(false);

  const readFile = async (file: File) => {
    setReading(true);
    try {
      // Chrome embeds every favicon as a data URI: not needed here, and it can be megabytes.
      const html = (await file.text()).replace(/\s(ICON|ICON_URI)="[^"]*"/gi, "");
      const preview = await api<BookmarkRow[]>("/api/sources/preview", { method: "POST", json: { html } });
      if (!preview.length) {
        toast.error("No links found in that file. Export bookmarks as HTML from your browser.");
        return;
      }
      setRows(preview.map((r) => ({ ...r, checked: r.suggested, type: r.suggestedType, choice: r.category ?? "" })));
      if (!preview.some((r) => r.suggested)) setShow("all");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setReading(false);
    }
  };

  const update = (url: string, patch: Partial<Row>) =>
    setRows((list) => list?.map((r) => (r.url === url ? { ...r, ...patch } : r)) ?? null);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(
      (r) =>
        (show === "all" || r.suggested || r.checked) &&
        words.every((w) => `${r.title} ${r.url} ${r.folders.join(" ")}`.toLowerCase().includes(w)),
    );
  }, [rows, show, query]);

  const chosen = rows?.filter((r) => r.checked && !r.duplicate) ?? [];
  const sourceCount = chosen.filter((r) => r.type === "source").length;

  const submit = async () => {
    if (!chosen.length) return;
    setSaving(true);
    try {
      const res = await api<{ created: string[]; skipped: { url: string; reason: string }[] }>("/api/sources/import", {
        method: "POST",
        json: {
          capture,
          items: chosen.map((r) => ({ url: r.url, title: r.title, type: r.type, category: r.choice || null })),
        },
      });
      invalidate();
      onClose();
      const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped` : "";
      toast.success(`Imported ${res.created.length} bookmark${res.created.length === 1 ? "" : "s"}${skipped}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not import");
    } finally {
      setSaving(false);
    }
  };

  if (!rows) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Import bookmarks</DialogTitle>
          <DialogDescription>
            Export your bookmarks as an HTML file (Chrome: Bookmarks manager, ⌥⌘B → ⋮ → Export bookmarks), then choose
            it here. You review everything before anything is saved.
          </DialogDescription>
        </DialogHeader>
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-[14px] bg-surface px-6 py-12 text-center transition-colors hover:bg-surface-raised",
            "focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-accent-text",
          )}
        >
          {reading ? (
            <Loader2 className="size-6 animate-spin text-ink-muted" />
          ) : (
            <FileUp className="size-6 text-ink-muted" />
          )}
          <span className="text-[16px] font-medium text-ink">
            {reading ? "Reading bookmarks…" : "Choose bookmarks file"}
          </span>
          <span className="text-[14px] text-ink-subtle">bookmarks_*.html</span>
          <input
            type="file"
            accept=".html,.htm,text/html"
            className="sr-only"
            disabled={reading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
            }}
          />
        </label>
      </>
    );
  }

  const suggestedCount = rows.filter((r) => r.suggested).length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Review bookmarks</DialogTitle>
        <DialogDescription>
          {suggestedCount} known design sources are ticked. Tick anything else worth keeping. A site&rsquo;s home page
          becomes a source; a page on it (one shot, one screen) becomes a reference.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Show" className="flex gap-1">
          {(
            [
              ["suggested", `Suggested · ${suggestedCount}`],
              ["all", `All · ${rows.length}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={show === value}
              onClick={() => setShow(value)}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
                show === value ? "bg-inverse text-on-inverse" : "bg-surface text-ink-secondary hover:bg-surface-raised",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, URL or folder"
          aria-label="Filter bookmarks"
          className="h-8 min-w-0 flex-1 text-[14px]"
        />
      </div>

      <ul className="-mx-2 max-h-[52vh] overflow-y-auto" aria-label="Bookmarks">
        {visible.map((r) => (
          <li
            key={r.url}
            className={cn(
              "flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-surface",
              r.duplicate && "opacity-50",
            )}
          >
            <Checkbox
              checked={r.checked && !r.duplicate}
              disabled={r.duplicate}
              onCheckedChange={(v) => update(r.url, { checked: !!v })}
              aria-label={`Import ${r.title}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink" title={r.title}>
                {r.title}
              </div>
              <div className="truncate font-mono text-[12px] text-ink-subtle" title={r.url}>
                {r.duplicate ? "Already saved · " : ""}
                {r.url.replace(/^https?:\/\/(www\.)?/, "")}
                {r.folders.length ? ` · ${r.folders.join(" / ")}` : ""}
              </div>
            </div>
            <Select
              value={r.type}
              onValueChange={(v) => update(r.url, { type: v as Row["type"] })}
              disabled={r.duplicate}
            >
              <SelectTrigger size="sm" className="w-[128px]" aria-label="Save as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">Source</SelectItem>
                <SelectItem value="reference">Reference</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={r.choice || "none"}
              onValueChange={(v) => update(r.url, { choice: v === "none" ? "" : (v as SourceCategory) })}
              disabled={r.duplicate || r.type !== "source"}
            >
              <SelectTrigger size="sm" className="w-[172px]" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {SOURCE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
        {visible.length === 0 && <li className="px-2 py-8 text-center text-sm text-ink-muted">Nothing matches.</li>}
      </ul>

      <DialogFooter className="items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={capture} onCheckedChange={(v) => setCapture(!!v)} /> Capture screenshots
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!chosen.length || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Import {chosen.length}
            {chosen.length ? ` (${sourceCount} source${sourceCount === 1 ? "" : "s"})` : ""}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
