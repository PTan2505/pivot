import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Code,
  Compass,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Library,
  ListChecks,
  Loader2,
  MessageSquareText,
  Palette,
  Plug,
  Plus,
  ScrollText,
  Settings,
  Shapes,
  Sparkles,
  Wand,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  RESOURCE_TYPES,
  TAG_KIND_LABELS,
  TYPE_DEFS,
  type CollectionDTO,
  type ResourceType,
  type TagDTO,
  type TagKind,
} from "@pivot/core/types";
import { knownSourceFor } from "@pivot/core/source-match";
import { api, ApiError, getConfig, openInApp } from "../lib/api";
import { captureTab, getPageInfo, isHomePage, isPivotPage, isSavable, type PageInfo } from "../lib/page";
import { Button, cx, Field, Input, Logo, Textarea } from "../ui";

type Status = "loading" | "ready" | "offline" | "unauthorized" | "unsupported";
type Mode = "page" | "selection";
type Step = "type" | "details";
type TagValue = { kind: TagKind; name: string };

const PAGE_TYPES = RESOURCE_TYPES.filter((t) => t !== "skill");
const TEXT_TYPES: ResourceType[] = ["snippet", "prompt", "rule", "checklist"];
/** Offered first when saving a page; the rest sit behind "More types". */
const MAIN_TYPES: ResourceType[] = ["reference", "source", "library", "media", "animation", "typography"];
const OTHER_TYPES = PAGE_TYPES.filter((t) => !MAIN_TYPES.includes(t));
/**
 * Facets asked for when saving a page, so the form stays short; everything else can be added in PIVOT.
 * A reference skips Pattern: patterns describe components more than whole pages.
 */
const QUICK_FACETS: Partial<Record<ResourceType, Exclude<TagKind, "tag">[]>> = {
  reference: ["pageType", "domain", "visualStyle"],
};
const quickFacets = (t: ResourceType) => QUICK_FACETS[t] ?? TYPE_DEFS[t].facets;

const ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  library: Library,
  image: ImageIcon,
  shapes: Shapes,
  sparkles: Sparkles,
  palette: Palette,
  "message-square-text": MessageSquareText,
  wand: Wand,
  code: Code,
  "scroll-text": ScrollText,
  "list-checks": ListChecks,
  plug: Plug,
  compass: Compass,
};

