"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Ellipsis, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  DesignDecisionDTO,
  DesignFeedbackDTO,
  DesignSessionDetailDTO,
  DesignSnapshotDTO,
  DesignStatus,
} from "@pivot/core/types";
import { DesignCandidates } from "@/components/design-candidates";
import { DesignMockups } from "@/components/design-mockups";
import { Markdown } from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const shortDate = (at: string) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const dateTime = (at: string) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The lifecycle as a stepper. */
function Stepper({ status, saving }: { status: DesignStatus; saving: boolean }) {
  const current = STEPS.indexOf(status);
  return (
    <ol
      aria-label="Status"
      className={cn("flex flex-wrap items-center gap-y-1", status === "abandoned" && "opacity-50")}
    >
      {STEPS.map((st, i) => {
        const isCurrent = st === status;
        const isPast = current > i;
        return (
          <li key={st} className="flex items-center" aria-current={isCurrent ? "step" : undefined}>
            {i > 0 && (
              <span aria-hidden className={cn("h-0.5 w-3 sm:w-7", isPast || isCurrent ? "bg-success" : "bg-divider")} />
            )}
            <span
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] sm:gap-2 sm:px-3",
                isCurrent ? "bg-surface-raised font-medium text-ink" : isPast ? "text-ink-secondary" : "text-ink-muted",
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
      {status === "abandoned" && (
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
  );
}

/** One clause on where the session is, the one next move, and the rarer moves under More. */
function StatusRow({
  session: s,
  saving,
  onChange,
}: {
  session: DesignSessionDetailDTO;
  saving: boolean;
  onChange: (status: DesignStatus) => void;
}) {
  const [reopening, setReopening] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const hadApproval = s.decisions.some((d) => d.kind === "approval");
  const note: Record<DesignStatus, string> = {
    exploring: hadApproval
      ? "Changed since the last approval: approve again to go on."
      : s.mockups.length
        ? "Waiting for your approval."
        : "Waiting for a version to approve.",
    approved: "Approved. Ready to build.",
    building: "Being built.",
    done: "Built and checked.",
    abandoned: "Stopped. Kept for reference.",
  };
  const next = NEXT_STEP[s.status];
  const canReopen = s.status === "approved" || s.status === "building" || s.status === "done";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="mr-2 text-sm text-ink-muted" aria-live="polite">
        {note[s.status]}
      </p>
      {next && (
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse"
          disabled={saving}
          onClick={() => onChange(next.to)}
        >
          {next.label} <ArrowRight />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* stays enabled while a move saves, so focus stays on it after a menu choice */}
          <Button ref={moreRef} size="sm" variant="ghost">
            <Ellipsis /> More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-52">
          {s.status === "done" && (
            <DropdownMenuItem disabled={saving} onSelect={() => onChange("building")}>
              Back to building
            </DropdownMenuItem>
          )}
          {s.status === "abandoned" ? (
            // back to approved only when an approval still counts; otherwise it needs approving again
            <DropdownMenuItem
              disabled={saving}
              onSelect={() => onChange(s.currentApprovalId ? "approved" : "exploring")}
            >
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={saving} onSelect={() => onChange("abandoned")}>
              Abandon
            </DropdownMenuItem>
          )}
          {canReopen && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={saving} onSelect={() => setReopening(true)}>
                Reopen…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={reopening} onOpenChange={setReopening}>
        <AlertDialogContent
          // opened from the menu, it has no trigger of its own: focus goes back to More
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            moreRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Reopen this session?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to Exploring, and the work needs approving again before more building.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onChange("exploring")}>
              Reopen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The approval that counts, kept in view while the work is built: which version, where, when, and the owner's note. */
function ApprovedBand({ session: s }: { session: DesignSessionDetailDTO }) {
  const a = s.decisions.find((d) => d.id === s.currentApprovalId && d.kind === "approval");
  if (!a || !["approved", "building", "done"].includes(s.status)) return null;
  const m = a.binding && s.mockups.find((x) => x.id === a.binding!.mockupId);
  return (
    <div className="flex max-w-4xl flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-[14px] bg-surface px-4 py-3 text-sm text-ink">
      <span className="inline-flex items-center gap-1.5 font-medium text-success">
        <Check className="size-3.5" aria-hidden /> Approved
      </span>
      <span>
        {m ? `version ${m.n} “${m.title}”` : a.direction || a.summary}
        {a.source === "owner" && " in PIVOT"}
        {a.source === "chat" && " in the chat"} · {shortDate(a.createdAt)}
      </span>
      {a.details ? (
        a.source === "chat" ? (
          // a chat approval's details already quote the user's words
          <span className="line-clamp-2 [overflow-wrap:anywhere] text-ink-secondary">{a.details}</span>
        ) : (
          <q className="[overflow-wrap:anywhere] text-ink-secondary">{a.details}</q>
        )
      ) : (
        <span className="text-ink-muted">No note.</span>
      )}
    </div>
  );
}

const MILESTONE_LABEL = { initial: "Brief", approved: "Approved brief", major_change: "Major change" } as const;
const DECISION_LABEL = {
  approval: "Approved",
  change: "Changed",
  deviation: "Deviation",
  qa: "QA report",
} as const;

/** A brief's own title: its first heading, without the markdown. */
function briefTitle(md: string) {
  const h = md.match(/^#{1,3}\s+(.+)$/m)?.[1] ?? md.split("\n").find((l) => l.trim()) ?? "";
  return h.replace(/[*_`]/g, "").trim();
}

const snapshotLine = (x: DesignSnapshotDTO) =>
  [
    briefTitle(x.markdown),
    x.note,
    x.referenceIds.length ? `${x.referenceIds.length} reference${x.referenceIds.length === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const decisionLabel = (d: DesignDecisionDTO) =>
  DECISION_LABEL[d.kind] + (d.source === "owner" ? " in PIVOT" : d.source === "chat" ? " in the chat" : "");

function SnapshotBody({ x }: { x: DesignSnapshotDTO }) {
  return (
    <>
      <div className="text-sm">
        <Markdown>{x.markdown}</Markdown>
      </div>
      {x.referenceIds.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {x.referenceIds.map((r, i) => (
            <Link key={r} href={`/r/${r}`} className="rounded-full bg-surface-raised px-2.5 py-0.5 hover:underline">
              Reference {i + 1}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}

const chevron = (
  <ChevronDown
    aria-hidden
    className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
  />
);

/**
 * One design session, in the order you use it: where it is (and the approval being built), the mockups, the
 * references, the current brief, and the history on demand. Every brief and decision stays here, collapsed, each with its
 * own link (#brief-…, #decision-…).
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

  // #brief-… and #decision-… open that item of the history (once the session has loaded, and on later hash changes)
  const loaded = !!s;
  useEffect(() => {
    if (!loaded) return;
    const openHash = () => {
      const el = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, [loaded]);

  const historyRef = useRef<HTMLOListElement>(null);
  const [expanded, setExpanded] = useState(false);
  const expandAll = () => {
    const next = !expanded;
    historyRef.current?.querySelectorAll("details").forEach((d) => (d.open = next));
    setExpanded(next);
  };
  // the label follows the rows, however they were opened (by hand, a #link, Expand all)
  const syncExpanded = () => {
    const rows = [...(historyRef.current?.querySelectorAll("details") ?? [])];
    setExpanded(rows.length > 0 && rows.every((d) => d.open));
  };

  if (isLoading) return <Loader2 className="m-10 size-4 animate-spin text-ink-muted" aria-label="Loading" />;
  if (error || !s) return <p className="m-10 text-sm text-danger">This design session doesn’t exist.</p>;

  const brief = s.snapshots.at(-1);
  const history = [
    ...s.snapshots.filter((x) => x.id !== brief?.id).map((x) => ({ at: x.createdAt, kind: "snapshot" as const, x })),
    ...s.decisions.map((d) => ({ at: d.createdAt, kind: "decision" as const, d })),
    ...(s.feedback ?? []).map((f) => ({ at: f.createdAt, kind: "feedback" as const, f })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const versionOf = (id: string | null) => {
    const m = id ? s.mockups.find((x) => x.id === id) : undefined;
    return m ? `version ${m.n} (round ${m.round})` : null;
  };
  const feedbackLine = (f: DesignFeedbackDTO) =>
    [
      f.text ? `“${f.text}”` : "",
      f.pins.length ? `${f.pins.length} pin${f.pins.length === 1 ? "" : "s"}` : "",
      versionOf(f.mockupId) ? `on ${versionOf(f.mockupId)}` : `whole round ${f.round}`,
      f.status === "open" ? "open" : `answered in round ${f.addressedRound}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const label = (item: (typeof history)[number]) =>
    item.kind === "decision"
      ? decisionLabel(item.d)
      : item.kind === "feedback"
        ? "Feedback"
        : MILESTONE_LABEL[item.x.milestone];

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
          {[s.targetProject, `started ${shortDate(s.createdAt)}`].filter(Boolean).join(" · ")}
        </p>
        <Stepper status={s.status} saving={saving} />
        <StatusRow session={s} saving={saving} onChange={setStatus} />
      </div>
      <ApprovedBand session={s} />
      {s.mockups.length > 0 && <DesignMockups session={s} />}
      {s.candidates?.length > 0 && <DesignCandidates candidates={s.candidates} />}

      {brief && (
        <section aria-labelledby="current-brief-heading" className="max-w-4xl space-y-3">
          <h2 id="current-brief-heading" className="text-xl font-medium tracking-[-0.02em]">
            Brief
          </h2>
          <details id={`brief-${brief.id}`} className="group scroll-mt-28 rounded-[14px] bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 text-ink sm:truncate">
                {snapshotLine(brief)} · <span className="text-ink-secondary">{MILESTONE_LABEL[brief.milestone]}</span> ·{" "}
                <span className="text-ink-muted">{shortDate(brief.createdAt)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink-secondary">
                <span className="group-open:hidden">Read brief</span>
                <span className="hidden group-open:inline">Close</span>
                {chevron}
              </span>
            </summary>
            <div className="px-4 pb-4">
              <SnapshotBody x={brief} />
            </div>
          </details>
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="history-heading" className="max-w-4xl space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 id="history-heading" className="text-xl font-medium tracking-[-0.02em]">
              History
            </h2>
            <span className="text-sm text-ink-muted">
              {history.length}
              {history.length > 1 && " · newest first"}
            </span>
            {history.length > 1 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={expandAll}>
                {expanded ? "Collapse all" : "Expand all"}
              </Button>
            )}
          </div>
          <ol ref={historyRef} className="space-y-0.5">
            {history.map((item) => {
              const key =
                item.kind === "decision"
                  ? `decision-${item.d.id}`
                  : item.kind === "feedback"
                    ? `feedback-${item.f.id}`
                    : `brief-${item.x.id}`;
              return (
                <li key={key}>
                  <details id={key} onToggle={syncExpanded} className="group scroll-mt-28 rounded-xl bg-surface">
                    <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl px-3.5 py-2.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid sm:grid sm:grid-cols-[150px_120px_1fr_16px] [&::-webkit-details-marker]:hidden">
                      <span className="font-medium text-ink-secondary max-sm:hidden">{label(item)}</span>
                      <span className="text-[13px] text-ink-muted max-sm:hidden">{dateTime(item.at)}</span>
                      <span className="min-w-0 flex-1 text-ink group-open:whitespace-normal sm:truncate">
                        <span className="text-ink-secondary sm:hidden">{label(item)} · </span>
                        {item.kind === "decision"
                          ? item.d.summary
                          : item.kind === "feedback"
                            ? feedbackLine(item.f)
                            : snapshotLine(item.x)}
                      </span>
                      <span className="mt-0.5">{chevron}</span>
                    </summary>
                    <div className="space-y-2 px-3.5 pb-3.5 text-sm text-ink-secondary">
                      <p className="text-[13px] text-ink-muted sm:hidden">{dateTime(item.at)}</p>
                      {item.kind === "feedback" ? (
                        <>
                          {item.f.text && <p className="whitespace-pre-wrap text-ink">{item.f.text}</p>}
                          {item.f.pins.length > 0 && (
                            <ol className="space-y-1">
                              {item.f.pins.map((p, i) => (
                                <li key={i}>
                                  <span className="font-mono text-ink-muted">{p.n ?? i + 1}.</span>{" "}
                                  {p.text || "(no note)"}{" "}
                                  <span className="text-[12px] text-ink-muted">
                                    at {p.x}, {p.y} on the {item.f.width}px render
                                  </span>
                                </li>
                              ))}
                            </ol>
                          )}
                          <p className="text-[13px] text-ink-muted">
                            {item.f.status === "open"
                              ? "Open: Claude answers it with a new round."
                              : `Answered in round ${item.f.addressedRound}.`}
                          </p>
                        </>
                      ) : item.kind === "decision" ? (
                        <>
                          {item.d.direction && <p>Direction: {item.d.direction}</p>}
                          {item.d.details && <Markdown>{item.d.details}</Markdown>}
                          {!item.d.direction && !item.d.details && <p className="text-ink-muted">Nothing more.</p>}
                        </>
                      ) : (
                        <SnapshotBody x={item.x} />
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
