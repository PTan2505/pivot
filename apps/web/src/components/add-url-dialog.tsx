"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RESOURCE_TYPES, TYPE_DEFS, type ResourceDTO, type ResourceType } from "@stan-bag/core/types";
import { TagsEditor } from "@/components/tags-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUi } from "@/components/ui-store";
import { api, useInvalidate, type TagInput } from "@/lib/api";

const URL_TYPES = RESOURCE_TYPES.filter((t) => t !== "skill");

interface MetadataResponse {
  url: string;
  metadata: { title: string; description: string; imageUrl: string | null; siteName: string | null } | null;
  duplicates: ResourceDTO[];
  error: string | null;
}

export function parseUrls(text: string) {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(s));
}

export function AddUrlDialog() {
  const { addUrl, closeAddUrl } = useUi();
  return (
    <Dialog open={addUrl.open} onOpenChange={(o) => !o && closeAddUrl()}>
      <DialogContent className="sm:max-w-xl">
        {/* Mounted only while open, so every opening starts from a clean form. */}
        {addUrl.open && <AddUrlForm initialUrls={addUrl.urls} initialType={addUrl.type} onClose={closeAddUrl} />}
      </DialogContent>
    </Dialog>
  );
}

function AddUrlForm({ initialUrls, initialType, onClose }: { initialUrls: string[]; initialType?: ResourceType; onClose: () => void }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const [text, setText] = useState(initialUrls.join("\n"));
  const [type, setType] = useState<ResourceType>(initialType && initialType !== "skill" ? initialType : "reference");
  // null = untouched, so fetched metadata can fill it in.
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<TagInput[]>([]);
  const [capture, setCapture] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [saving, setSaving] = useState(false);

  const urls = useMemo(() => parseUrls(text), [text]);
  const single = urls.length === 1 ? urls[0] : null;
  const [debounced, setDebounced] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(single), 400);
    return () => clearTimeout(t);
  }, [single]);

  const preview = useQuery({
    queryKey: ["metadata", debounced],
    queryFn: () => api<MetadataResponse>(`/api/metadata?url=${encodeURIComponent(debounced!)}`),
    enabled: !!debounced,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const effectiveTitle = title ?? preview.data?.metadata?.title ?? "";
  const effectiveDescription = description ?? preview.data?.metadata?.description ?? "";

  const submit = async () => {
    if (!urls.length) return;
    setSaving(true);
    try {
      const res = await api<{ created: string[]; skipped: { url: string; reason: string }[] }>("/api/from-url", {
        method: "POST",
        json: {
          type,
          items: urls.map((url) => (single ? { url, title: effectiveTitle, description: effectiveDescription, notes } : { url })),
          tags,
          capture: capture && TYPE_DEFS[type].visual,
          skipDuplicates: !single && skipDuplicates,
        },
      });
      invalidate();
      onClose();
      const skipped = res.skipped.length ? ` · ${res.skipped.length} skipped` : "";
      if (res.created.length === 1) {
        const id = res.created[0];
        toast.success(`Saved “${effectiveTitle || urls[0]}”${skipped}`, { action: { label: "Open", onClick: () => router.push(`/r/${id}`) } });
      } else {
        toast.success(`Added ${res.created.length} resources${skipped}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const dupes = preview.data?.duplicates ?? [];

  return (
    <>
        <DialogHeader>
          <DialogTitle>Add from URL</DialogTitle>
          <DialogDescription>Paste one link, or several (one per line) to add them in bulk.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="add-urls">URL{urls.length > 1 ? `s · ${urls.length}` : ""}</Label>
            <Textarea
              id="add-urls"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://linear.app"
              rows={urls.length > 1 ? 5 : 2}
              className="font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ResourceType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {URL_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_DEFS[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end gap-2 pb-1">
              {TYPE_DEFS[type].visual && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={capture} onCheckedChange={(v) => setCapture(!!v)} /> Capture screenshots
                </label>
              )}
              {urls.length > 1 && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={skipDuplicates} onCheckedChange={(v) => setSkipDuplicates(!!v)} /> Skip URLs already saved
                </label>
              )}
            </div>
          </div>

          {single && (
            <div className="space-y-3 rounded-[14px] bg-surface p-4">
              {preview.isFetching && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Fetching page details…
                </p>
              )}
              {preview.data?.error && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3" /> Couldn’t read the page ({preview.data.error}). Fill in the details yourself.
                </p>
              )}
              {preview.error && <p className="text-xs text-danger">{preview.error.message}</p>}
              {dupes.length > 0 && (
                <p className="flex items-center gap-2 text-xs text-warning">
                  <AlertTriangle className="size-3" /> Already saved as{" "}
                  <Link href={`/r/${dupes[0].id}`} onClick={onClose} className="underline">
                    {dupes[0].title}
                  </Link>
                </p>
              )}
              <div className="flex gap-3">
                {preview.data?.metadata?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.data.metadata.imageUrl} alt="" referrerPolicy="no-referrer" className="h-20 w-32 shrink-0 rounded-[10px] object-cover" />
                )}
                <div className="flex-1 space-y-2">
                  <Input value={effectiveTitle} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
                  <Textarea value={effectiveDescription} onChange={(e) => setDescription(e.target.value)} placeholder="Description" aria-label="Description" rows={2} className="text-xs" />
                </div>
              </div>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Personal notes — what is worth stealing here?" aria-label="Notes" rows={2} className="text-xs" />
            </div>
          )}

          <TagsEditor kinds={[...TYPE_DEFS[type].facets, "tag"]} value={tags} onChange={setTags} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!urls.length || saving}>
              {saving && <Loader2 className="animate-spin" />}
              {urls.length > 1 ? `Add ${urls.length} resources` : "Save"}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
