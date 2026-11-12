"use client";

import Link from "next/link";
import { Check, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TAG_KIND_LABELS, type SuggestionDTO, type TagKind } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api, useInvalidate } from "@/lib/api";

function describe(s: SuggestionDTO) {
  const v = s.value as { kind?: TagKind; name?: string; text?: string; existing?: boolean };
  if (s.kind === "facet")
    return `${TAG_KIND_LABELS[v.kind as TagKind] ?? v.kind}: ${v.name}${v.existing ? "" : " (new)"}`;
  if (s.kind === "collection") return `Collection: ${v.name}${v.existing ? "" : " (new)"}`;
  if (s.kind === "title") return `Title: ${v.text}`;
  return `Description: ${v.text}`;
}

/**
 * Suggestions from an agent, waiting for you: accept applies them, reject drops them, several at once. Nothing is
 * applied by itself. With `resourceId`, only that reference's.
 */
export function Suggestions({ resourceId }: { resourceId?: string }) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  const key = ["suggestions", resourceId ?? "all"];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ suggestions: SuggestionDTO[] }>(
        resourceId ? `/api/resources/${resourceId}/suggestions` : "/api/suggestions",
      ),
  });
  const [picked, setPicked] = useState<string[]>([]);
  const items = data?.suggestions ?? [];
  if (!items.length) return null;

  const decide = async (ids: string[], accept: boolean) => {
    try {
      await api("/api/suggestions/decide", { method: "POST", json: { ids, accept } });
      setPicked((p) => p.filter((id) => !ids.includes(id)));
      await qc.invalidateQueries({ queryKey: ["suggestions"] });
      invalidate();
      for (const s of items.filter((i) => ids.includes(i.id))) invalidate(s.resourceId);
      toast.success(`${accept ? "Accepted" : "Rejected"} ${ids.length} suggestion${ids.length > 1 ? "s" : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <section aria-label="Suggestions" className="space-y-2 rounded-[14px] bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-ink-subtle" aria-hidden />
        <h2 className="text-sm text-ink">
          {items.length} suggestion{items.length > 1 ? "s" : ""} from an agent
        </h2>
        <span className="text-xs text-ink-muted">Searchable already; nothing changes until you accept.</span>
        {picked.length > 0 && (
          <div className="ml-auto flex gap-1.5">
            <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={() => decide(picked, true)}>
              <Check /> Accept {picked.length}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => decide(picked, false)}>
              <X /> Reject {picked.length}
            </Button>
          </div>
        )}
      </div>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded-[10px] bg-surface-raised px-3 py-2 text-xs">
            <Checkbox
              checked={picked.includes(s.id)}
              onCheckedChange={(v) => setPicked((p) => (v ? [...p, s.id] : p.filter((x) => x !== s.id)))}
              aria-label={`Select: ${describe(s)}`}
            />
            <span className="min-w-0 flex-1">
              <span className="text-ink">{describe(s)}</span>
              {!resourceId && s.resourceTitle && (
                <>
                  {" "}
                  <span className="text-ink-muted">for</span>{" "}
                  <Link href={`/r/${s.resourceId}`} className="text-ink-secondary hover:underline">
                    {s.resourceTitle}
                  </Link>
                </>
              )}
              {s.reason && <span className="block text-ink-muted">{s.reason}</span>}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Accept: ${describe(s)}`}
              onClick={() => decide([s.id], true)}
            >
              <Check />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Reject: ${describe(s)}`}
              className="hover:text-danger"
              onClick={() => decide([s.id], false)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
