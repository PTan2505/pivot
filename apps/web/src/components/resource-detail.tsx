"use client";

import {
  ArrowLeft,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FolderInput,
  HardDriveDownload,
  HardDriveUpload,
  Loader2,
  PackageOpen,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { extractVariables } from "@stan-bag/core/prompt-vars";
import {
  RESOURCE_TYPES,
  TYPE_DEFS,
  type MetaField,
  type ResourceDetailDTO,
  type ResourceType,
} from "@stan-bag/core/types";
import { AssetGallery, useAttach } from "@/components/asset-gallery";
import { ConfirmButton } from "@/components/confirm-button";
import { Markdown } from "@/components/markdown";
import { AddToCollection } from "@/components/selection-bar";
import { PackField, SkillGuide } from "@/components/skill-guide";
import { SKILL_STATE_LABEL, SKILL_STATE_TONE } from "@/components/skill-sync-panel";
import { TagsEditor } from "@/components/tags-editor";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUi } from "@/components/ui-store";
import { copyContext, useCopyResource } from "@/hooks/use-copy-resource";
import {
  api,
  ApiError,
  useBulk,
  useInvalidate,
  useResource,
  useSkillStatuses,
  useUpdateResource,
  type TagInput,
} from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

interface Draft {
  title: string;
  description: string;
  sourceUrl: string;
  notes: string;
  content: string;
  meta: Record<string, unknown>;
  tags: TagInput[];
  type: ResourceType;
}

function toDraft(r: ResourceDetailDTO): Draft {
  return {
    title: r.title,
    description: r.description,
    sourceUrl: r.sourceUrl ?? "",
    notes: r.notes,
    content: r.content,
    meta: r.meta,
    tags: r.tags.map((t) => ({ kind: t.kind, name: t.name })),
    type: r.type,
  };
}

type SaveState = "saved" | "dirty" | "saving" | "error";

