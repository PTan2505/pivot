import { AlertTriangle, Check, ExternalLink, Loader2, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  RESOURCE_TYPES,
  TAG_KIND_LABELS,
  TYPE_DEFS,
  type CollectionDTO,
  type ResourceType,
  type TagDTO,
  type TagKind,
} from "@pivot/core/types";
import { api, ApiError, openInApp } from "../lib/api";
import { captureTab, getPageInfo, isSavable, type PageInfo } from "../lib/page";
import { Button, cx, Field, Input, Logo, Textarea } from "../ui";

type Status = "loading" | "ready" | "offline" | "unauthorized" | "unsupported";
type Mode = "page" | "selection";
type TagValue = { kind: TagKind; name: string };

const PAGE_TYPES = RESOURCE_TYPES.filter((t) => t !== "skill");
const TEXT_TYPES: ResourceType[] = ["snippet", "prompt", "rule", "checklist"];

function FacetPicker({
  kind,
  tags,
  value,
  onChange,
}: {
  kind: TagKind;
  tags: TagDTO[];
  value: TagValue[];
  onChange: (v: TagValue[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const mine = value.filter((t) => t.kind === kind).map((t) => t.name.toLowerCase());
  const options = tags
    .filter((t) => t.kind === kind)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
  const shown = expanded ? options : options.slice(0, 8);
  const extra = value.filter(
    (t) => t.kind === kind && !options.some((o) => o.name.toLowerCase() === t.name.toLowerCase()),
  );

  const toggle = (name: string) =>
    onChange(
      mine.includes(name.toLowerCase())
        ? value.filter((t) => !(t.kind === kind && t.name.toLowerCase() === name.toLowerCase()))
        : [...value, { kind, name }],
    );

  return (
    <div className="space-y-1">
      <div className="text-xs text-ink-subtle">{TAG_KIND_LABELS[kind]}</div>
      <div className="flex flex-wrap gap-1">
        {[...shown.map((o) => o.name), ...extra.map((e) => e.name)].map((name) => {
          const on = mine.includes(name.toLowerCase());
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(name)}
              className={cx(
                "h-7 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors duration-150",
                on
                  ? "bg-inverse text-on-inverse"
                  : "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
              )}
            >
              {name}
            </button>
          );
        })}
        {options.length > 8 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="h-6 cursor-pointer px-1.5 text-xs text-ink-muted hover:text-foreground"
          >
            {expanded ? "less" : `+${options.length - 8}`}
          </button>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              if (!mine.includes(draft.trim().toLowerCase())) onChange([...value, { kind, name: draft.trim() }]);
              setDraft("");
            }
          }}
          placeholder="+ new"
          aria-label={`Add ${TAG_KIND_LABELS[kind]}`}
          className="h-7 w-24 rounded-full bg-surface px-3 text-xs text-ink transition-[width] placeholder:text-ink-muted focus:w-36 focus:bg-surface-raised"
        />
      </div>
    </div>
  );
}

