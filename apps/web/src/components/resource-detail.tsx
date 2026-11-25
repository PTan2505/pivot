"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  HardDriveDownload,
  HardDriveUpload,
  Link2,
  Loader2,
  MoreHorizontal,
  PackageOpen,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { extractVariables } from "@pivot/core/prompt-vars";
import {
  addableTypes,
  isAgentType,
  TYPE_DEFS,
  type ComponentMeta,
  type MyDesignMeta,
  type MetaField,
  type ResourceDetailDTO,
  type ResourceLinkDTO,
  type ResourceType,
} from "@pivot/core/types";
import { AssetGallery, useAttach } from "@/components/asset-gallery";
import { Breadcrumbs, typeCrumbs } from "@/components/breadcrumbs";
import { scanWarning } from "@/components/code-stage";
import {
  ComponentAboutSummary,
  ComponentFacts,
  ComponentMain,
  ComponentReview,
  ComponentUsedIn,
  componentMeta,
  ReviewSummary,
  usedInSummary,
} from "@/components/component-detail";
import {
  MyDesignAbout,
  myDesignAboutSummary,
  MyDesignMain,
  myDesignMeta,
  MyDesignScan,
  MyDesignTechnical,
} from "@/components/my-design-detail";
import { ConfirmButton } from "@/components/confirm-button";
import { Markdown } from "@/components/markdown";
import { AddToCollection } from "@/components/selection-bar";
import { PackField, SkillGuide } from "@/components/skill-guide";
import { SKILL_STATE_LABEL, SKILL_STATE_TONE } from "@/components/skill-sync-panel";
import { SkillWriteDialog } from "@/components/skill-write-dialog";
import { SourceInfo } from "@/components/source-groups";
import { TagsEditor } from "@/components/tags-editor";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUi } from "@/components/ui-store";
import { ResourceLinks } from "@/components/resource-links";
import { Suggestions } from "@/components/suggestions";
import { copyContext, useCopyResource } from "@/hooks/use-copy-resource";
import {
  api,
  ApiError,
  useBulk,
  useInvalidate,
  useResource,
  useShowOther,
  useSkillStatuses,
  useUpdateResource,
  type TagInput,
} from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { openableUrl } from "@/lib/url";
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

type SaveState = "idle" | "saved" | "dirty" | "saving" | "error";

/** Local draft with debounced autosave; flushes on ⌘S, blur of the page and unmount. */
function useAutosave(resource: ResourceDetailDTO) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(resource));
  const [state, setState] = useState<SaveState>("idle");
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

/**
 * The save state, said once: "Saving…" and "Saved" in a polite live region (no dot on screen); only a failed save
 * shows, in danger.
 */
function SaveStatus({ state }: { state: SaveState }) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}
      </span>
      {state === "error" && (
        <span role="alert" className="flex items-center gap-1.5 px-2 text-xs text-danger">
          <AlertTriangle className="size-3.5" aria-hidden /> Not saved
        </span>
      )}
    </>
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
              <div className="flex items-center justify-between px-2 py-1 font-mono text-[12px]">
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
  if (field.kind === "select") {
    return (
      <Field label={field.label} htmlFor={id}>
        <Select value={typeof v === "string" ? v : ""} onValueChange={set}>
          <SelectTrigger id={id} size="sm" className="w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          className="text-[14px]"
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
            <code key={v.name} className="rounded-full bg-surface px-2.5 py-0.5 font-mono text-[12px] text-ink">
              {v.name}
              {v.defaultValue && <span className="text-ink-subtle"> = {v.defaultValue}</span>}
            </code>
          ))}
        </p>
      )}
    </section>
  );
}

function SkillBar({
  resource,
  flush,
  content,
}: {
  resource: ResourceDetailDTO;
  flush: () => Promise<void>;
  content: string;
}) {
  const { data: statuses } = useSkillStatuses();
  const invalidate = useInvalidate();
  const status = statuses?.find((s) => s.resourceId === resource.id);
  const [busy, setBusy] = useState(false);

  // writing to disk is owner only: the dialog asks for the owner passphrase (null while closed, else whether to force)
  const [writing, setWriting] = useState<null | { force: boolean }>(null);
  const write = (force = false) => setWriting({ force });
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
        <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[12px] font-medium text-ink-secondary">
          Plugin skill · read-only
        </span>
        <span className="text-ink-subtle">Updated by the plugin; the guide and notes here are yours to edit.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface px-4 py-3 text-xs">
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
            description="The file was changed outside PIVOT. Writing now replaces those changes with the version here."
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
      <SkillWriteDialog
        resourceId={resource.id}
        content={content}
        force={!!writing?.force}
        open={!!writing}
        onOpenChange={(o) => !o && setWriting(null)}
        flush={flush}
        onWritten={() => invalidate(resource.id)}
      />
    </div>
  );
}