/** Local draft with debounced autosave; flushes on ⌘S, blur of the page and unmount. */
function useAutosave(resource: ResourceDetailDTO) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(resource));
  const [state, setState] = useState<SaveState>("saved");
  const update = useUpdateResource(resource.id);
  const pending = useRef<Partial<Draft>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setState("saving");
    try {
      const res = await update.mutateAsync({
        ...patch,
        sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl || null : undefined,
      });
      // Skills derive title/description from frontmatter on the server.
      if (res.type === "skill") setDraft((d) => ({ ...d, title: res.title, description: res.description }));
      setState(Object.keys(pending.current).length ? "dirty" : "saved");
    } catch (err) {
      pending.current = { ...patch, ...pending.current };
      setState("error");
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  }, [update]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const change = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    pending.current = { ...pending.current, ...patch };
    setState("dirty");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), 700);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flushRef.current();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        flushRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
      flushRef.current();
    };
  }, []);

  return { draft, change, state, flush };
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = { saved: "Saved", dirty: "Unsaved", saving: "Saving…", error: "Not saved" }[state];
  return (
    <span
      role="status"
      className={cn("flex items-center gap-1.5 px-2 text-xs text-ink-subtle", state === "error" && "text-danger")}
    >
      {state === "saving" ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            state === "saved" ? "bg-success" : state === "error" ? "bg-danger" : "bg-warning",
          )}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-normal text-ink-subtle">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-ink-subtle">{hint}</p>}
    </div>
  );
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function ColorsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => {
    const found = input.match(/#(?:[0-9a-f]{3,8})\b/gi)?.filter((c) => HEX_RE.test(c)) ?? [];
    if (!found.length) return toast.error("Enter hex colors like #ff6363");
    onChange([...value, ...found.map((c) => c.toLowerCase())]);
    setInput("");
  };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
          {value.map((c, i) => (
            <div key={`${c}-${i}`} className="group overflow-hidden rounded-[14px] bg-surface">
              <button
                type="button"
                className="block h-14 w-full"
                style={{ background: c }}
                onClick={() => copyText(c, `Copied ${c}`)}
                aria-label={`Copy ${c}`}
              />
              <div className="flex items-center justify-between px-2 py-1 font-mono text-[11px]">
                {c}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="text-ink-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                  aria-label={`Remove ${c}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="#08090a, #ff6363 …"
          className="font-mono text-xs"
          aria-label="Add colors"
        />
        <Button type="submit" size="sm" variant="outline">
          Add
        </Button>
      </form>
    </div>
  );
}

function MetaFieldInput({
  field,
  draft,
  change,
}: {
  field: MetaField;
  draft: Draft;
  change: (p: Partial<Draft>) => void;
}) {
  const v = draft.meta[field.key];
  const set = (value: unknown) => change({ meta: { ...draft.meta, [field.key]: value } });
  const id = `meta-${field.key}`;
  if (field.kind === "colors") return null; // rendered in the main column
  if (field.kind === "list") {
    const list = Array.isArray(v) ? (v as string[]) : [];
    return (
      <Field label={field.label} htmlFor={id} hint="Comma separated">
        <Input
          id={id}
          defaultValue={list.join(", ")}
          placeholder={field.placeholder}
          onBlur={(e) =>
            set(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Field>
    );
  }
  if (field.kind === "textarea") {
    return (
      <Field label={field.label} htmlFor={id}>
        <Textarea
          id={id}
          value={String(v ?? "")}
          onChange={(e) => set(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className="text-[13px]"
        />
      </Field>
    );
  }
  return (
    <Field label={field.label} htmlFor={id}>
      <Input id={id} value={String(v ?? "")} onChange={(e) => set(e.target.value)} placeholder={field.placeholder} />
    </Field>
  );
}

function ContentEditor({
  draft,
  change,
  readOnly = false,
}: {
  draft: Draft;
  change: (p: Partial<Draft>) => void;
  readOnly?: boolean;
}) {
  const def = TYPE_DEFS[draft.type];
  const vars = useMemo(
    () => (draft.type === "prompt" ? extractVariables(draft.content) : []),
    [draft.type, draft.content],
  );
  const jsonError = useMemo(() => {
    if (def.content !== "json" || !draft.content.trim()) return null;
    try {
      JSON.parse(draft.content);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [def.content, draft.content]);

  const editor = (
    <Textarea
      value={draft.content}
      onChange={(e) => change({ content: e.target.value })}
      onKeyDown={(e) => {
        // Tab indents instead of leaving the editor.
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = el;
          const next = `${draft.content.slice(0, s)}  ${draft.content.slice(end)}`;
          change({ content: next });
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
        }
      }}
      spellCheck={def.content === "markdown"}
      aria-label="Content"
      placeholder={
        draft.type === "prompt" ? "Write the prompt. Use {{variable}} or {{variable|default}} for blanks." : "Content…"
      }
      className="min-h-[55vh] resize-y font-mono text-[12.5px] leading-relaxed"
    />
  );

  if (readOnly) {
    // Plugin skills: show the file, never an editor.
    return (
      <section className="space-y-2" aria-label="Content">
        <div className="min-h-[30vh] rounded-[14px] bg-surface px-6 py-5">
          <Markdown>{draft.content}</Markdown>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2" aria-label="Content">
      {def.content === "markdown" ? (
        <Tabs defaultValue={draft.content.trim() && draft.type !== "prompt" ? "preview" : "write"}>
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write">{editor}</TabsContent>
          <TabsContent value="preview">
            <div className="min-h-[55vh] rounded-[14px] bg-surface px-6 py-5">
              {draft.content.trim() ? (
                <Markdown interactiveChecks={draft.type === "checklist"}>{draft.content}</Markdown>
              ) : (
                <p className="text-sm text-ink-muted">Nothing to preview.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        editor
      )}
      {jsonError && <p className="font-mono text-xs text-danger">JSON: {jsonError}</p>}
      {vars.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
          Variables:
          {vars.map((v) => (
            <code key={v.name} className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-[11px] text-ink">
              {v.name}
              {v.defaultValue && <span className="text-ink-subtle"> = {v.defaultValue}</span>}
            </code>
          ))}
        </p>
      )}
    </section>
  );
}

function SkillBar({ resource, flush }: { resource: ResourceDetailDTO; flush: () => Promise<void> }) {
  const { data: statuses } = useSkillStatuses();
  const invalidate = useInvalidate();
  const status = statuses?.find((s) => s.resourceId === resource.id);
  const [busy, setBusy] = useState(false);

  const write = async (force = false) => {
    setBusy(true);
    try {
      await flush();
      const r = await api<{ path: string }>(`/api/skills/${resource.id}/write`, { method: "POST", json: { force } });
      toast.success(`Saved to ${r.path}`);
      invalidate(resource.id);
    } catch (err) {
      if (err instanceof ApiError && err.data.conflict)
        toast.error(err.message, { description: "Use “Overwrite disk” or “Use disk version”." });
      else toast.error(err instanceof Error ? err.message : "Could not write skill");
    } finally {
      setBusy(false);
    }
  };
  const pull = async () => {
    setBusy(true);
    try {
      await api(`/api/skills/${resource.id}/pull`, { method: "POST" });
      invalidate(resource.id);
      toast.success("Loaded the version from disk");
      // The editor keeps a local draft, so reload it from the server.
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read skill");
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? "missing";
  if (resource.meta.readonly) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface px-4 py-3 text-xs">
        <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary">
          Plugin skill · read-only
        </span>
        <span className="truncate font-mono text-ink-subtle">
          {status?.dirPath ?? String(resource.meta.dirPath ?? "")}
        </span>
        <span className="text-ink-subtle">Updated by the plugin; the guide and notes here are yours to edit.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface px-4 py-3 text-xs">
      <span className="font-mono text-ink-subtle">{status?.dirPath ?? "Not on disk yet"}</span>
      {status?.isSymlink && (
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-secondary">symlink</span>
      )}
      <span className={cn("font-medium", SKILL_STATE_TONE[state])}>
        {status ? SKILL_STATE_LABEL[state] : "Not saved to disk"}
      </span>
      <div className="ml-auto flex gap-1.5">
        {(state === "disk-changed" || state === "conflict") && (
          <Button size="sm" variant="secondary" className="bg-surface-raised" onClick={pull} disabled={busy}>
            <HardDriveDownload /> Use disk version
          </Button>
        )}
        {state === "conflict" ? (
          <ConfirmButton
            title="Overwrite SKILL.md on disk?"
            description="The file was changed outside Stan Bag. Writing now replaces those changes with the version here."
            confirmLabel="Overwrite disk"
            onConfirm={() => write(true)}
          >
            <Button size="sm" disabled={busy}>
              <HardDriveUpload /> Overwrite disk
            </Button>
          </ConfirmButton>
        ) : (
          state !== "synced" &&
          state !== "disk-changed" && (
            <Button size="sm" onClick={() => write(false)} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <HardDriveUpload />} Save to disk
            </Button>
          )
        )}
      </div>
    </div>
  );
}

function Editor({ resource }: { resource: ResourceDetailDTO }) {
  const router = useRouter();
  const { draft, change, state, flush } = useAutosave(resource);
  const def = TYPE_DEFS[draft.type];
  const copy = useCopyResource();
  const bulk = useBulk();
  const { openExport } = useUi();
  const attach = useAttach(resource.id);
  const titleRef = useRef<HTMLInputElement>(null);
  const isNew = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("new");

  useEffect(() => {
    if (isNew) titleRef.current?.select();
  }, [isNew]);

  // Pasting files on a resource page attaches them here instead of creating new resources.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      attach(files);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [attach]);

  const trash = async () => {
    await flush();
    await bulk.mutateAsync({ action: "trash", ids: [resource.id] });
    router.push(`/?type=${resource.type}`);
    toast("Moved to trash", {
      action: { label: "Undo", onClick: () => bulk.mutate({ action: "restore", ids: [resource.id] }) },
    });
  };

  const removeFromCollection = (collectionId: string) =>
    bulk.mutate({ action: "removeFromCollection", ids: [resource.id], collectionId });

  const colors = Array.isArray(draft.meta.colors) ? (draft.meta.colors as string[]) : [];
  const showGallery = def.visual || resource.assets.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-5 px-4 pt-6 md:px-10 md:pt-8">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Back"
            onClick={() => (history.length > 1 ? router.back() : router.push("/"))}
          >
            <ArrowLeft />
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/?type=${draft.type}`}>
              <TypeIcon type={draft.type} /> {def.plural}
            </Link>
          </Button>
          <SaveIndicator state={state} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {draft.sourceUrl && (
              <Button variant="secondary" asChild>
                <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open
                </a>
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => flush().then(() => copy({ ...resource, content: draft.content, type: draft.type }))}
            >
              <Copy /> Copy
            </Button>
            <Button variant="secondary" onClick={() => flush().then(() => copyContext([resource.id]))}>
              <ClipboardCopy /> Context
            </Button>
            <Button onClick={() => flush().then(() => openExport({ ids: [resource.id], name: draft.title }))}>
              <PackageOpen /> Export
            </Button>
            <Button variant="destructive" size="icon" aria-label="Move to trash" onClick={trash}>
              <Trash2 />
            </Button>
          </div>
        </div>
        <input
          ref={titleRef}
          value={draft.title}
          onChange={(e) => change({ title: e.target.value })}
          readOnly={draft.type === "skill"}
          title={draft.type === "skill" ? "Skill names come from the frontmatter `name`" : undefined}
          aria-label="Title"
          className="w-full min-w-0 bg-transparent text-[clamp(32px,4.5vw,56px)] leading-[1] font-medium tracking-[-0.04em] text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
          placeholder="Untitled"
        />
      </header>

      <div className="grid flex-1 gap-10 px-4 pt-6 pb-16 md:px-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {draft.type === "skill" && <SkillBar resource={resource} flush={flush} />}
          {draft.type === "skill" && <SkillGuide meta={draft.meta} sourceUrl={draft.sourceUrl} onChange={change} />}
          {draft.type === "typography" && (
            <section className="space-y-3" aria-label="Palette">
              <h2 className="text-xs text-ink-subtle">Colors</h2>
              <ColorsEditor value={colors} onChange={(v) => change({ meta: { ...draft.meta, colors: v } })} />
              {Array.isArray(draft.meta.fonts) && (draft.meta.fonts as string[]).length > 0 && (
                <div className="space-y-2 pt-2">
                  <h2 className="text-xs text-ink-subtle">Fonts</h2>
                  {(draft.meta.fonts as string[]).map((f) => (
                    <p key={f} className="truncate text-2xl" style={{ fontFamily: `"${f}", var(--font-sans)` }}>
                      {f} — The quick brown fox
                    </p>
                  ))}
                </div>
              )}
            </section>
          )}
          {showGallery && <AssetGallery resource={resource} compact={!def.visual} />}
          {def.content !== "none" && (
            <ContentEditor draft={draft} change={change} readOnly={!!resource.meta.readonly} />
          )}
          {!def.visual && resource.assets.length === 0 && (
            <p className="text-xs text-ink-subtle">Paste or drop files on this page to attach them.</p>
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start" aria-label="Details">
          {draft.type !== "skill" && (
            <Field label="Description" htmlFor="desc">
              <Textarea
                id="desc"
                value={draft.description}
                onChange={(e) => change({ description: e.target.value })}
                rows={3}
                placeholder="One or two lines to recognise it later"
              />
            </Field>
          )}
          <Field label="Source URL" htmlFor="url">
            <Input
              id="url"
              value={draft.sourceUrl}
              onChange={(e) => change({ sourceUrl: e.target.value })}
              placeholder="https://"
              className="font-mono text-xs"
            />
          </Field>
          {draft.type === "skill" && <PackField meta={draft.meta} onChange={change} />}
          {def.fields.map((f) => (
            <MetaFieldInput key={f.key} field={f} draft={draft} change={change} />
          ))}
          <div className="space-y-2">
            <Label className="text-xs font-normal text-ink-subtle">Classification</Label>
            <TagsEditor kinds={[...def.facets, "tag"]} value={draft.tags} onChange={(tags) => change({ tags })} />
          </div>
          <Field label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              value={draft.notes}
              onChange={(e) => change({ notes: e.target.value })}
              rows={5}
              placeholder="What’s good about it, how to use it…"
            />
          </Field>
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-ink-subtle">Collections</Label>
            <div className="flex flex-wrap items-center gap-1">
              {resource.collections.map((c) => (
                <span
                  key={c.id}
                  className="flex h-7 items-center gap-1 rounded-full bg-surface pr-1.5 pl-3 text-xs font-medium text-ink-secondary"
                >
                  <Link href={`/collections/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeFromCollection(c.id)}
                    className="grid size-4 place-items-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                    aria-label={`Remove from ${c.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <AddToCollection ids={[resource.id]}>
                <Button variant="secondary" size="xs" className="h-7 text-ink-muted">
                  <FolderInput /> Add
                </Button>
              </AddToCollection>
            </div>
          </div>
          <Field label="Type" htmlFor="type">
            <Select value={draft.type} onValueChange={(v) => change({ type: v as ResourceType })}>
              <SelectTrigger id="type" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    <TypeIcon type={t} /> {TYPE_DEFS[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <dl className="grid grid-cols-[72px_1fr] gap-y-1 border-t border-divider pt-5 text-xs text-ink-subtle">
            <dt>Added</dt>
            <dd className="font-mono">{new Date(resource.createdAt).toLocaleString()}</dd>
            <dt>Edited</dt>
            <dd className="font-mono">{new Date(resource.updatedAt).toLocaleString()}</dd>
            {resource.assets.length > 0 && (
              <>
                <dt>Files</dt>
                <dd className="font-mono">{resource.assets.length}</dd>
              </>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}

export function ResourceDetail({ id }: { id: string }) {
  const { data, isLoading, error } = useResource(id);
  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="aspect-[16/9] w-full max-w-4xl rounded-xl" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {error instanceof ApiError && error.status === 404 ? "Resource not found" : "Could not load this resource"}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to library</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <Editor key={data.id} resource={data} />;
}