function TypeOption({
  type,
  last,
  onChoose,
}: {
  type: ResourceType;
  /** The type picked last time: focused, so Enter continues with it. */
  last: boolean;
  onChoose: (t: ResourceType) => void;
}) {
  const def = TYPE_DEFS[type];
  const Icon = ICONS[def.icon] ?? Globe;
  return (
    <button
      type="button"
      autoFocus={last}
      onClick={() => onChoose(type)}
      className={cx(
        "flex cursor-pointer items-start gap-2.5 rounded-[12px] p-2 text-left transition-colors duration-150 hover:bg-surface focus-visible:bg-surface",
        last && "bg-surface",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface text-ink-secondary">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{def.label}</span>
        <span className="block text-xs leading-snug text-ink-muted">{def.blurb}</span>
      </span>
    </button>
  );
}

/**
 * One facet (or the plain tags) as a combobox: chosen values sit as chips in the field, typing filters the
 * values already used (most used first), ↑↓ and Enter pick one, and a new name can be created from the list.
 */
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
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // -1: nothing highlighted, so Enter in an empty field still saves the form.
  const [active, setActive] = useState(-1);
  const label = TAG_KIND_LABELS[kind];
  const chosen = value.filter((t) => t.kind === kind);
  const isChosen = (name: string) => chosen.some((t) => t.name.toLowerCase() === name.toLowerCase());
  const q = query.trim().toLowerCase();

  const matches = tags
    .filter((t) => t.kind === kind && !isChosen(t.name) && t.name.toLowerCase().includes(q))
    // Names that start with what you typed first, then the most used.
    .sort(
      (a, b) =>
        Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) ||
        (b.count ?? 0) - (a.count ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 8);
  const canCreate = !!q && !isChosen(q) && !tags.some((t) => t.kind === kind && t.name.toLowerCase() === q);
  const options = [
    ...matches.map((t) => ({ name: t.name, count: t.count, create: false })),
    ...(canCreate ? [{ name: query.trim(), count: undefined, create: true }] : []),
  ];
  const current = Math.min(active, options.length - 1);
  const highlighted = current >= 0 ? options[current] : undefined;

  const add = (name: string) => {
    if (!isChosen(name)) onChange([...value, { kind, name }]);
    setQuery("");
    setActive(-1);
  };
  const remove = (name: string) =>
    onChange(value.filter((t) => !(t.kind === kind && t.name.toLowerCase() === name.toLowerCase())));

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs text-ink-subtle">
        {label}
      </label>
      <div className="relative">
        <div
          onClick={() => inputRef.current?.focus()}
          // The ring goes on the rounded field, not the bare input inside it.
          className="flex min-h-9 cursor-text flex-wrap items-center gap-1 rounded-[18px] bg-surface px-1.5 py-1.5 focus-within:bg-surface-raised focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-accent-text hover:bg-surface-raised"
        >
          {chosen.map((t) => (
            <span
              key={t.name}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-inverse pr-1 pl-2.5 text-xs font-medium text-on-inverse"
            >
              {t.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t.name);
                }}
                className="grid size-4 cursor-pointer place-items-center rounded-full hover:bg-on-inverse/10"
                aria-label={`Remove ${t.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={open && highlighted ? `${id}-${current}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(e.target.value.trim() ? 0 : -1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
                if (!options.length) return;
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive(
                  current < 0
                    ? step > 0
                      ? 0
                      : options.length - 1
                    : (current + step + options.length) % options.length,
                );
              } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && open && highlighted) {
                // Pick the highlighted value instead of submitting the form.
                e.preventDefault();
                add(highlighted.name);
              } else if (e.key === "Escape" && open) {
                e.preventDefault();
                setOpen(false);
              } else if (e.key === "Backspace" && !query && chosen.length) {
                remove(chosen[chosen.length - 1].name);
              }
            }}
            placeholder={chosen.length ? "" : `Add ${label.toLowerCase()}…`}
            className="h-6 min-w-24 flex-1 bg-transparent px-1.5 text-[13px] text-ink !outline-none placeholder:text-ink-muted"
          />
        </div>
        {open && options.length > 0 && (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            // A highlight left by the mouse would turn the next Enter into a pick instead of Save.
            onMouseLeave={() => setActive(-1)}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-[14px] bg-surface-raised p-1 shadow-[0_12px_32px_rgb(0_0_0/0.55)]"
          >
            {options.map((o, i) => (
              <li
                key={`${o.create}-${o.name}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === current}
                // Keep focus in the input so the click lands before blur closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(o.name)}
                onMouseEnter={() => setActive(i)}
                className={cx(
                  "flex h-8 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[13px] text-ink",
                  i === current && "bg-surface",
                )}
              >
                {o.create ? (
                  <>
                    <Plus className="size-3.5 text-ink-muted" aria-hidden /> Create “{o.name}”
                  </>
                ) : (
                  <>
                    <span className="truncate">{o.name}</span>
                    {!!o.count && <span className="ml-auto font-mono text-[11px] text-ink-subtle">{o.count}</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
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
  const [duplicates, setDuplicates] = useState<{ id: string; title: string; type: ResourceType }[]>([]);
  const [ownPage, setOwnPage] = useState(false);

  const [mode, setMode] = useState<Mode>("page");
  const [step, setStep] = useState<Step>("type");
  const [moreTypes, setMoreTypes] = useState(false);
  const [type, setType] = useState<ResourceType>("reference");
  const [textType, setTextType] = useState<ResourceType>("snippet");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // The page's own description is sent only once edited, so a known source keeps its curated one.
  const [descriptionEdited, setDescriptionEdited] = useState(false);
  // A known site's home page: saved as a Source unless you pick something else.
  const [knownSource, setKnownSource] = useState<string | null>(null);
  const [tokenRejected, setTokenRejected] = useState(false);
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
      if (isPivotPage(active.url, (await getConfig()).serverUrl)) {
        setOwnPage(true);
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
      const { lastType } = await chrome.storage.local.get("lastType");
      const last = PAGE_TYPES.find((t) => t === lastType);
      const known = knownSourceFor(info.url);
      if (known && isHomePage(info.url)) {
        setType("source");
        setKnownSource(known.name);
      } else if (last) {
        setType(last);
        if (!MAIN_TYPES.includes(last)) setMoreTypes(true);
      }
      try {
        // the ping checks the token now, so a wrong one never costs what you typed
        const [t, c, d] = await Promise.all([api.tags(), api.collections(), api.lookup(info.url), api.ping()]);
        setTags(t);
        setCollections(c);
        setDuplicates(d.duplicates);
        setStatus("ready");
      } catch (err) {
        const status = err instanceof ApiError ? err.status : -1;
        setStatus(status === 0 ? "offline" : status === 403 ? "unauthorized" : "ready");
        if (status !== 0) setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  const save = async () => {
    if (!page || saving || (mode === "page" && step === "type")) return;
    setSaving(true);
    setError(null);
    setTokenRejected(false);
    try {
      // Only the kinds on screen: facets picked under a type you switched away from are dropped.
      const tags = chosen.filter((t) => facets.includes(t.kind));
      const common = { url: page.url, notes, tags, collectionId: collectionId || undefined };
      const res =
        mode === "page"
          ? await api.clip(
              {
                ...common,
                kind: "page",
                type,
                title,
                description: descriptionEdited || !(type === "source" && knownSource) ? description : undefined,
                serverCapture: willServerCapture,
              },
              { screenshot: attachShot && shot ? shot : undefined },
            )
          : await api.clip({ ...common, kind: "selection", type: textType, title, text });
      setSaved(res.path);
    } catch (err) {
      // keep the form: a token fixed in the settings tab can be retried with everything still filled in
      setError(err instanceof Error ? err.message : String(err));
      setTokenRejected(err instanceof ApiError && err.status === 403);
    } finally {
      setSaving(false);
    }
  };

  const facets: TagKind[] = mode === "page" ? [...quickFacets(type), "tag"] : ["technology", "tag"];
  // Sources only ever get a first-screen shot, and the attached view already is one.
  const attachingView = attachShot && !!shot;
  const offerServerCapture = TYPE_DEFS[type].visual && !(type === "source" && attachingView);
  const willServerCapture = offerServerCapture && serverCapture;

  const chooseType = (t: ResourceType) => {
    setType(t);
    setStep("details");
    void chrome.storage.local.set({ lastType: t });
  };

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
          {mode === "page" && willServerCapture
            ? type === "source"
              ? "PIVOT is taking a screenshot in the background."
              : "A full-page screenshot is being captured in the background."
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
      <p className="text-ink-muted">
        {ownPage
          ? "This is PIVOT itself. Open the page you want to save, then try again."
          : "This page can’t be saved. Open a regular http(s) page and try again."}
      </p>
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

        {mode === "page" && step === "type" ? (
          <div className="space-y-2">
            {duplicates.length > 0 && (
              <p className="flex items-center gap-1.5 pb-1 text-xs text-warning">
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
            <p className="text-[13px] font-medium text-ink">What are you saving?</p>
            {knownSource && (
              <p className="text-xs text-ink-muted">This is {knownSource}’s home page, so Source is picked.</p>
            )}
            <div className="grid grid-cols-2 gap-1">
              {(moreTypes ? [...MAIN_TYPES, ...OTHER_TYPES] : MAIN_TYPES).map((t) => (
                <TypeOption key={t} type={t} last={t === type} onChoose={chooseType} />
              ))}
            </div>
            {!moreTypes && (
              <button
                type="button"
                onClick={() => setMoreTypes(true)}
                className="flex h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-xs text-ink-muted hover:text-ink"
              >
                More types <ChevronDown className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
        ) : mode === "page" ? (
          <>
            <button
              type="button"
              onClick={() => setStep("type")}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-surface pr-3.5 pl-2.5 text-xs font-medium text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label={`Type: ${TYPE_DEFS[type].label}. Change type`}
            >
              <ArrowLeft className="size-3.5" aria-hidden /> {TYPE_DEFS[type].label}
            </button>
            {shotUrl && (
              <div className="relative overflow-hidden rounded-[14px] bg-surface">
                <img
                  src={shotUrl}
                  alt="Screenshot of the current tab"
                  // The tab as captured, at its own aspect ratio: no crop, no stretch; a tall window is fitted, not cut.
                  className={cx("mx-auto block h-auto max-h-64 w-auto max-w-full", !attachShot && "opacity-30")}
                />
                <label className="absolute right-2.5 bottom-2.5 flex cursor-pointer items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-ink">
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
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="space-y-3">
              {quickFacets(type).map((k) => (
                <FacetPicker key={k} kind={k} tags={tags} value={chosen} onChange={setChosen} />
              ))}
            </div>
            <details className="group space-y-3 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex h-8 cursor-pointer list-none items-center gap-1 text-xs text-ink-muted hover:text-ink">
                More details
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
                <span className="ml-1 text-ink-subtle">description, tags, notes, collection</span>
              </summary>
              <div className="space-y-4 pt-1">
                <Field label="Description" htmlFor="desc">
                  <Textarea
                    id="desc"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDescriptionEdited(true);
                    }}
                    rows={2}
                  />
                </Field>
                <FacetPicker kind="tag" tags={tags} value={chosen} onChange={setChosen} />
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
                {offerServerCapture && (
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={serverCapture}
                      onChange={(e) => setServerCapture(e.target.checked)}
                      className="mt-0.5 accent-[var(--accent-fill)]"
                    />
                    <span>
                      {type === "source" ? "Take a screenshot in PIVOT" : "Also capture a full-page screenshot"}
                      <span className="block text-ink-subtle">
                        Taken by PIVOT, so logged-in pages show their logged-out version.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </details>
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

        {mode === "selection" && (
          <>
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
          </>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-1.5 text-xs text-danger">
            <X className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              {error}
              {tokenRejected && (
                <button
                  type="button"
                  onClick={() => chrome.runtime.openOptionsPage()}
                  className="ml-1 cursor-pointer text-ink underline underline-offset-2"
                >
                  Open extension settings
                </button>
              )}
            </span>
          </div>
        )}
      </div>
      <footer className="flex items-center gap-2 px-4 py-3">
        <span className="truncate text-xs text-ink-subtle" title={page?.url}>
          {page ? new URL(page.url).hostname.replace(/^www\./, "") : tab?.url}
        </span>
        {mode === "page" && step === "type" ? (
          <span className="ml-auto text-xs text-ink-subtle">Pick a type to continue</span>
        ) : (
          <Button type="submit" className="ml-auto" disabled={saving || (mode === "selection" && !text.trim())}>
            {saving && <Loader2 className="animate-spin" />}
            {/* the warning above already says it's saved; saving again is a choice, not a slip */}
            {mode === "page" && duplicates.some((d) => d.type === type) ? "Save again" : "Save"}{" "}
            <span className="font-mono text-[10px] opacity-70">⌘↵</span>
          </Button>
        )}
      </footer>
    </form>
  );
}
