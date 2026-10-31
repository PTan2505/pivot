"use client";

import { ExternalLink } from "lucide-react";
import { externalSearchLinks } from "@pivot/core/known-sources";
import { hostOf } from "@/components/resource-card";
import { useResources } from "@/lib/api";

/**
 * "Look elsewhere": the same search on inspiration sites (your saved sources first). Links only; nothing comes into
 * the library until you save a page from them.
 */
export function ExternalSearch({ query }: { query: string }) {
  const { data: sources = [] } = useResources({ type: "source" });
  const links = externalSearchLinks(query, {
    savedHosts: sources.map((s) => hostOf(s.sourceUrl) ?? "").filter(Boolean),
    limit: 6,
  });
  if (!links.length) return null;
  return (
    <section aria-label="Look elsewhere" className="w-full max-w-md space-y-2 pt-4 text-left">
      <h2 className="text-xs text-ink-subtle">Look elsewhere for “{query}”</h2>
      <ul className="grid grid-cols-2 gap-1.5">
        {links.map((l) => (
          <li key={l.host}>
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
            >
              <ExternalLink className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{l.name}</span>
              {l.saved && <span className="ml-auto text-[11px] text-ink-subtle">saved</span>}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-subtle">
        Results stay on those sites; save a page with the extension to keep it.
      </p>
    </section>
  );
}
