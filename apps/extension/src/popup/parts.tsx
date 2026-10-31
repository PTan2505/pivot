import { ExternalLink, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CollectionDTO, ResourceDTO, TagKind } from "@pivot/core/types";
import { TYPE_DEFS } from "@pivot/core/types";
import { api, openInApp, serverUrlFor, type Duplicate } from "../lib/api";
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
export function Duplicates({ items, total, url }: { items: Duplicate[]; total: number; url: string }) {
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
      {q.trim() ? (
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
