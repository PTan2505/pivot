"use client";

import { Check, ExternalLink, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  externalPageFor,
  type ExternalResult,
  type LinkOutResult,
  type ProviderResults,
  type SearchScope,
} from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useExternalSearch, useSaveExternal } from "@/lib/api";
import { cn } from "@/lib/utils";

const SCOPE_LABEL: Record<SearchScope, string> = { all: "All", library: "Library", external: "External" };

/** One search, three scopes: everything, only your library, or only outside it. */
export function ScopeSwitch({
  value,
  onChange,
  className,
}: {
  value: SearchScope;
  onChange: (scope: SearchScope) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={1}
      value={value}
      onValueChange={(v) => v && onChange(v as SearchScope)}
      aria-label="Search in"
      className={className}
    >
      {(["all", "library", "external"] as const).map((s) => (
        <ToggleGroupItem key={s} value={s} className="px-3">
          {SCOPE_LABEL[s]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** A real result from a free catalog: what it is, where it's from, and its licence. Nothing is saved until you ask. */
function ResultCard({ result }: { result: ExternalResult }) {
  const save = useSaveExternal();
  const onSave = () =>
    save.mutate(result, {
      onSuccess: (r) =>
        toast.success(r.existing ? `“${r.title ?? result.title}” is already in your library` : `Saved “${r.title}”`, {
          action: { label: "Open", onClick: () => window.location.assign(r.path) },
        }),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save it"),
    });
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-[14px] bg-surface p-4">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink" title={result.title}>
          {result.title}
        </h3>
        {result.categories.map((c) => (
          <span key={c} className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-secondary">
            {c}
          </span>
        ))}
      </div>
      <p className="line-clamp-2 min-h-[2.6em] text-[13px] leading-[1.3] text-ink-muted">
        {result.description || "No description in the catalog."}
      </p>
      <p className="text-[11px] text-ink-subtle">
        {result.attribution}
        {!result.linkVerified && ` · opens the ${result.providerName} catalog`}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button asChild variant="secondary" size="sm">
          <a href={result.url} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> Open
          </a>
        </Button>
        {result.saved ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/r/${result.saved.resourceId}`}>
              <Check aria-hidden /> In your library
            </Link>
          </Button>
        ) : (
          result.linkVerified && (
            <Button variant="ghost" size="sm" onClick={onSave} disabled={save.isPending}>
              <Plus aria-hidden /> {save.isPending ? "Saving…" : "Save to library"}
            </Button>
          )
        )}
      </div>
    </article>
  );
}

function ProviderSection({ provider, compact }: { provider: ProviderResults; compact: boolean }) {
  if (provider.status === "disabled") return null;
  return (
    <section aria-label={`${provider.name} results`} className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-medium text-ink">{provider.name}</h2>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-ink">Direct</span>
        <a href={provider.licence.url} target="_blank" rel="noreferrer" className="text-xs text-accent-text">
          {provider.licence.name}
        </a>
        {provider.syncedAt && <span className="text-xs text-ink-subtle">Catalog from {day(provider.syncedAt)}</span>}
        {provider.total > provider.results.length && (
          <span className="text-xs text-ink-subtle">
            {provider.results.length} of {provider.total}
          </span>
        )}
      </header>
      {provider.status !== "ok" && (
        <p role="status" className="flex items-start gap-2 text-[13px] text-ink-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          {provider.status === "stale"
            ? `Couldn’t update the catalog (${provider.message}); showing the copy from ${day(provider.syncedAt)}.`
            : `${provider.name} couldn’t be searched: ${provider.message}`}
        </p>
      )}
      {provider.results.length > 0 ? (
        <div
          className={cn(
            "grid gap-3",
            compact
              ? "grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]",
          )}
        >
          {provider.results.map((r) => (
            <ResultCard key={r.externalId} result={r} />
          ))}
        </div>
      ) : (
        provider.status === "ok" && <p className="text-[13px] text-ink-muted">No match in {provider.name}.</p>
      )}
    </section>
  );
}

/** Search pages on other sites: they open there and are never shown as results. */
function LinkOuts({ links }: { links: LinkOutResult[] }) {
  if (!links.length) return null;
  return (
    <section aria-label="Search on other sites" className="space-y-2">
      <h2 className="text-[15px] font-medium text-ink">Search on other sites</h2>
      <p className="text-[13px] text-ink-muted">These open each site’s own search page. They aren’t results.</p>
      <ul className="flex flex-wrap gap-1.5">
        {links.map((l) => (
          <li key={l.host}>
            <a
              href={l.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] text-ink-secondary hover:bg-surface-raised hover:text-ink"
            >
              <ExternalLink className="size-3" aria-hidden />
              {l.name}
              {l.saved && <span className="text-[11px] text-ink-subtle">saved source</span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The External side of the search: each free catalog PIVOT searches directly (on this computer), then links to search
 * other sites. Each provider loads and fails on its own.
 */
export function ExternalResults({ query, compact = false }: { query: string; compact?: boolean }) {
  const { data, isLoading, error } = useExternalSearch(query, { limit: compact ? 3 : 6 });
  // While a new query loads, the previous results stay (no flicker) but under their own query, dimmed, never as the
  // new query's results.
  const current = externalPageFor(data, query);
  const shown = current ?? data;
  const updating = !!data && !current;
  return (
    <div className="space-y-8" aria-busy={isLoading || updating}>
      <div className="space-y-1">
        <h2 className="text-[22px] leading-tight font-medium tracking-[-0.02em] text-ink">
          Outside your library for “{shown?.query ?? query.trim()}”
        </h2>
        {updating && (
          <p role="status" className="text-[13px] text-ink-secondary">
            Searching for “{query.trim()}”…
          </p>
        )}
        <p className="text-[13px] text-ink-muted">
          Direct results come from free public catalogs, searched on this computer. Nothing is saved until you save it.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          Couldn’t search outside your library: {error.message}
        </p>
      )}
      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-[14px] bg-surface" />
          ))}
        </div>
      )}
      {shown && (
        <div className={cn("space-y-8 transition-opacity duration-150", updating && "opacity-50")}>
          {shown.providers.map((p) => (
            <ProviderSection key={p.id} provider={p} compact={compact} />
          ))}
          <LinkOuts links={shown.linkOuts} />
        </div>
      )}
    </div>
  );
}
