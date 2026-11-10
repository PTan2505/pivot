"use client";

import Link from "next/link";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useEffect } from "react";
import type { DesignCandidateDTO } from "@pivot/core/types";
import { cn } from "@/lib/utils";

/**
 * Gate 1 on the session page: the references Claude proposed, numbered, with previews (a library reference's cover, or
 * PIVOT's own capture of an external page), where each came from, and why it fits. The user picks by number in Claude
 * Code; the picked ones are marked here with the user's words.
 */
export function DesignCandidates({ candidates }: { candidates: DesignCandidateDTO[] }) {
  const picked = candidates.filter((c) => c.selected);
  // the link Claude gives ends in #references, but the section only exists once the session has loaded
  useEffect(() => {
    if (window.location.hash === "#references") document.getElementById("references")?.scrollIntoView();
  }, []);
  return (
    <section id="references" aria-labelledby="references-heading" className="scroll-mt-28 space-y-4">
      <div className="max-w-4xl space-y-1">
        <h2 id="references-heading" className="text-xl font-medium tracking-[-0.02em] text-ink">
          References
        </h2>
        <p className="text-sm text-ink-muted">
          {picked.length ? (
            <>
              You picked {picked.map((c) => c.n).join(", ")}:{" "}
              <q className="text-ink-secondary">{picked[0].selectedWords}</q>
            </>
          ) : (
            "Proposed by Claude. Tell Claude Code which numbers to use; nothing outside your library is saved to it."
          )}
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((c) => (
          <li
            key={c.id}
            className={cn(
              "flex flex-col overflow-hidden rounded-[14px] bg-surface",
              picked.length > 0 && !c.selected && "opacity-60",
            )}
          >
            <Preview c={c} />
            <div className="flex flex-1 flex-col gap-2 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-xs text-ink">
                  {c.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere] text-ink">{c.title}</p>
                  <p className="text-xs text-ink-muted">
                    {c.kind === "library" ? "Library" : `External · ${c.source}`}
                  </p>
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
        ))}
      </ol>
    </section>
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
      ) : (
        "No preview"
      )}
    </div>
  );
}
