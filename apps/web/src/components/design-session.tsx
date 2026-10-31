"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DesignSessionDetailDTO, DesignStatus } from "@pivot/core/types";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  exploring: "Exploring",
  approved: "Approved",
  building: "Building",
  done: "Done",
  abandoned: "Abandoned",
};

const MILESTONE_LABEL = { initial: "First brief", approved: "Approved brief", major_change: "Major change" } as const;
const DECISION_LABEL = { approval: "Approved", change: "Changed", deviation: "Deviation found in QA" } as const;

/**
 * One design session: its briefs at each milestone and the decisions, in time order. The newest brief is open; older
 * ones are collapsed.
 */
export function DesignSessionView({ id }: { id: string }) {
  const qc = useQueryClient();
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["design-session", id],
    queryFn: () => api<DesignSessionDetailDTO>(`/api/design/sessions/${id}`),
  });
  const setStatus = async (status: DesignStatus) => {
    try {
      await api(`/api/design/sessions/${id}`, { method: "PATCH", json: { status } });
      await qc.invalidateQueries({ queryKey: ["design-session", id] });
      await qc.invalidateQueries({ queryKey: ["design-sessions"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the status");
    }
  };

  if (isLoading) return <Loader2 className="m-10 size-4 animate-spin text-ink-muted" aria-label="Loading" />;
  if (error || !s) return <p className="m-10 text-sm text-danger">This design session doesn’t exist.</p>;

  const timeline = [
    ...s.snapshots.map((x) => ({ at: x.createdAt, kind: "snapshot" as const, x })),
    ...s.decisions.map((d) => ({ at: d.createdAt, kind: "decision" as const, d })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const lastSnapshot = s.snapshots.at(-1)?.id;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pt-8 pb-16 md:px-10">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/design">
            <ArrowLeft /> Design sessions
          </Link>
        </Button>
        <h1 className="text-[clamp(32px,4.5vw,56px)] leading-[1] font-medium tracking-[-0.04em]">{s.title}</h1>
        <p className="text-sm text-ink-muted">
          {[s.targetProject, s.surface, `started ${new Date(s.createdAt).toLocaleDateString()}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
          {(Object.keys(DESIGN_STATUS_LABEL) as DesignStatus[]).map((st) => (
            <Button
              key={st}
              role="radio"
              aria-checked={s.status === st}
              size="sm"
              variant="secondary"
              className={s.status === st ? "bg-inverse text-on-inverse hover:bg-inverse" : undefined}
              onClick={() => setStatus(st)}
            >
              {DESIGN_STATUS_LABEL[st]}
            </Button>
          ))}
        </div>
      </div>
      <ol className="space-y-3">
        {timeline.map((item) =>
          item.kind === "decision" ? (
            <li key={item.d.id} className="space-y-1 rounded-[14px] bg-surface px-4 py-3">
              <p className="text-xs text-ink-muted">
                <span className="text-ink-secondary">{DECISION_LABEL[item.d.kind]}</span> ·{" "}
                {new Date(item.at).toLocaleString()}
              </p>
              <p className="text-sm text-ink">{item.d.summary}</p>
              {item.d.direction && <p className="text-sm text-ink-secondary">Direction: {item.d.direction}</p>}
              {item.d.details && (
                <div className="text-sm">
                  <Markdown>{item.d.details}</Markdown>
                </div>
              )}
            </li>
          ) : (
            <li key={item.x.id}>
              <details open={item.x.id === lastSnapshot} className="rounded-[14px] bg-surface px-4 py-3">
                <summary className="cursor-pointer text-xs text-ink-muted">
                  <span className="text-ink-secondary">{MILESTONE_LABEL[item.x.milestone]}</span> ·{" "}
                  {new Date(item.at).toLocaleString()}
                  {item.x.referenceIds.length > 0 && ` · ${item.x.referenceIds.length} references`}
                  {item.x.note && ` · ${item.x.note}`}
                </summary>
                <div className="mt-3 text-sm">
                  <Markdown>{item.x.markdown}</Markdown>
                </div>
                {item.x.referenceIds.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {item.x.referenceIds.map((r, i) => (
                      <Link
                        key={r}
                        href={`/r/${r}`}
                        className="rounded-full bg-surface-raised px-2.5 py-0.5 hover:underline"
                      >
                        Reference {i + 1}
                      </Link>
                    ))}
                  </p>
                )}
              </details>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
