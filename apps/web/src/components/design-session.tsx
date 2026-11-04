"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DesignSessionDetailDTO, DesignStatus } from "@pivot/core/types";
import { ConfirmButton } from "@/components/confirm-button";
import { DesignMockups } from "@/components/design-mockups";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  exploring: "Exploring",
  approved: "Approved",
  building: "Building",
  done: "Done",
  abandoned: "Abandoned",
};

const STEPS: DesignStatus[] = ["exploring", "approved", "building", "done"];
const STEP_DOT: Record<DesignStatus, string> = {
  exploring: "bg-ink-muted",
  approved: "bg-success",
  building: "bg-warning",
  done: "bg-ink",
  abandoned: "bg-ink-subtle",
};
// Exploring and Approved follow the agent's records (the first brief, a major change, your approval); you move the rest.
const NEXT_STEP: Partial<Record<DesignStatus, { to: DesignStatus; label: string }>> = {
  approved: { to: "building", label: "Start building" },
  building: { to: "done", label: "Mark done" },
};

/** Where the work is: the lifecycle as a stepper, what the current step means, and the moves you can make by hand. */
function StatusStepper({
  session: s,
  saving,
  onChange,
}: {
  session: DesignSessionDetailDTO;
  saving: boolean;
  onChange: (status: DesignStatus) => void;
}) {
  const approvals = s.decisions.filter((d) => d.kind === "approval");
  const approvedOn = approvals.length
    ? new Date(approvals.at(-1)!.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : null;
  const current = STEPS.indexOf(s.status);
  const note: Record<DesignStatus, string> = {
    exploring: approvals.length
      ? "Changed since the last approval: approve the new direction to go on."
      : s.mockups.length
        ? "Waiting for you to approve a version below, or a direction in the chat."
        : "Waiting for you to approve a direction.",
    approved: `Direction approved on ${approvedOn}. Ready to build.`,
    building: "The approved direction is being built.",
    done: "Built and checked.",
    abandoned: "Stopped. Kept for reference.",
  };
  const next = NEXT_STEP[s.status];
  const pill = "rounded-full";
  return (
    <div className="space-y-3">
      <ol
        aria-label="Status"
        className={cn("flex flex-wrap items-center gap-y-1", s.status === "abandoned" && "opacity-50")}
      >
        {STEPS.map((st, i) => {
          const isCurrent = st === s.status;
          const isPast = current > i;
          return (
            <li key={st} className="flex items-center" aria-current={isCurrent ? "step" : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn("h-0.5 w-3 sm:w-7", isPast || isCurrent ? "bg-success" : "bg-divider")}
                />
              )}
              <span
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] sm:gap-2 sm:px-3",
                  isCurrent
                    ? "bg-surface-raised font-medium text-ink"
                    : isPast
                      ? "text-ink-secondary"
                      : "text-ink-muted",
                )}
              >
                {isPast ? (
                  <Check className="size-3.5" aria-label="done" />
                ) : isCurrent ? (
                  saving ? (
                    <Loader2 className="size-3 animate-spin" aria-label="Saving" />
                  ) : (
                    <span aria-hidden className={cn("size-2 rounded-full", STEP_DOT[st])} />
                  )
                ) : null}
                {DESIGN_STATUS_LABEL[st]}
              </span>
            </li>
          );
        })}
        {s.status === "abandoned" && (
          <li
            aria-current="step"
            className="ml-2 flex h-8 items-center gap-2 rounded-full bg-surface-raised px-3 text-[13px] font-medium text-ink"
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" aria-label="Saving" />
            ) : (
              <span aria-hidden className="size-2 rounded-full bg-ink-subtle" />
            )}
            Abandoned
          </li>
        )}
      </ol>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {note[s.status]}
        {(s.status === "exploring" || s.status === "approved") &&
          " Exploring and Approved follow the brief and your approval; you move the rest."}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {next && (
          <Button
            size="sm"
            variant="secondary"
            className={cn(pill, "bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse")}
            disabled={saving}
            onClick={() => onChange(next.to)}
          >
            {next.label} <ArrowRight />
          </Button>
        )}
        {s.status === "done" && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => onChange("building")}>
            Back to building
          </Button>
        )}
        {s.status === "abandoned" ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            // back to approved only when an approval still counts; otherwise it needs approving again
            onClick={() => onChange(s.currentApprovalId ? "approved" : "exploring")}
          >
            Restore
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => onChange("abandoned")}>
            Abandon
          </Button>
        )}
        {(s.status === "approved" || s.status === "building" || s.status === "done") && (
          <ConfirmButton
            title="Reopen this session?"
            description="It goes back to Exploring, and the work needs approving again before more building."
            confirmLabel="Reopen"
            onConfirm={() => onChange("exploring")}
          >
            <Button size="sm" variant="ghost" disabled={saving}>
              Reopen
            </Button>
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}

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
    // while the agent is working, new rounds and status moves show up without a reload
    refetchInterval: (q) =>
      q.state.data && ["exploring", "approved", "building"].includes(q.state.data.status) ? 5000 : false,
  });
  const [saving, setSaving] = useState(false);
  // Optimistic: the stepper moves on click, a spinner shows until saved, a failure puts it back and says why.
  const setStatus = async (status: DesignStatus, { undo = false } = {}) => {
    const key = ["design-session", id];
    const before = qc.getQueryData<DesignSessionDetailDTO>(key);
    if (!before || before.status === status) return;
    qc.setQueryData<DesignSessionDetailDTO>(key, { ...before, status });
    setSaving(true);
    try {
      await api(`/api/design/sessions/${id}`, { method: "PATCH", json: { status } });
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["design-sessions"] });
      if (!undo)
        toast(`Status: ${DESIGN_STATUS_LABEL[status]}`, {
          action: { label: "Undo", onClick: () => setStatus(before.status, { undo: true }) },
        });
    } catch (err) {
      qc.setQueryData<DesignSessionDetailDTO>(key, (cur) => (cur ? { ...cur, status: before.status } : cur));
      toast.error(err instanceof Error ? err.message : "Could not change the status");
    } finally {
      setSaving(false);
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
    <div className="mx-auto max-w-6xl space-y-8 px-4 pt-8 pb-16 md:px-10">
      <div className="max-w-4xl space-y-3">
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
        <StatusStepper session={s} saving={saving} onChange={setStatus} />
      </div>
      {s.mockups.length > 0 && <DesignMockups session={s} />}
      <ol className="max-w-4xl space-y-3">
        {timeline.map((item) =>
          item.kind === "decision" ? (
            <li key={item.d.id} className="space-y-1 rounded-[14px] bg-surface px-4 py-3">
              <p className="text-xs text-ink-muted">
                <span className="text-ink-secondary">
                  {DECISION_LABEL[item.d.kind]}
                  {item.d.source === "owner" && " in PIVOT"}
                </span>{" "}
                · {new Date(item.at).toLocaleString()}
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
