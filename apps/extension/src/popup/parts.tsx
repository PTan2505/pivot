import { ExternalLink, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CollectionDTO, ResourceDTO, TagKind } from "@pivot/core/types";
import { TYPE_DEFS } from "@pivot/core/types";
import { api, openInApp, serverUrlFor, type Duplicate } from "../lib/api";
import type { Discovered } from "../lib/discover";
import { externalSearchLinks } from "@pivot/core/known-sources";
import type { PendingItem } from "../lib/queue";
import { Button, cx, Field, Input, Textarea } from "../ui";

/** Resolves a server path (thumbnail, cover) to a full URL once the server address is known. */
function useServerUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (path) void serverUrlFor(path).then(setUrl);
  }, [path]);
  return path ? url : null;
}

function Thumb({ path, className }: { path: string | null | undefined; className?: string }) {
  const url = useServerUrl(path);
  return (
    <span className={cx("block shrink-0 overflow-hidden rounded-[8px] bg-surface-raised", className)}>
      {url && <img src={url} alt="" className="size-full object-cover object-top" />}
    </span>
  );
}

/**
 * Earlier saves of this page: up to three with thumbnails, "View all" when there are more. Opening one is the
 * alternative to saving again; nothing is merged.
 */
export function Duplicates({
  items,
  total,
  url,
  onAddState,
}: {
  items: Duplicate[];
  total: number;
  url: string;
  /** Offered for the newest save: add the current view to it as a state instead of saving again. */
  onAddState?: (target: Duplicate, state: string) => Promise<void>;
}) {
  if (!items.length) return null;
  return (
    <section aria-label="Already saved" className="space-y-1.5 rounded-[12px] bg-surface p-2.5">
      <p className="text-xs text-warning">
        Already saved {total > 1 ? `${total} times` : "once"}. Open it, or carry on to save a new one.
      </p>
      <ul className="space-y-1">
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => openInApp(`/r/${d.id}`)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] p-1 text-left hover:bg-surface-raised"
            >
              <Thumb path={d.thumbnail} className="h-9 w-14" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{d.title}</span>
                <span className="block text-[11px] text-ink-muted">
                  {TYPE_DEFS[d.type]?.label ?? d.type}
                  {d.createdAt ? ` · ${new Date(d.createdAt).toLocaleDateString()}` : ""}
                </span>
              </span>
              <span className="text-[11px] text-ink-secondary">Open existing</span>
            </button>
          </li>
        ))}
      </ul>
      {onAddState && <AddState target={items[0]} onSave={(state) => onAddState(items[0], state)} />}
      {total > items.length && (
        <button
          type="button"
          onClick={() => openInApp(`/?url=${encodeURIComponent(url)}`)}
          className="cursor-pointer text-xs text-ink-secondary underline"
        >
          View all {total}
        </button>
      )}
    </section>
  );
}

/**
 * Several collections, or none. The 2–3 used most recently come first as chips; the rest are one tap away. Nothing
 * is picked for you.
 */
