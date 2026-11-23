"use client";

import Link from "next/link";
import { Check, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesignCandidateDTO } from "@pivot/core/types";
import { cn } from "@/lib/utils";

/**
 * Gate 1 on the session page: the references Claude proposed, numbered, with previews (a library reference's cover, or
 * PIVOT's own capture of an external page), where each came from, and why it fits. The user picks by number in Claude
 * Code. Once picked, only the picked ones show, as a row; "Show all" opens the full set with the user's words.
 */
export function DesignCandidates({ candidates }: { candidates: DesignCandidateDTO[] }) {
  const picked = candidates.filter((c) => c.selected);
  const [showAll, setShowAll] = useState(false);
  // the link Claude gives ends in #references, but the section only exists once the session has loaded
  useEffect(() => {
    if (window.location.hash === "#references") document.getElementById("references")?.scrollIntoView();
  }, []);
  const full = !picked.length || showAll;
  return (
    <section id="references" aria-labelledby="references-heading" className="scroll-mt-28 space-y-4">
      <div className="max-w-4xl space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="references-heading" className="text-xl font-medium tracking-[-0.02em] text-ink">
            References
          </h2>
          {picked.length > 0 && (
            <span className="text-sm text-ink-muted">
              {picked.length} picked of {candidates.length}
            </span>
          )}
        </div>
        {!picked.length && (
          <p className="text-sm text-ink-muted">
            Proposed by Claude. Tell Claude Code which numbers to use; nothing outside your library is saved to it.
          </p>
        )}
        {picked.length > 0 && showAll && picked[0].selectedWords && (
          <p className="text-sm text-ink-muted">
            You picked {picked.map((c) => c.n).join(", ")}:{" "}
            <q className="text-ink-secondary">{picked[0].selectedWords}</q>
          </p>
        )}
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {!showAll && picked.map((c) => <PickedChip key={c.id} c={c} />)}
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls="references-all"
            onClick={() => setShowAll((o) => !o)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-secondary outline-none hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid"
          >
            {showAll ? "Show picked only" : `Show all ${candidates.length} references`}
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform motion-reduce:transition-none", showAll && "rotate-180")}
            />
          </button>
        </div>
      )}
      <div id="references-all" hidden={!full} className="space-y-4">
        {GROUPS.map(({ category, label, hint }) => {
          const group = candidates.filter((c) => c.category === category);
          if (!group.length) return null;
          return (
            <div key={category} className="space-y-3">
              <h3 className="text-sm font-medium text-ink-secondary">
                {label} <span className="font-normal text-ink-muted">· {group.length}</span>
                <span className="ml-2 font-normal text-ink-muted">{hint}</span>
              </h3>
              <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((c) => (
                  <Candidate key={c.id} c={c} dimmed={picked.length > 0 && !c.selected} />
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A picked reference, compact: its preview, number and title, linking to it in the library or to the page. */
function PickedChip({ c }: { c: DesignCandidateDTO }) {
  const href = c.resourceId ? `/r/${c.resourceId}` : c.url;
  const body = (
    <>
      {c.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- PIVOT's own image routes
        <img src={c.previewUrl} alt="" loading="lazy" className="h-10 w-16 rounded-lg object-cover object-top" />
      ) : (
        <span aria-hidden className="h-10 w-16 rounded-lg bg-surface-raised" />
      )}
      <span className="font-mono text-xs text-ink-muted">{c.n}</span>
      <span className="max-w-56 truncate">{c.title}</span>
    </>
  );
  const cls =
    "flex items-center gap-2.5 rounded-[14px] bg-surface py-1.5 pr-3 pl-1.5 text-sm text-ink outline-none hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid";
  if (!href) return <span className={cls}>{body}</span>;
  return c.resourceId ? (
    <Link href={href} className={cls} title={c.title}>
      {body}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} title={c.title}>
      {body}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

const GROUPS = [
  { category: "layout", label: "UI layouts", hint: "Whole pages and designs" },
  { category: "component", label: "Components", hint: "Single components from catalogs or your library" },
] as const;

function Candidate({ c, dimmed }: { c: DesignCandidateDTO; dimmed: boolean }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-[14px] bg-surface">
      {/* only the preview dims: the text keeps its contrast */}
      <div className={cn(dimmed && "opacity-60")}>
        <Preview c={c} />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-xs text-ink">
            {c.n}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium [overflow-wrap:anywhere] text-ink">{c.title}</p>
            <p className="text-xs text-ink-muted">{c.kind === "library" ? "Library" : `External · ${c.source}`}</p>
          </div>
          {c.selected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink">
              <Check className="size-3" aria-hidden /> Picked
            </span>
          )}
        </div>
        <p className="text-ink-secondary">{c.why}</p>
        {c.take && (
          <p className="text-xs text-ink-muted">
            <span className="text-ink-secondary">Take:</span> {c.take}
          </p>
        )}
        {c.avoid && (
          <p className="text-xs text-ink-muted">
            <span className="text-ink-secondary">Avoid:</span> {c.avoid}
          </p>
        )}
        <div className="mt-auto flex flex-wrap gap-3 pt-1 text-xs">
          {c.resourceId && (
            <Link href={`/r/${c.resourceId}`} className="text-ink underline-offset-2 hover:underline">
              Open in library
            </Link>
          )}
          {c.url && (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline"
            >
              Original page <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function Preview({ c }: { c: DesignCandidateDTO }) {
  if (c.previewUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- PIVOT's own image routes, sized by the card
      <img
        src={c.previewUrl}
        alt={`Preview of ${c.title}`}
        loading="lazy"
        className="aspect-[16/10] w-full bg-surface-raised object-cover object-top"
      />
    );
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center bg-surface-raised px-4 text-center text-xs text-ink-muted">
      {c.previewStatus === "pending" ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Capturing a preview…
        </span>
      ) : c.previewStatus === "failed" ? (
        `No preview: ${c.previewError}`
      ) : c.kind === "external" ? (
        "Not captured. Open the page to review it."
      ) : (
        "No preview"
      )}
    </div>
  );
}
