"use client";

import Link from "next/link";
import { Check, Link2, Plus, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LINK_KINDS, LINK_LABELS, type LinkKind, type ResourceLinkDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useResources } from "@/lib/api";

/** Kinds you can add by hand; "same page" is made by PIVOT when two saves share a URL. */
const MANUAL_KINDS = LINK_KINDS.filter((k) => k !== "same_source_page");

/**
 * Links to other references: the page a section belongs to, other saves of the same page, related ones, variants and
 * newer versions. Suggestions (not confirmed) can be accepted or removed.
 */
export function ResourceLinks({ resourceId }: { resourceId: string }) {
  const qc = useQueryClient();
  const key = ["links", resourceId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ links: ResourceLinkDTO[] }>(`/api/resources/${resourceId}/links`),
  });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<LinkKind>("related_to");
  const [q, setQ] = useState("");
  const { data: results = [] } = useResources({ q, limit: 6 }, { enabled: adding && q.trim().length > 1 });
  const links = data?.links ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      await refresh();
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <section className="space-y-2" aria-label="Links">
      <div className="flex items-center gap-2">
        <h2 className="text-xs text-ink-subtle">Links</h2>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setAdding((a) => !a)}
          aria-expanded={adding}
        >
          <Plus /> Link
        </Button>
      </div>
      {links.length === 0 && !adding && <p className="text-xs text-ink-subtle">No links yet.</p>}
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-[10px] bg-surface px-3 py-2 text-xs">
            <Link2 className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
            <span className="shrink-0 text-ink-muted">{LINK_LABELS[l.kind][l.direction]}</span>
            <Link href={`/r/${l.other.id}`} className="min-w-0 flex-1 truncate text-ink hover:underline">
              {l.other.title}
            </Link>
            {!l.confirmed && (
              <>
                <span className="text-ink-subtle">suggested</span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Accept the link to ${l.other.title}`}
                  onClick={() => run(() => api(`/api/links/${l.id}`, { method: "PATCH" }), "Link accepted")}
                >
                  <Check />
                </Button>
              </>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove the link to ${l.other.title}`}
              className="hover:text-danger"
              onClick={() => run(() => api(`/api/links/${l.id}`, { method: "DELETE" }), "Link removed")}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
      {adding && (
        <div className="space-y-2 rounded-[14px] bg-surface p-3">
          <Select value={kind} onValueChange={(v) => setKind(v as LinkKind)}>
            <SelectTrigger size="sm" className="w-full" aria-label="Kind of link">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {LINK_LABELS[k].out}…
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a reference"
            aria-label="Find a reference to link"
            className="h-8 text-xs"
          />
          <ul className="space-y-1">
            {results
              .filter((r) => r.id !== resourceId)
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full truncate rounded-[10px] px-2 py-1.5 text-left text-xs hover:bg-surface-raised"
                    onClick={() =>
                      run(
                        () => api(`/api/resources/${resourceId}/links`, { method: "POST", json: { toId: r.id, kind } }),
                        `Linked: ${LINK_LABELS[kind].out.toLowerCase()} ${r.title}`,
                      ).then(() => {
                        setAdding(false);
                        setQ("");
                      })
                    }
                  >
                    {r.title}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