export function CollectionPicker({
  collections,
  value,
  onChange,
}: {
  collections: CollectionDTO[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => [...collections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [collections]);
  if (!collections.length) return null;
  const shown = all ? sorted : sorted.slice(0, 3);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs text-ink-subtle">Collections {all ? "" : "(recent)"}</legend>
      <div className="flex flex-wrap gap-1">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={value.includes(c.id)}
            onClick={() => toggle(c.id)}
            className={cx(
              "h-7 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors duration-150",
              value.includes(c.id)
                ? "bg-inverse text-on-inverse"
                : "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
            )}
          >
            {c.name}
          </button>
        ))}
        {!all && sorted.length > 3 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="h-7 cursor-pointer rounded-full px-2 text-xs text-ink-muted hover:text-ink"
          >
            All {sorted.length}
          </button>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Right after a save: fix the title or notes, change facets, file it in collections. Optional; Close keeps it as
 * saved, and anything deeper is done in PIVOT.
 */
export function QuickEdit({
  id,
  title: initialTitle,
  notes: initialNotes,
  collections,
  initialCollections,
  facets,
  onDone,
}: {
  id: string;
  title: string;
  notes: string;
  collections: CollectionDTO[];
  initialCollections: string[];
  /** The facet pickers, already bound to the form's state, and how to read their value. */
  facets: { node: React.ReactNode; value: () => { kind: TagKind; name: string }[] } | null;
  onDone: (message: string) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState(initialNotes);
  const [picked, setPicked] = useState(initialCollections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.update(id, { title, notes, ...(facets ? { tags: facets.value() } : {}) });
      for (const c of picked.filter((c) => !initialCollections.includes(c))) await api.addToCollection(c, [id]);
      for (const c of initialCollections.filter((c) => !picked.includes(c))) await api.removeFromCollection(c, [id]);
      onDone("Changes saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full space-y-3 text-left">
      <Field label="Title" htmlFor="qe-title">
        <Input id="qe-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Notes" htmlFor="qe-notes">
        <Textarea id="qe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      {facets?.node}
      <CollectionPicker collections={collections} value={picked} onChange={setPicked} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onDone("")}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Save changes
        </Button>
      </div>
    </div>
  );
}

function ResultList({ items, empty }: { items: ResourceDTO[] | null; empty: string }) {
  if (!items) return <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Loading" />;
  if (!items.length) return <p className="text-xs text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => openInApp(`/r/${r.id}`)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] p-1 text-left hover:bg-surface"
          >
            <Thumb path={r.coverAssetId ? `/api/assets/${r.coverAssetId}?thumb=1` : null} className="h-9 w-14" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ink">{r.title}</span>
              <span className="block text-[11px] text-ink-muted">
                {TYPE_DEFS[r.type]?.label ?? r.type}
                {r.reviewStatus === "needs_review" ? " · in the Inbox" : ""}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The popup's Library view: a quick search, what was saved recently, from this page and from this website. Saves
 * still waiting on this computer are listed separately. Managing items happens in PIVOT.
 */
export function LibraryTab({
  pageUrl,
  host,
  pending,
  offline,
}: {
  pageUrl: string | null;
  host: string | null;
  pending: PendingItem[];
  offline: boolean;
}) {
  const [q, setQ] = useState("");
  const [where, setWhere] = useState<"library" | "external">("library");
  const [savedHosts, setSavedHosts] = useState<string[]>([]);
  const [results, setResults] = useState<ResourceDTO[] | null>(null);
  const [recent, setRecent] = useState<ResourceDTO[] | null>(null);
  const [thisPage, setThisPage] = useState<ResourceDTO[] | null>(null);
  const [thisSite, setThisSite] = useState<ResourceDTO[] | null>(null);

  useEffect(() => {
    if (offline) return;
    void api.list({ sort: "created", limit: 5 }).then(setRecent, () => setRecent([]));
    if (pageUrl) void api.list({ url: pageUrl, limit: 5 }).then(setThisPage, () => setThisPage([]));
    if (host) void api.list({ host, sort: "created", limit: 5 }).then(setThisSite, () => setThisSite([]));
  }, [offline, pageUrl, host]);

  useEffect(() => {
    if (offline) return;
    void api.list({ type: "source", limit: 100 }).then(
      (rows) => setSavedHosts(rows.map((r) => (r.sourceUrl ? new URL(r.sourceUrl).hostname : "")).filter(Boolean)),
      () => {},
    );
  }, [offline]);

  useEffect(() => {
    if (offline || !q.trim()) return;
    const t = setTimeout(() => void api.list({ q: q.trim(), limit: 8 }).then(setResults, () => setResults([])), 200);
    return () => clearTimeout(t);
  }, [q, offline]);

  const pageIds = new Set(thisPage?.map((r) => r.id));
  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search className="absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input
          aria-label="Search your library"
          placeholder={offline ? "Search needs PIVOT running" : "Search your library"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (!e.target.value.trim()) setResults(null);
          }}
          disabled={offline}
          className="pl-9"
        />
      </label>
      {q.trim() && (
        <div role="radiogroup" aria-label="Search in" className="flex gap-1 text-xs">
          {(["library", "external"] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={where === w}
              onClick={() => setWhere(w)}
              className={cx(
                "h-7 cursor-pointer rounded-full px-3 font-medium",
                where === w ? "bg-inverse text-on-inverse" : "bg-surface text-ink-secondary hover:text-ink",
              )}
            >
              {w === "library" ? "Library" : "Elsewhere"}
            </button>
          ))}
        </div>
      )}
      {q.trim() && where === "external" ? (
        <section aria-label="Search elsewhere" className="space-y-1.5">
          <ul className="space-y-1">
            {externalSearchLinks(q, { savedHosts, limit: 8 }).map((l) => (
              <li key={l.host}>
                <button
                  type="button"
                  onClick={() => chrome.tabs.create({ url: l.url })}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-xs hover:bg-surface"
                >
                  <ExternalLink className="size-3 shrink-0 text-ink-muted" aria-hidden />
                  <span className="flex-1 text-ink">{l.name}</span>
                  {l.saved && <span className="text-[11px] text-ink-subtle">saved source</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-subtle">Opens their search. Nothing is saved until you save a page.</p>
        </section>
      ) : q.trim() ? (
        <section aria-label="Search results" className="space-y-1.5">
          <ResultList items={results} empty="Nothing matches." />
        </section>
      ) : (
        <>
          {pending.length > 0 && (
            <section aria-label="Waiting to sync" className="space-y-1.5">
              <h2 className="text-xs text-ink-subtle">Waiting to sync ({pending.length})</h2>
              <ul className="space-y-1">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="truncate rounded-[10px] bg-surface px-2.5 py-1.5 text-xs text-ink-secondary"
                  >
                    {p.label}: {p.title} <span className="text-ink-muted">· saved locally</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {offline ? (
            <p className="text-xs text-ink-muted">Start PIVOT to see your library here.</p>
          ) : (
            <>
              {pageUrl && (
                <section aria-label="Saved from this page" className="space-y-1.5">
                  <h2 className="text-xs text-ink-subtle">Saved from this page</h2>
                  <ResultList items={thisPage} empty="Nothing saved from this page yet." />
                </section>
              )}
              {host && (
                <section aria-label="Saved from this website" className="space-y-1.5">
                  <h2 className="text-xs text-ink-subtle">Saved from {host}</h2>
                  <ResultList
                    items={thisSite?.filter((r) => !pageIds.has(r.id)) ?? null}
                    empty="Nothing else from this website."
                  />
                </section>
              )}
              <section aria-label="Recently saved" className="space-y-1.5">
                <h2 className="text-xs text-ink-subtle">Recently saved</h2>
                <ResultList items={recent} empty="Nothing saved yet." />
              </section>
            </>
          )}
          <button
            type="button"
            onClick={() => openInApp("/")}
            className="flex cursor-pointer items-center gap-1 text-xs text-ink-secondary hover:text-ink"
          >
            <ExternalLink className="size-3" aria-hidden /> Open PIVOT
          </button>
        </>
      )}
    </div>
  );
}

const STATES = [
  "Default",
  "Hover",
  "Focus",
  "Open menu",
  "Expanded",
  "Selected",
  "Error",
  "Empty",
  "Loading",
  "Success",
];

/**
 * Adds what the tab shows now (a hover, an open menu, an error…) to a page already saved, as one of its states, instead
 * of saving the page again. Nothing on the page is clicked for you: put it in the state first, then open the popup.
 */
export function AddState({ target, onSave }: { target: Duplicate; onSave: (state: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("Hover");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-[11px] text-ink-secondary underline"
      >
        Add this view as a state of “{target.title}”
      </button>
    );
  }
  const name = state === "Other…" ? custom.trim() : state;
  return (
    <div className="space-y-1.5 rounded-[10px] bg-surface-raised p-2">
      <label className="block text-[11px] text-ink-muted" htmlFor="state-name">
        Which state is on screen?
      </label>
      <div className="flex flex-wrap gap-1">
        <select
          id="state-name"
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="h-8 rounded-full border-0 bg-surface px-3 text-xs text-ink"
        >
          {[...STATES, "Other…"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {state === "Other…" && (
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Name it"
            aria-label="State name"
            className="h-8 w-32 text-xs"
          />
        )}
        <Button
          className="h-8 px-3 text-xs"
          disabled={!name || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(name);
            } finally {
              setBusy(false);
            }
          }}
        >
          Add state
        </Button>
      </div>
    </div>
  );
}

/**
 * Pick assets out of the page to keep with its reference: images and SVG icons (files), the fonts in use (names only)
 * and gradients (CSS). At most 20 files; nothing is copied wholesale.
 */
export function AssetPicker({ found, target }: { found: Discovered; target: Duplicate | null }) {
  const [images, setImages] = useState<string[]>([]);
  const [svgs, setSvgs] = useState<number[]>([]);
  const [fonts, setFonts] = useState<number[]>([]);
  const [gradients, setGradients] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const files = images.length + svgs.length;
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const empty = !found.images.length && !found.svgs.length && !found.fonts.length && !found.gradients.length;
  if (empty) return <p className="text-xs text-ink-muted">No images, icons, fonts or gradients found on screen.</p>;
  const save = async () => {
    if (!target) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.extract(target.id, {
        images: images.map((url) => ({ url })),
        svgs: svgs.map((i) => ({ markup: found.svgs[i].markup, name: found.svgs[i].name })),
        fonts: fonts.map((i) => found.fonts[i]),
        gradients: gradients.map((i) => found.gradients[i]),
      });
      setResult(
        `Saved ${res.saved.length} file${res.saved.length === 1 ? "" : "s"}` +
          (res.fonts ? `, ${res.fonts} font name${res.fonts === 1 ? "" : "s"}` : "") +
          (res.gradients ? `, ${res.gradients} gradient${res.gradients === 1 ? "" : "s"}` : "") +
          (res.failed.length ? `. Couldn’t get ${res.failed.length}: ${res.failed[0].error}` : "."),
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const section = (title: string, children: React.ReactNode) => (
    <fieldset className="space-y-1">
      <legend className="text-xs text-ink-subtle">{title}</legend>
      {children}
    </fieldset>
  );
  const row = (checked: boolean, onChange: () => void, label: React.ReactNode, key: string, disabled = false) => (
    <label key={key} className={cx("flex items-center gap-2 text-xs", disabled && "opacity-40")}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="accent-[var(--accent-fill)]"
      />
      {label}
    </label>
  );
  const full = files >= 20;
  return (
    <div className="space-y-3 rounded-[12px] bg-surface p-3">
      {found.images.length > 0 &&
        section(
          "Images",
          found.images.map((img) =>
            row(
              images.includes(img.url),
              () => toggle(images, setImages, img.url),
              <span className="flex min-w-0 items-center gap-2">
                <img src={img.url} alt="" className="h-8 w-12 shrink-0 rounded-[6px] bg-surface-raised object-cover" />
                <span className="truncate text-ink-secondary">
                  {img.alt || new URL(img.url).pathname.split("/").pop()} · {img.width}×{img.height}
                </span>
              </span>,
              img.url,
              full && !images.includes(img.url),
            ),
          ),
        )}
      {found.svgs.length > 0 &&
        section(
          "Icons (SVG)",
          found.svgs.map((s, i) =>
            row(
              svgs.includes(i),
              () => toggle(svgs, setSvgs, i),
              <span className="flex min-w-0 items-center gap-2">
                <img
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.markup)}`}
                  alt=""
                  className="size-6 shrink-0 rounded-[4px] bg-white p-0.5"
                />
                <span className="truncate text-ink-secondary">{s.name}</span>
              </span>,
              `svg${i}`,
              full && !svgs.includes(i),
            ),
          ),
        )}
      {found.fonts.length > 0 &&
        section(
          "Fonts (names only)",
          found.fonts.map((f, i) =>
            row(
              fonts.includes(i),
              () => toggle(fonts, setFonts, i),
              <span className="text-ink-secondary">
                {f.family} {f.weight} {f.style !== "normal" ? f.style : ""}
              </span>,
              `font${i}`,
            ),
          ),
        )}
      {found.gradients.length > 0 &&
        section(
          "Gradients",
          found.gradients.map((g, i) =>
            row(
              gradients.includes(i),
              () => toggle(gradients, setGradients, i),
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-5 w-12 shrink-0 rounded-[4px]" style={{ backgroundImage: g }} />
                <span className="truncate font-mono text-[10px] text-ink-muted">{g}</span>
              </span>,
              `gradient${i}`,
            ),
          ),
        )}
      {target ? (
        <Button
          disabled={busy || !(files || fonts.length || gradients.length)}
          onClick={save}
          className="h-8 px-3 text-xs"
        >
          {busy && <Loader2 className="animate-spin" />} Save to “{target.title}”{files ? ` (${files}/20 files)` : ""}
        </Button>
      ) : (
        <p className="text-xs text-ink-muted">Save the page first; then its assets can be kept with it.</p>
      )}
      {result && (
        <p role="status" className="text-xs text-ink-muted">
          {result}
        </p>
      )}
    </div>
  );
}
