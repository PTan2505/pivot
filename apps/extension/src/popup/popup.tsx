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
  RefreshCw,
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
import { api, ApiError, getConfig, openInApp, type Duplicate } from "../lib/api";
import { pendingStore, storageWarning } from "../lib/pending-store";
import type { PendingItem } from "../lib/queue";
import { queueSave, SAVED_LOCALLY_TEXT, syncNow, type QueuedSave } from "../lib/sync";
import { captureTab, getPageInfo, isHomePage, isPivotPage, isSavable, type PageInfo } from "../lib/page";
import { AssetPicker, CollectionPicker, Duplicates, LibraryTab, QuickEdit } from "./parts";
import { discoverAssets, type Discovered } from "../lib/discover";
import { endCaptureSession, getCaptureSession, startCaptureSession, type CaptureSession } from "../lib/capture-session";
import { RedactEditor } from "./redact-editor";
import { assessPrivacy, type PrivacyVerdict } from "../lib/privacy";
import { masksFrom, redact, type Mask } from "../lib/redact";
import { listSections, type PickedSection } from "../lib/section";
import { approvePending } from "../lib/sync";
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
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [duplicateTotal, setDuplicateTotal] = useState(0);
  const [view, setView] = useState<"capture" | "library">("capture");
  const [editing, setEditing] = useState(false);
  // Private pages: the verdict, the masks you keep, and your explicit go-ahead for the screenshot.
  const [privacy, setPrivacy] = useState<PrivacyVerdict | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [approved, setApproved] = useState(false);
  const [sections, setSections] = useState<PickedSection[] | null>(null);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [reviewing, setReviewing] = useState<PendingItem | null>(null);
  const [found, setFound] = useState<Discovered | null>(null);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [editNote, setEditNote] = useState("");
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
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [attachShot, setAttachShot] = useState(true);
  const [serverCapture, setServerCapture] = useState(true);
  const [expandContent, setExpandContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // Saved on this computer but not (yet) confirmed by PIVOT.
  const [savedLocally, setSavedLocally] = useState<Exclude<QueuedSave, { synced: true }>["reason"] | null>(null);
  const [offline, setOffline] = useState(false);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  const reloadPending = async () => setPending(await pendingStore.list().catch(() => []));

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
      void reloadPending();
      void storageWarning().then(setStorageNote);
      void getCaptureSession().then((s) => {
        setSession(s);
        // the session's collections start picked; untick them to leave this one save out
        if (s) setCollectionIds(s.collectionIds);
      });
      void assessPrivacy(info.url, info.privacy).then((v) => {
        setPrivacy(v);
        if (v.flagged) setMasks(masksFrom(info.privacy?.suggestions));
      });
      try {
        // the ping checks the token now, so a wrong one never costs what you typed
        const [t, c, d, , caps] = await Promise.all([
          api.tags(),
          api.collections(),
          api.lookup(info.url),
          api.ping(),
          api.capabilities().catch(() => ({ features: [] as string[] })),
        ]);
        setTags(t);
        setCollections(c);
        setDuplicates(d.duplicates);
        setDuplicateTotal(d.total ?? d.duplicates.length);
        setNeedsUpdate(!caps.features.includes("clip.client-request-id"));
        void chrome.storage.local.set({ "cache:tags": t, "cache:collections": c });
        setStatus("ready");
        // waiting saves go out now that PIVOT answers
        void syncNow().then(reloadPending);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : -1;
        if (status === 0) {
          // Saving still works: it goes to the queue and is sent when PIVOT is back.
          const cached = await chrome.storage.local.get(["cache:tags", "cache:collections"]);
          setTags((cached["cache:tags"] as TagDTO[] | undefined) ?? []);
          setCollections((cached["cache:collections"] as CollectionDTO[] | undefined) ?? []);
          setOffline(true);
          setStatus("ready");
          return;
        }
        setStatus(status === 403 ? "unauthorized" : "ready");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  const save = async () => {
    if (!page || saving || (mode === "page" && step === "type")) return;
    if (needsApproval && !approved) return;
    setSaving(true);
    setError(null);
    setTokenRejected(false);
    try {
      // Only the kinds on screen: facets picked under a type you switched away from are dropped.
      const tags = chosen.filter((t) => facets.includes(t.kind));
      const common = {
        url: page.url,
        notes,
        tags,
        collectionIds: collectionIds.length ? collectionIds : undefined,
        capturedUrl: page.address && page.address !== page.url ? page.address : undefined,
      };
      const res = await queueSave(
        mode === "page"
          ? {
              label: "Page",
              title: title || page.url,
              data: {
                ...common,
                kind: "page",
                type,
                title,
                description: descriptionEdited || !(type === "source" && knownSource) ? description : undefined,
                // the server, without your login, can't see a private page
                serverCapture: willServerCapture && !privacy?.flagged,
                privatePage: privacy?.flagged || undefined,
                expandContent: willServerCapture && type !== "source" ? expandContent : undefined,
              },
              // a private page's view goes up only with the masks painted into its pixels
              screenshot:
                attachShot && shot
                  ? privacy?.flagged
                    ? await redact(shot, masks, page.privacy?.viewport.width ?? 0)
                    : shot
                  : undefined,
            }
          : {
              label: "Text",
              title: title || text.split("\n")[0].slice(0, 60),
              data: { ...common, kind: "selection", type: textType, title, text },
            },
      );
      void chrome.runtime.sendMessage({ type: "pivot:queue-changed" }).catch(() => {});
      // Not confirmed yet: it is in the queue, so the form closes rather than inviting a second copy.
      if (res.synced) setSaved(res.path);
      else setSavedLocally(res.reason);
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
  // A screenshot of a page that looks private is uploaded only after you have looked at it.
  const needsApproval = mode === "page" && !!privacy?.flagged && attachShot && !!shot;

  const pickSection = async (how: "select" | "crop" | "list") => {
    if (!tab?.id) return;
    if (how !== "list") {
      await chrome.runtime.sendMessage({ type: "pivot:section-start", tabId: tab.id, mode: how });
      window.close();
      return;
    }
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: listSections });
    setSections((res?.result as PickedSection[] | undefined) ?? []);
  };

  const pickAssets = async () => {
    if (!tab?.id) return;
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: discoverAssets });
    setFound((res?.result as Discovered | undefined) ?? { images: [], svgs: [], fonts: [], gradients: [] });
  };

  /** The tab as it is now, added to a saved reference as one of its states (held for approval on a private page). */
  const addState = async (target: Duplicate, state: string) => {
    if (!page || !shot) return;
    const res = await queueSave({
      label: "State",
      title: `${state} — ${target.title}`,
      data: {
        kind: "page",
        url: page.url,
        attachTo: target.id,
        state,
        capturedUrl: page.address && page.address !== page.url ? page.address : undefined,
      },
      screenshot: shot,
      privacy: privacy?.flagged
        ? {
            reasons: privacy.reasons,
            suggestions: page.privacy?.suggestions ?? [],
            viewportWidth: page.privacy?.viewport.width ?? 0,
          }
        : undefined,
    });
    void chrome.runtime.sendMessage({ type: "pivot:queue-changed" }).catch(() => {});
    if (res.synced) setSaved(res.path);
    else setSavedLocally(res.reason);
  };

  const saveListedSection = async (section: PickedSection) => {
    if (!tab?.id) return;
    setSectionBusy(true);
    setError(null);
    const res = (await chrome.runtime.sendMessage({ type: "pivot:section-capture", tabId: tab.id, section })) as
      { ok: true; result: QueuedSave } | { ok: false; error: string };
    setSectionBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.result.synced) setSaved(res.result.path);
    else setSavedLocally(res.result.reason);
  };

  const chooseType = (t: ResourceType) => {
    setType(t);
    setStep("details");
    void chrome.storage.local.set({ lastType: t });
  };

  const viewTabs = (
    <div
      role="tablist"
      aria-label="Popup view"
      className="ml-auto flex gap-0.5 rounded-full bg-surface p-0.5 text-xs"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = view === "capture" ? "library" : "capture";
        setView(next);
        document.getElementById(`view-${next}`)?.focus();
      }}
    >
      {(["capture", "library"] as const).map((v) => (
        <button
          key={v}
          id={`view-${v}`}
          type="button"
          role="tab"
          aria-selected={view === v}
          tabIndex={view === v ? 0 : -1}
          onClick={() => setView(v)}
          className={cx(
            "h-7 cursor-pointer rounded-full px-3 font-medium transition-colors",
            view === v ? "bg-inverse text-on-inverse" : "text-ink-secondary hover:text-ink",
          )}
        >
          {v === "capture" ? "Capture" : "Library"}
        </button>
      ))}
    </div>
  );

  const header = (
    <header className="flex h-14 items-center gap-2.5 px-4">
      <Logo />
      <span className="text-[15px] font-medium tracking-[-0.01em]">Save to PIVOT</span>
      {status === "ready" && !saved && !savedLocally && viewTabs}
      <button
        type="button"
        onClick={() => chrome.runtime.openOptionsPage()}
        className={cx(
          "grid size-8 cursor-pointer place-items-center rounded-full bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
          !(status === "ready" && !saved && !savedLocally) && "ml-auto",
        )}
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

  if (reviewing) {
    return (
      <div className="flex max-h-[590px] w-[400px] flex-col">
        {header}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <ApprovalView
            item={reviewing}
            onDone={async () => {
              setReviewing(null);
              await reloadPending();
              void chrome.runtime.sendMessage({ type: "pivot:queue-changed" }).catch(() => {});
            }}
          />
        </div>
      </div>
    );
  }

  if (status !== "ready" || saved || savedLocally) {
    const body = savedLocally ? (
      <>
        <span className="grid size-10 place-items-center rounded-full bg-surface text-warning">
          <Check className="size-4" />
        </span>
        <p className="font-medium">Saved locally</p>
        <p className="text-xs text-ink-muted">{SAVED_LOCALLY_TEXT[savedLocally]}</p>
        <div className="flex gap-2 pt-1">
          {savedLocally === "auth" && (
            <Button variant="outline" onClick={() => chrome.runtime.openOptionsPage()}>
              Extension settings
            </Button>
          )}
          <Button onClick={() => window.close()}>Close</Button>
        </div>
      </>
    ) : saved && editing ? (
      <QuickEdit
        id={saved.replace(/^\/r\//, "")}
        title={title || page?.title || ""}
        notes={notes}
        collections={collections}
        initialCollections={collectionIds}
        facets={
          mode === "page"
            ? {
                node: facets.map((k) => (
                  <FacetPicker key={k} kind={k} tags={tags} value={chosen} onChange={setChosen} />
                )),
                value: () => chosen.filter((t) => facets.includes(t.kind)),
              }
            : null
        }
        onDone={(message) => {
          setEditing(false);
          setEditNote(message);
        }}
      />
    ) : saved ? (
      <>
        <span className="grid size-10 place-items-center rounded-full bg-surface text-success">
          <Check className="size-4" />
        </span>
        <p className="font-medium">Saved</p>
        {editNote && <p className="text-xs text-success">{editNote}</p>}
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
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button autoFocus onClick={() => openInApp(saved).then(() => window.close())}>
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
        {pending.length > 0 && (
          <p className="text-xs text-ink-muted">
            {pending.length} save{pending.length > 1 ? "s are" : " is"} waiting on this computer and will be sent once
            the token works.
          </p>
        )}
        <Button onClick={() => chrome.runtime.openOptionsPage()}>Open extension settings</Button>
      </>
    );
    return (
      <div className="w-[400px]">
        {header}
        <div role={editing ? undefined : "status"} className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          {body}
        </div>
      </div>
    );
  }

  if (view === "library") {
    return (
      <div className="flex max-h-[590px] w-[400px] flex-col">
        {header}
        <div role="tabpanel" aria-labelledby="view-library" className="flex-1 overflow-y-auto px-4 pb-4">
          <LibraryTab
            pageUrl={page?.url ?? null}
            host={page ? new URL(page.url).hostname.replace(/^www\./, "") : null}
            pending={pending}
            offline={offline}
          />
        </div>
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
        {session && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-[12px] bg-surface px-3 py-2 text-xs text-ink-muted"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">Capture session:</span> saves go into {session.names.join(", ")}.
            </span>
            <button
              type="button"
              className="cursor-pointer text-ink-secondary underline"
              onClick={async () => {
                await endCaptureSession();
                setSession(null);
              }}
            >
              End
            </button>
          </p>
        )}
        {offline && (
          <p role="status" className="rounded-[12px] bg-surface px-3 py-2 text-xs text-ink-muted">
            <span className="font-medium text-ink">PIVOT isn’t running.</span> You can still save: it stays on this
            computer and is sent when PIVOT is back (<code className="font-mono">npm start</code>).
          </p>
        )}
        {needsUpdate && !offline && (
          <p role="status" className="rounded-[12px] bg-surface px-3 py-2 text-xs text-warning">
            This PIVOT is older than the extension. Saves are kept on this computer until PIVOT is updated.
          </p>
        )}
        {storageNote && (
          <p role="alert" className="rounded-[12px] bg-surface px-3 py-2 text-xs text-warning">
            {storageNote}
          </p>
        )}
        {pending.length > 0 && (
          <PendingPanel items={pending} offline={offline} onChange={reloadPending} onReview={setReviewing} />
        )}
        {page?.selection && (
          <div
            role="tablist"
            aria-label="What to save"
            className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1 text-xs"
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const next = mode === "page" ? "selection" : "page";
              setMode(next);
              document.getElementById(`mode-${next}`)?.focus();
            }}
          >
            {(["page", "selection"] as const).map((m) => (
              <button
                key={m}
                id={`mode-${m}`}
                type="button"
                role="tab"
                aria-selected={mode === m}
                tabIndex={mode === m ? 0 : -1}
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
            {page && (
              <Duplicates
                items={duplicates}
                total={duplicateTotal}
                url={page.url}
                onAddState={shot ? addState : undefined}
              />
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
            <div className="space-y-1.5 pt-2">
              <p className="text-xs text-ink-muted">Or save one part of the page as its own reference:</p>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => pickSection("select")}>
                  Select a section
                </Button>
                <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => pickSection("crop")}>
                  Crop
                </Button>
                <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => pickSection("list")}>
                  Pick from a list
                </Button>
                <Button variant="outline" className="h-8 px-3 text-xs" onClick={pickAssets}>
                  Pick assets
                </Button>
              </div>
              {found && !offline && <AssetPicker found={found} target={duplicates[0] ?? null} />}
              {sections && (
                <ul aria-label="Sections on this page" className="space-y-1">
                  {sections.length === 0 && <li className="text-xs text-ink-muted">No clear sections found.</li>}
                  {sections.map((sec, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={sectionBusy}
                        onClick={() => saveListedSection(sec)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] bg-surface px-3 py-2 text-left text-xs hover:bg-surface-raised disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate text-ink">{sec.type}</span>
                        <span className="shrink-0 font-mono text-ink-subtle tabular-nums">
                          {sec.rect.width}×{sec.rect.height}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {sectionBusy && (
                <p role="status" className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Loader2 className="size-3 animate-spin" /> Capturing the section…
                </p>
              )}
            </div>
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
            {privacy?.flagged && shot && (
              <div role="alert" className="space-y-2 rounded-[14px] bg-surface p-3 text-xs">
                <p className="font-medium text-warning">This page looks private</p>
                <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
                  {privacy.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="text-ink-muted">
                  Check the screenshot before it leaves this computer. Black boxes are painted into the picture; nothing
                  under them is uploaded. Detection can miss things.
                </p>
                {attachShot && (
                  <RedactEditor
                    image={shot}
                    width={page?.privacy?.viewport.width ?? 0}
                    masks={masks}
                    onChange={setMasks}
                  />
                )}
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={attachShot}
                    onChange={(e) => setAttachShot(e.target.checked)}
                    className="accent-[var(--accent-fill)]"
                  />
                  Attach this view
                </label>
                {attachShot && (
                  <label className="flex cursor-pointer items-center gap-2 text-ink">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                      className="accent-[var(--accent-fill)]"
                    />
                    I checked it: upload this screenshot with these masks
                  </label>
                )}
              </div>
            )}
            {shotUrl && !privacy?.flagged && (
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
                <CollectionPicker collections={collections} value={collectionIds} onChange={setCollectionIds} />
                {collectionIds.length > 0 && !session && (
                  <button
                    type="button"
                    className="cursor-pointer text-left text-[11px] text-ink-secondary underline"
                    onClick={async () => {
                      const names = collections.filter((c) => collectionIds.includes(c.id)).map((c) => c.name);
                      await startCaptureSession(collectionIds, names);
                      setSession({ collectionIds, names, startedAt: Date.now() });
                    }}
                  >
                    Keep saving into {collectionIds.length > 1 ? "these collections" : "this collection"} until I end it
                    (capture session)
                  </button>
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
                {offerServerCapture && serverCapture && type !== "source" && (
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={expandContent}
                      onChange={(e) => setExpandContent(e.target.checked)}
                      className="mt-0.5 accent-[var(--accent-fill)]"
                    />
                    <span>
                      Expand content
                      <span className="block text-ink-subtle">
                        Click “Load more” buttons before the full-page shot.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </details>
          </>
        ) : (
          <>
            <Field label="Save as">
              <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Save as">
                {TEXT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={textType === t}
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

            <CollectionPicker collections={collections} value={collectionIds} onChange={setCollectionIds} />
            {collectionIds.length > 0 && !session && (
              <button
                type="button"
                className="cursor-pointer text-left text-[11px] text-ink-secondary underline"
                onClick={async () => {
                  const names = collections.filter((c) => collectionIds.includes(c.id)).map((c) => c.name);
                  await startCaptureSession(collectionIds, names);
                  setSession({ collectionIds, names, startedAt: Date.now() });
                }}
              >
                Keep saving into {collectionIds.length > 1 ? "these collections" : "this collection"} until I end it
                (capture session)
              </button>
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
          <Button
            type="submit"
            className="ml-auto"
            disabled={saving || (mode === "selection" && !text.trim()) || (needsApproval && !approved)}
          >
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

/** Saves still on this computer: why each one is waiting, and what you can do about it. */
function PendingPanel({
  items,
  offline,
  onChange,
  onReview,
}: {
  items: PendingItem[];
  offline: boolean;
  onChange: () => Promise<void>;
  /** Opens the approval view for a save held because the page looks private. */
  onReview: (item: PendingItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sync = async (only?: string[]) => {
    setBusy(true);
    try {
      await syncNow({ force: true, only });
    } finally {
      await onChange();
      setBusy(false);
    }
  };
  const discard = async (id: string) => {
    await pendingStore.remove(id);
    setConfirming(null);
    void chrome.runtime.sendMessage({ type: "pivot:queue-changed" }).catch(() => {});
    await onChange();
  };
  return (
    // open when something needs you (an approval or a refused save), collapsed when it is only waiting
    <details open={items.some((i) => i.status !== "pending")} className="rounded-[12px] bg-surface px-3 py-2 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 text-ink-secondary">
        <span className="flex-1">
          {items.length} save{items.length > 1 ? "s" : ""} waiting to sync
        </span>
        {!offline && (
          <Button
            type="button"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void sync();
            }}
          >
            <RefreshCw className={cx("size-3", busy && "animate-spin")} /> Sync now
          </Button>
        )}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.id} className="rounded-[10px] bg-surface-raised px-2.5 py-2">
            <p className="truncate font-medium text-ink">
              {item.label}: {item.title}
            </p>
            <p className="text-ink-muted">
              {item.status === "needs_attention"
                ? "PIVOT refused it: "
                : item.status === "needs_approval"
                  ? "Waiting for your approval: the page looks private. "
                  : "Saved locally. "}
              {item.lastError ?? (offline ? "Waiting for PIVOT." : "Waiting to be sent.")}
            </p>
            {item.status === "needs_approval" && (
              <div className="mt-1.5 flex gap-1.5">
                <Button type="button" className="h-7 px-2.5 text-xs" onClick={() => onReview(item)}>
                  Review
                </Button>
              </div>
            )}
            {item.status === "needs_attention" && (
              <div className="mt-1.5 flex gap-1.5">
                <Button type="button" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => sync([item.id])}>
                  Retry
                </Button>
                {confirming === item.id ? (
                  <Button type="button" className="h-7 px-2.5 text-xs" onClick={() => discard(item.id)}>
                    Discard for good
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setConfirming(item.id)}
                  >
                    Discard
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * A save held because its page looks private: look at the screenshot, mask what shouldn't leave this computer, then
 * upload it, upload the save without the picture, or discard it.
 */
function ApprovalView({ item, onDone }: { item: PendingItem; onDone: () => Promise<void> }) {
  const [masks, setMasks] = useState<Mask[]>(() => masksFrom(item.privacy?.suggestions));
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const act = async (attachScreenshot: boolean) => {
    setBusy(true);
    try {
      await approvePending(item.id, { masks, attachScreenshot });
    } finally {
      setBusy(false);
      await onDone();
    }
  };
  return (
    <div className="space-y-3 text-xs">
      <p className="text-[13px] font-medium text-ink">
        {item.label}: {item.title}
      </p>
      <ul className="list-disc space-y-0.5 pl-4 text-ink-muted">
        {item.privacy?.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {item.screenshot ? (
        <RedactEditor
          image={item.screenshot}
          width={item.privacy?.viewportWidth ?? 0}
          masks={masks}
          onChange={setMasks}
        />
      ) : (
        <p className="text-ink-muted">No screenshot with this save.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {item.screenshot && (
          <Button disabled={busy} onClick={() => act(true)}>
            Upload with these masks
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => act(false)}>
          {item.screenshot ? "Upload without the screenshot" : "Upload"}
        </Button>
        {confirmDiscard ? (
          <Button
            variant="outline"
            className="text-danger"
            onClick={async () => {
              await pendingStore.remove(item.id);
              await onDone();
            }}
          >
            Discard for good
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setConfirmDiscard(true)}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}