function Editor({ resource }: { resource: ResourceDetailDTO }) {
  const router = useRouter();
  const { draft, change, state, flush } = useAutosave(resource);
  const def = TYPE_DEFS[draft.type];
  const attach = useAttach(resource.id);
  const bulk = useBulk();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // browsers without `field-sizing` (Firefox, Safari before 26) grow the title field by hand, so a long title wraps in full
  useEffect(() => {
    const t = titleRef.current;
    if (!t || CSS.supports("field-sizing", "content")) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [draft.title]);
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

  const removeFromCollection = (collectionId: string) =>
    bulk.mutate({ action: "removeFromCollection", ids: [resource.id], collectionId });

  const colors = Array.isArray(draft.meta.colors) ? (draft.meta.colors as string[]) : [];
  // a component saved with its code gets its own page body (component-detail.tsx); the header and inspector stay
  const component = draft.type === "component" ? componentMeta(resource.meta) : null;
  // one of the owner's saved designs gets the same page body, with its own facts (my-design-detail.tsx)
  const design = draft.type === "my_design" ? myDesignMeta(resource.meta) : null;
  const showGallery = !component && !design && (def.visual || resource.assets.length > 0);
  // the parent only: the title is on the page once, as the heading
  const parent = typeCrumbs(draft.type).slice(-1);

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-col gap-3 px-4 pt-6 md:px-10 md:pt-8">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Back"
            className="max-sm:size-11"
            onClick={() => (history.length > 1 ? router.back() : router.push("/"))}
          >
            <ArrowLeft />
          </Button>
          <Breadcrumbs items={parent} current={false} />
          <SaveStatus state={state} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="min-w-0 flex-[1_1_20rem]">
            {/* a one-line field that wraps, so a long title reads in full on a phone; Enter doesn't add a line */}
            <textarea
              ref={titleRef}
              rows={1}
              value={draft.title}
              onChange={(e) => change({ title: e.target.value.replace(/\r?\n/g, " ") })}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              readOnly={draft.type === "skill"}
              title={draft.type === "skill" ? "Skill names come from the frontmatter `name`" : undefined}
              aria-label="Title"
              className="block field-sizing-content w-full min-w-0 resize-none overflow-hidden bg-transparent text-3xl leading-tight font-medium tracking-[-0.02em] text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none max-sm:text-[26px]"
              placeholder="Untitled"
            />
          </h1>
          <HeaderActions
            resource={resource}
            draft={draft}
            change={change}
            flush={flush}
            component={!!component}
            design={!!design}
          />
        </div>
      </header>

      <div className="grid flex-1 gap-6 px-4 pt-5 pb-16 md:px-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="min-w-0 space-y-5">
          {resource.reviewStatus === "needs_review" && <ReviewBanner id={resource.id} />}
          <Suggestions resourceId={resource.id} />
          {draft.type === "skill" && <SkillBar resource={resource} flush={flush} content={draft.content ?? ""} />}
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
          {component && <ComponentMain c={component} id={resource.id} title={draft.title || resource.title} />}
          {design && (
            <MyDesignMain d={design} id={resource.id} title={draft.title || resource.title} assets={resource.assets} />
          )}
          {def.content !== "none" && !component && !design && (
            <ContentEditor
              draft={draft}
              change={change}
              readOnly={!!resource.meta.readonly || isAgentType(draft.type)}
            />
          )}
          {!def.visual && resource.assets.length === 0 && (
            <p className="text-xs text-ink-subtle">Paste or drop files on this page to attach them.</p>
          )}
        </div>

        <Inspector
          resource={resource}
          draft={draft}
          change={change}
          onRemoveFromCollection={removeFromCollection}
          component={component}
          design={design}
        />
      </div>
    </div>
  );
}

const HEADER_PILL = "max-sm:h-11 max-sm:flex-1";