export function Popup() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [shot, setShot] = useState<Blob | null>(null);
  const shotUrl = useMemo(() => (shot ? URL.createObjectURL(shot) : null), [shot]);
  const [tags, setTags] = useState<TagDTO[]>([]);
  const [collections, setCollections] = useState<CollectionDTO[]>([]);
  const [duplicates, setDuplicates] = useState<{ id: string; title: string }[]>([]);

  const [mode, setMode] = useState<Mode>("page");
  const [type, setType] = useState<ResourceType>("reference");
  const [textType, setTextType] = useState<ResourceType>("snippet");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<TagValue[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [attachShot, setAttachShot] = useState(true);
  const [serverCapture, setServerCapture] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(active ?? null);
      if (!active || !isSavable(active.url)) {
        setStatus("unsupported");
        return;
      }
      // Capture first, before the popup's own UI can change focus.
      const [info, image] = await Promise.all([getPageInfo(active), captureTab(active.windowId)]);
      setPage(info);
      setShot(image);
      setTitle(info.title);
      setDescription(info.description);
      setText(info.selection);
      if (info.selection) setMode("selection");
      try {
        const [t, c, d] = await Promise.all([api.tags(), api.collections(), api.lookup(info.url)]);
        setTags(t);
        setCollections(c);
        setDuplicates(d.duplicates);
        setStatus("ready");
      } catch (err) {
        setStatus(err instanceof ApiError && err.status === 0 ? "offline" : "ready");
        if (!(err instanceof ApiError && err.status === 0)) setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  const save = async () => {
    if (!page || saving) return;
    setSaving(true);
    setError(null);
    try {
      const common = { url: page.url, notes, tags: chosen, collectionId: collectionId || undefined };
      const res =
        mode === "page"
          ? await api.clip(
              {
                ...common,
                kind: "page",
                type,
                title,
                description,
                serverCapture: TYPE_DEFS[type].visual && serverCapture,
              },
              { screenshot: attachShot && shot ? shot : undefined },
            )
          : await api.clip({ ...common, kind: "selection", type: textType, title, text });
      setSaved(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError && err.status === 403) setStatus("unauthorized");
    } finally {
      setSaving(false);
    }
  };

  const facets: TagKind[] = mode === "page" ? [...TYPE_DEFS[type].facets, "tag"] : ["technology", "tag"];

  const header = (
    <header className="flex h-14 items-center gap-2.5 px-4">
      <Logo />
      <span className="text-[15px] font-medium tracking-[-0.01em]">Save to PIVOT</span>
      <button
        type="button"
        onClick={() => chrome.runtime.openOptionsPage()}
        className="ml-auto grid size-8 cursor-pointer place-items-center rounded-full bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink"
        aria-label="Extension settings"
      >
        <Settings className="size-3.5" />
      </button>
    </header>
  );

  if (status === "loading") {
    return (
      <div className="w-[400px]">
        {header}
        <div className="grid h-60 place-items-center text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-label="Loading" />
        </div>
      </div>
    );
  }

  if (status !== "ready" || saved) {
    const body = saved ? (
      <>
        <span className="grid size-10 place-items-center rounded-full bg-surface text-success">
          <Check className="size-4" />
        </span>
        <p className="font-medium">Saved</p>
        <p className="text-xs text-ink-muted">
          {mode === "page" && serverCapture && TYPE_DEFS[type].visual
            ? "A full-page screenshot is being captured in the background."
            : "It’s in your library."}
        </p>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={() => window.close()}>
            Close
          </Button>
          <Button onClick={() => openInApp(saved).then(() => window.close())}>
            <ExternalLink /> Open
          </Button>
        </div>
      </>
    ) : status === "unsupported" ? (
      <p className="text-ink-muted">This page can’t be saved. Open a regular http(s) page and try again.</p>
    ) : status === "offline" ? (
      <>
        <p className="font-medium">PIVOT isn’t running</p>
        <p className="text-xs text-ink-muted">
          Start it with <code className="font-mono">npm start</code> in the project folder, then reopen this popup.
        </p>
      </>
    ) : (
      <>
        <p className="font-medium">Connect the extension</p>
        <p className="text-xs text-ink-muted">{error ?? "Paste the API token from PIVOT › Settings."}</p>
        <Button onClick={() => chrome.runtime.openOptionsPage()}>Open extension settings</Button>
      </>
    );
    return (
      <div className="w-[400px]">
        {header}
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">{body}</div>
      </div>
    );
  }

  return (
    <form
      className="flex max-h-[590px] w-[400px] flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      }}
    >
      {header}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-2">
        {page?.selection && (
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1 text-xs">
            {(["page", "selection"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cx(
                  "h-8 cursor-pointer rounded-full font-medium transition-colors",
                  mode === m ? "bg-inverse text-on-inverse" : "text-ink-secondary hover:text-ink",
                )}
              >
                {m === "page" ? "Page" : "Selected text"}
              </button>
            ))}
          </div>
        )}

        {mode === "page" ? (
          <>
            {shotUrl && (
              <div className="relative overflow-hidden rounded-[14px] bg-surface">
                <img
                  src={shotUrl}
                  alt="Screenshot of the current tab"
                  className={cx("aspect-[16/10] w-full object-cover object-top", !attachShot && "opacity-30")}
                />
                <label className="absolute right-2.5 bottom-2.5 flex cursor-pointer items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur">
                  <input
                    type="checkbox"
                    checked={attachShot}
                    onChange={(e) => setAttachShot(e.target.checked)}
                    className="accent-[var(--accent-fill)]"
                  />
                  Attach this view
                </label>
              </div>
            )}
            {duplicates.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5 shrink-0" /> Already saved as
                <button
                  type="button"
                  onClick={() => openInApp(`/r/${duplicates[0].id}`)}
                  className="cursor-pointer truncate underline"
                >
                  {duplicates[0].title}
                </button>
              </p>
            )}
            <Field label="Title" htmlFor="title">
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>
            <Field label="Description" htmlFor="desc">
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </Field>
            <Field label="Type" htmlFor="type">
              <select
                id="type"
                value={type}
                onChange={(e) => setType(e.target.value as ResourceType)}
                className="h-9 w-full rounded-full border-0 bg-surface px-4 text-[13px] text-ink hover:bg-surface-raised"
              >
                {PAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_DEFS[t].label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Save as" htmlFor="text-type">
              <div className="grid grid-cols-4 gap-1" id="text-type">
                {TEXT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={textType === t}
                    onClick={() => setTextType(t)}
                    className={cx(
                      "h-8 cursor-pointer rounded-full text-xs font-medium transition-colors duration-150",
                      textType === t
                        ? "bg-inverse text-on-inverse"
                        : "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
                    )}
                  >
                    {TYPE_DEFS[t].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Title (optional)" htmlFor="sel-title">
              <Input
                id="sel-title"
                value={title === page?.title ? "" : title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="First line is used if empty"
              />
            </Field>
            <Field label="Text" htmlFor="sel-text">
              <Textarea
                id="sel-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={7}
                className="font-mono text-xs"
              />
            </Field>
          </>
        )}

        <div className="space-y-3 pt-1">
          {facets.map((k) => (
            <FacetPicker key={k} kind={k} tags={tags} value={chosen} onChange={setChosen} />
          ))}
        </div>

        <Field label="Notes" htmlFor="notes">
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="What’s worth stealing here?"
          />
        </Field>

        {collections.length > 0 && (
          <Field label="Collection" htmlFor="collection">
            <select
              id="collection"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className="h-9 w-full rounded-full border-0 bg-surface px-4 text-[13px] text-ink hover:bg-surface-raised"
            >
              <option value="">None</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {mode === "page" && TYPE_DEFS[type].visual && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={serverCapture}
              onChange={(e) => setServerCapture(e.target.checked)}
              className="mt-0.5 accent-[var(--accent-fill)]"
            />
            <span>
              Also capture a full-page screenshot
              <span className="block text-ink-subtle">
                Taken by PIVOT, so logged-in pages show their logged-out version.
              </span>
            </span>
          </label>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-xs text-danger">
            <X className="mt-px size-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>
      <footer className="flex items-center gap-2 px-4 py-3">
        <span className="truncate text-xs text-ink-subtle" title={page?.url}>
          {page ? new URL(page.url).hostname.replace(/^www\./, "") : tab?.url}
        </span>
        <Button type="submit" className="ml-auto" disabled={saving || (mode === "selection" && !text.trim())}>
          {saving && <Loader2 className="animate-spin" />}
          Save <span className="font-mono text-[10px] opacity-70">⌘↵</span>
        </Button>
      </footer>
    </form>
  );
}