/**
 * The type's main actions as secondary pills, then one "More actions" menu with the rest: the other copies, the
 * original page, Export, Change type and, last after a separator, Move to trash. Nothing here is ember: the top
 * bar's Add stays the screen's one primary.
 */
function HeaderActions({
  resource,
  draft,
  change,
  flush,
  component,
  design,
}: {
  resource: ResourceDetailDTO;
  draft: Draft;
  change: (patch: Partial<Draft>) => void;
  flush: () => Promise<void>;
  component: boolean;
  design: boolean;
}) {
  const router = useRouter();
  const copy = useCopyResource();
  const bulk = useBulk();
  const { openExport } = useUi();
  const showOther = useShowOther();
  const def = TYPE_DEFS[draft.type];
  const href = openableUrl(draft.sourceUrl);
  // with no content of its own, Copy builds the same block as Copy for Claude, so it isn't offered twice
  const copyIsContext = !component && !design && (def.content === "none" || !draft.content.trim());
  const fixedType = isAgentType(draft.type);
  const types = addableTypes(showOther);
  if (!types.includes(draft.type)) types.push(draft.type);

  const doCopy = () => flush().then(() => copy({ ...resource, content: draft.content, type: draft.type }));
  const forClaude = () => flush().then(() => copyContext([resource.id]));
  const trash = async () => {
    await flush();
    await bulk.mutateAsync({ action: "trash", ids: [resource.id] });
    router.push(`/?type=${resource.type}`);
    toast("Moved to trash", {
      action: { label: "Undo", onClick: () => bulk.mutate({ action: "restore", ids: [resource.id] }) },
    });
  };

  const openLabel = component ? "Open on 21st.dev" : def.visual ? "Open site" : "Open source";
  const openLink = href && (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <ExternalLink /> {openLabel}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  const copyLabel = component || design ? "Copy code" : "Copy";
  // the first actions by type: Open site for a page you can visit, the code or the zip for components and designs
  const openIsMain = href && def.visual && !component && !design;
  const copyIsMain = !design && !openIsMain && !copyIsContext;

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
      {design && (
        <Button variant="secondary" asChild className={HEADER_PILL}>
          <a href={`/api/my-designs/${resource.id}/zip`} download>
            <Download /> Download zip
          </a>
        </Button>
      )}
      {openIsMain && (
        <Button variant="secondary" asChild className={HEADER_PILL}>
          {openLink}
        </Button>
      )}
      {copyIsMain && (
        <Button variant="secondary" className={HEADER_PILL} onClick={doCopy}>
          <Copy /> {copyLabel}
        </Button>
      )}
      <Button variant="secondary" className={HEADER_PILL} onClick={forClaude}>
        <ClipboardCopy /> Copy for Claude
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="More actions" className="max-sm:size-11">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {!copyIsMain && !copyIsContext && (
            <DropdownMenuItem onSelect={doCopy}>
              <Copy /> {copyLabel}
            </DropdownMenuItem>
          )}
          {openIsMain && (
            <DropdownMenuItem onSelect={() => copyText(href, "Link copied")}>
              <Link2 /> Copy link
            </DropdownMenuItem>
          )}
          {href && !openIsMain && <DropdownMenuItem asChild>{openLink}</DropdownMenuItem>}
          {showOther && (
            <DropdownMenuItem
              onSelect={() => flush().then(() => openExport({ ids: [resource.id], name: draft.title }))}
            >
              <PackageOpen /> Export…
            </DropdownMenuItem>
          )}
          {!fixedType && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <TypeIcon type={draft.type} /> Change type
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-48">
                <DropdownMenuRadioGroup value={draft.type} onValueChange={(t) => change({ type: t as ResourceType })}>
                  {types.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      {TYPE_DEFS[t].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={trash}>
            <Trash2 /> Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The collections a resource is in, each removable, and Add. `nested`: inside a surface panel. */
function CollectionsField({
  resource,
  onRemove,
  nested = false,
  label = true,
}: {
  resource: ResourceDetailDTO;
  onRemove: (collectionId: string) => void;
  nested?: boolean;
  /** Off inside the inspector's Collections row, which already names it. */
  label?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {label && <Label className="text-xs font-normal text-ink-subtle">Collections</Label>}
      <div className="flex flex-wrap items-center gap-1">
        {resource.collections.map((c) => (
          <span
            key={c.id}
            className={cn(
              "flex h-7 items-center gap-1 rounded-full pr-1.5 pl-3 text-xs font-medium text-ink-secondary",
              nested ? "bg-surface-raised" : "bg-surface",
            )}
          >
            <Link href={`/collections/${c.id}`} className="hover:underline">
              {c.name}
            </Link>
            <button
              type="button"
              onClick={() => onRemove(c.id)}
              className="grid size-4 place-items-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
              aria-label={`Remove from ${c.name}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <AddToCollection ids={[resource.id]}>
          <Button
            variant="secondary"
            size="xs"
            className={cn("h-7 text-ink-muted max-sm:h-11", nested && "bg-surface-raised")}
          >
            <FolderInput /> Add
          </Button>
        </AddToCollection>
      </div>
    </div>
  );
}

function TypeSelect({
  value,
  onChange,
  className,
}: {
  value: ResourceType;
  onChange: (type: ResourceType) => void;
  className?: string;
}) {
  // the design types, plus this item's own type when it is one of the hidden ones; a component stays a component
  const addable = addableTypes(useShowOther());
  const fixed = isAgentType(value);
  const types = fixed ? [value] : addable;
  if (!types.includes(value)) types.push(value);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ResourceType)} disabled={fixed}>
      <SelectTrigger id="type" size="sm" className={className} aria-label="Type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {types.map((t) => (
          <SelectItem key={t} value={t}>
            <TypeIcon type={t} /> {TYPE_DEFS[t].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One row of the inspector: a solid surface card whose summary line names it and says what it holds in one line
 * ("Tags · 3", "Collections · none"). A native `<details>`, so several can be open at once and find-in-page reaches
 * closed text. `open`/`onOpenChange` make it controlled (the scan warning opens Review or Technical details).
 */
function InspectorRow({
  title,
  summary,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  rowRef,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  rowRef?: React.Ref<HTMLDetailsElement>;
  children: React.ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  return (
    <details
      ref={rowRef}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        setOwn(next);
        onOpenChange?.(next);
      }}
      className="group rounded-[14px] bg-surface px-4 py-2"
    >
      <summary className="-mx-2 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 text-ink-subtle group-open:rotate-90" aria-hidden />
        <span className="shrink-0 font-medium text-ink">{title}</span>
        {summary !== undefined && (
          <span className="ml-auto flex min-w-0 justify-end truncate text-xs text-ink-subtle">{summary}</span>
        )}
      </summary>
      <div className="space-y-3 pt-1 pb-2">{children}</div>
    </details>
  );
}

// Fields inside a surface panel step up one surface, so they stay visible.
const NESTED_FIELD = "bg-surface-raised hover:bg-surface-raised";

/** The page's own description, often long: three lines until you open it to read or edit. */
function DescriptionField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!value && !open)
    return (
      <Button variant="ghost" size="xs" className="-ml-2.5 text-ink-muted max-sm:h-11" onClick={() => setOpen(true)}>
        <Plus /> Description
      </Button>
    );
  if (!open)
    return (
      <div className="space-y-1">
        <p className="line-clamp-3 text-[13px] leading-relaxed text-ink-secondary">{value}</p>
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2.5 text-accent-text max-sm:h-11"
          onClick={() => setOpen(true)}
        >
          Show all and edit
        </Button>
      </div>
    );
  return (
    <Field label="Description" htmlFor="desc">
      <Textarea
        id="desc"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="One or two lines to recognise it later"
        className={NESTED_FIELD}
      />
    </Field>
  );
}

/** The source link as a link you can open, with Edit for the field; an empty one is a ghost "+ Source link". */
function SourceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const href = openableUrl(value);
  if (!editing && !value)
    return (
      <Button variant="ghost" size="xs" className="-ml-2.5 text-ink-muted max-sm:h-11" onClick={() => setEditing(true)}>
        <Plus /> Source link
      </Button>
    );
  if (!editing)
    return (
      <div className="flex min-w-0 items-center gap-1 text-[13px]">
        <ExternalLink className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-accent-text hover:underline"
          >
            {value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="min-w-0 truncate font-mono text-xs text-ink-secondary">{value}</span>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto shrink-0 text-ink-muted max-sm:h-11"
          aria-label="Edit the source link"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      </div>
    );
  return (
    <Field label="Source URL" htmlFor="url">
      <Input
        id="url"
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="https://"
        className={cn("font-mono text-xs", NESTED_FIELD)}
      />
    </Field>
  );
}

/** Who published it and where it first appeared: shown when filled or when you add one. */
function AttributionFields({ draft, change }: { draft: Draft; change: (patch: Partial<Draft>) => void }) {
  const publishedBy = typeof draft.meta.publishedBy === "string" ? draft.meta.publishedBy : "";
  const originalSource = typeof draft.meta.originalSource === "string" ? draft.meta.originalSource : "";
  const [shown, setShown] = useState({ publishedBy: !!publishedBy, originalSource: !!originalSource });
  const show = (key: keyof typeof shown) => setShown((s) => ({ ...s, [key]: true }));
  return (
    <>
      {shown.publishedBy && (
        <Field label="Published by" htmlFor="published-by">
          <Input
            id="published-by"
            autoFocus={!publishedBy}
            value={publishedBy}
            onChange={(e) => change({ meta: { ...draft.meta, publishedBy: e.target.value } })}
            placeholder="The account or studio that posted it"
            className={NESTED_FIELD}
          />
        </Field>
      )}
      {shown.originalSource && (
        <Field label="Original source" htmlFor="original-source">
          <Input
            id="original-source"
            autoFocus={!originalSource}
            value={originalSource}
            onChange={(e) => change({ meta: { ...draft.meta, originalSource: e.target.value } })}
            placeholder="Where it first appeared, if you know"
            className={cn("font-mono text-xs", NESTED_FIELD)}
          />
        </Field>
      )}
      {(!shown.publishedBy || !shown.originalSource) && (
        <div className="-ml-2.5 flex flex-wrap gap-1">
          {!shown.publishedBy && (
            <Button
              variant="ghost"
              size="xs"
              className="text-ink-muted max-sm:h-11"
              onClick={() => show("publishedBy")}
            >
              <Plus /> Published by
            </Button>
          )}
          {!shown.originalSource && (
            <Button
              variant="ghost"
              size="xs"
              className="text-ink-muted max-sm:h-11"
              onClick={() => show("originalSource")}
            >
              <Plus /> Original source
            </Button>
          )}
        </div>
      )}
    </>
  );
}

const hostOf = (url: string) => {
  const href = openableUrl(url);
  return href ? new URL(href).hostname.replace(/^www\./, "") : null;
};
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The inspector (direction C, 2026-11-25): the right column of every type's page, a list of rows that each say
 * what they hold in one line. About, Tags and Notes are open (Notes always), the rest open on demand; a scan with
 * flags keeps a one-line warning in view; Technical details (type, dates, files, ids, paths, scan) comes last,
 * closed. At phone width it stacks under the content. Every field of the old side panels is here.
 */
function Inspector({
  resource,
  draft,
  change,
  onRemoveFromCollection,
  component = null,
  design = null,
}: {
  resource: ResourceDetailDTO;
  draft: Draft;
  change: (patch: Partial<Draft>) => void;
  onRemoveFromCollection: (collectionId: string) => void;
  component?: ComponentMeta | null;
  design?: MyDesignMeta | null;
}) {
  const def = TYPE_DEFS[draft.type];
  const { data: linkData } = useQuery({
    queryKey: ["links", resource.id],
    queryFn: () => api<{ links: ResourceLinkDTO[] }>(`/api/resources/${resource.id}/links`),
  });
  const { data: skillStatuses } = useSkillStatuses(draft.type === "skill");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const reviewRef = useRef<HTMLDetailsElement>(null);
  const techRef = useRef<HTMLDetailsElement>(null);

  const links = linkData?.links ?? [];
  const suggested = links.filter((l) => !l.confirmed).length;
  const host = hostOf(draft.sourceUrl);
  const warning = scanWarning(component?.scan ?? design?.scan);
  const skillStatus = skillStatuses?.find((x) => x.resourceId === resource.id);
  const skillDir = skillStatus?.dirPath ?? (typeof resource.meta.dirPath === "string" ? resource.meta.dirPath : null);
  const reveal = (which: "review" | "tech") => {
    const ref = which === "review" ? reviewRef : techRef;
    (which === "review" ? setReviewOpen : setTechOpen)(true);
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "nearest" });
      ref.current?.querySelector("summary")?.focus();
    });
  };

  return (
    <aside className="space-y-2 lg:self-start" aria-label="Details">
      <InspectorRow
        title="About"
        defaultOpen
        summary={
          component ? (
            <ComponentAboutSummary c={component} />
          ) : design ? (
            myDesignAboutSummary(design)
          ) : (
            (host ?? "No source")
          )
        }
      >
        {component && <ComponentFacts c={component} />}
        {design && <MyDesignAbout d={design} />}
        {!component && !design && (
          <SourceField value={draft.sourceUrl} onChange={(sourceUrl) => change({ sourceUrl })} />
        )}
        {draft.type !== "skill" && (
          <DescriptionField value={draft.description} onChange={(description) => change({ description })} />
        )}
        {typeof draft.meta.section === "object" && draft.meta.section !== null && (
          <SectionInfo section={draft.meta.section as Record<string, unknown>} />
        )}
        {typeof draft.meta.externalOrigin === "object" && draft.meta.externalOrigin !== null && (
          <ExternalOriginInfo origin={draft.meta.externalOrigin as Record<string, unknown>} />
        )}
        {def.visual && !component && !design && <AttributionFields draft={draft} change={change} />}
        {draft.type === "skill" && <PackField meta={draft.meta} onChange={change} />}
        {def.fields.map((f) => (
          <MetaFieldInput key={f.key} field={f} draft={draft} change={change} />
        ))}
      </InspectorRow>

      <InspectorRow title="Tags" defaultOpen summary={draft.tags.length ? String(draft.tags.length) : "none"}>
        <TagsEditor kinds={[...def.facets, "tag"]} value={draft.tags} onChange={(tags) => change({ tags })} onlySet />
      </InspectorRow>

      <section aria-label="Notes" className="space-y-2 rounded-[14px] bg-surface px-4 pt-2.5 pb-3">
        <Label htmlFor="notes" className="text-sm font-medium text-ink">
          Notes
        </Label>
        <Textarea
          id="notes"
          value={draft.notes}
          onChange={(e) => change({ notes: e.target.value })}
          rows={3}
          placeholder="What’s good about it, how to use it…"
          className={NESTED_FIELD}
        />
      </section>

      <InspectorRow
        title="Collections"
        summary={resource.collections.length ? resource.collections.map((c) => c.name).join(", ") : "none"}
      >
        <CollectionsField resource={resource} onRemove={onRemoveFromCollection} nested label={false} />
      </InspectorRow>

      <InspectorRow
        title="Links"
        summary={
          links.length === 0
            ? "none"
            : `${links.length} ${links.length === 1 ? "link" : "links"}${suggested ? ` · ${suggested} suggested` : ""}`
        }
      >
        <ResourceLinks resourceId={resource.id} nested bare />
      </InspectorRow>

      {component && (
        <InspectorRow
          title="Review"
          summary={<ReviewSummary c={component} />}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          rowRef={reviewRef}
        >
          <ComponentReview c={component} />
        </InspectorRow>
      )}
      {component && (
        <InspectorRow title="Used in" summary={usedInSummary(component)}>
          <ComponentUsedIn c={component} />
        </InspectorRow>
      )}

      {draft.type === "source" && <SourceInfo id={resource.id} searchUrl={draft.meta.searchUrl} />}

      {warning && (
        <div role="note" className="flex items-center gap-2 rounded-[14px] bg-surface py-1.5 pr-1.5 pl-4 text-[13px]">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-hidden />
          <span className="min-w-0 flex-1 text-ink-secondary">{warning}</span>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-accent-text max-sm:h-11"
            onClick={() => reveal(component ? "review" : "tech")}
          >
            Details
          </Button>
        </div>
      )}

      <InspectorRow
        title="Technical details"
        summary={`${def.label}${resource.assets.length ? ` · ${resource.assets.length} ${resource.assets.length === 1 ? "file" : "files"}` : ""}`}
        open={techOpen}
        onOpenChange={setTechOpen}
        rowRef={techRef}
      >
        <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-xs text-ink-subtle">
          <dt>Type</dt>
          <dd>
            <TypeSelect value={draft.type} onChange={(type) => change({ type })} className={NESTED_FIELD} />
          </dd>
          <dt>Added</dt>
          <dd className="font-mono text-ink-muted">
            <time dateTime={resource.createdAt}>{when(resource.createdAt)}</time>
          </dd>
          <dt>Edited</dt>
          <dd className="font-mono text-ink-muted">
            <time dateTime={resource.updatedAt}>{when(resource.updatedAt)}</time>
          </dd>
          {resource.assets.length > 0 && (
            <>
              <dt>Files</dt>
              <dd className="font-mono text-ink-muted">{resource.assets.length}</dd>
            </>
          )}
          {component && (
            <>
              <dt>Code files</dt>
              <dd className="font-mono text-ink-muted">{component.files.length}</dd>
              <dt>21st id</dt>
              <dd className="font-mono text-ink-muted">{component.providerId}</dd>
              <dt>Fetched</dt>
              <dd className="font-mono text-ink-muted">{component.fetchedAt.slice(0, 10)}</dd>
            </>
          )}
          {design && <MyDesignTechnical d={design} />}
          {draft.type === "skill" && (
            <>
              <dt>Folder</dt>
              <dd className="min-w-0 font-mono break-all text-ink-muted">
                {skillDir ?? "Not on disk yet"}
                {skillStatus?.isSymlink && <span className="font-sans text-ink-subtle"> · symlink</span>}
              </dd>
            </>
          )}
          {typeof draft.meta.capturedUrl === "string" && (
            <>
              <dt>Captured from</dt>
              <dd className="min-w-0 font-mono break-all text-ink-muted">{draft.meta.capturedUrl}</dd>
            </>
          )}
          <dt>Id</dt>
          <dd className="min-w-0 font-mono break-all text-ink-muted">{resource.id}</dd>
        </dl>
        {design && <MyDesignScan d={design} />}
      </InspectorRow>
    </aside>
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

/** A quick save waiting in the Inbox: organise it, then take it out. */
function ReviewBanner({ id }: { id: string }) {
  const bulk = useBulk();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs text-ink-muted"
    >
      <span className="min-w-0 flex-1">In the Inbox: saved quickly, waiting for a title, facets or a collection.</span>
      <Button
        size="xs"
        variant="secondary"
        className="bg-surface-raised"
        onClick={() => bulk.mutate({ action: "reviewed", ids: [id] })}
      >
        Mark reviewed
      </Button>
    </div>
  );
}

/** Where a saved section sat on its page. The selector is only a hint: pages change. */
/** Saved from a hybrid-search result: which free catalog it was found in, and that catalog's licence. */
function ExternalOriginInfo({ origin }: { origin: Record<string, unknown> }) {
  const name = typeof origin.providerName === "string" ? origin.providerName : "an external catalog";
  const licence = typeof origin.licence === "string" ? ` (${origin.licence})` : "";
  const when = typeof origin.savedAt === "string" ? new Date(origin.savedAt).toLocaleDateString() : null;
  return (
    <Field label="Found via" htmlFor="found-via">
      <p id="found-via" className="text-xs text-ink-secondary">
        {name}
        {licence} search{when ? `, saved ${when}` : ""}
      </p>
    </Field>
  );
}

function SectionInfo({ section }: { section: Record<string, unknown> }) {
  const rect = section.rect as { width?: number; height?: number; y?: number } | undefined;
  const viewport = section.viewport as { width?: number } | undefined;
  const how = { select: "picked on the page", crop: "cropped", list: "picked from the section list" }[
    String(section.method) as "select" | "crop" | "list"
  ];
  return (
    <Field label="Section" htmlFor="section-info">
      <div id="section-info" className="space-y-0.5 text-xs text-ink-secondary">
        <p>
          {String(section.type ?? "Section")}
          {how ? ` · ${how}` : ""}
        </p>
        {rect && (
          <p className="font-mono text-ink-muted tabular-nums">
            {rect.width}×{rect.height} px, {rect.y} px down
            {viewport?.width ? ` · window ${viewport.width} px wide` : ""}
          </p>
        )}
        {section.truncated === true && <p className="text-ink-muted">Taller than PIVOT stitches; the bottom is cut.</p>}
        {typeof section.selector === "string" && (
          <p className="font-mono break-all text-ink-subtle" title="A hint for finding it again; pages change">
            {section.selector}
          </p>
        )}
        {typeof section.pageTitle === "string" && <p className="text-ink-muted">From “{section.pageTitle}”</p>}
      </div>
    </Field>
  );
}
