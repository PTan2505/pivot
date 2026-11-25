"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Ellipsis, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
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
import { DesignMockups, directionOf, useMockupNav } from "@/components/design-mockups";
import { Markdown } from "@/components/markdown";
import { elementName } from "@/components/mockup-feedback";
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

const STATUS_DOT: Record<DesignStatus, string> = {
  exploring: "bg-warning",
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

/** The approval that counts now, and the version it names (by id, or by its direction's words for older ones). */
function currentApproval(s: DesignSessionDetailDTO) {
  const a = s.decisions.find((d) => d.id === s.currentApprovalId && d.kind === "approval");
  const m = a
    ? a.binding
      ? s.mockups.find((x) => x.id === a.binding!.mockupId)
      : s.mockups.find((x) => a.direction === directionOf(x))
    : undefined;
  return { approval: a, mockup: m };
}

/** Where the session stands, in one sentence (the session page's status bar and the full-screen drawer). */
export function statusSentence(s: DesignSessionDetailDTO) {
  switch (s.status) {
    case "exploring":
      return s.decisions.some((d) => d.kind === "approval")
        ? "Changed since the last approval: approve again to go on"
        : s.mockups.length
          ? "Waiting for your approval"
          : "Waiting for a version to approve";
    case "approved": {
      const { mockup: m } = currentApproval(s);
      return m ? `Approved: version ${m.n} · ${m.title}` : "Approved. Ready to build";
    }
    case "building":
      return "Being built";
    case "done":
      return "Built and checked";
    case "abandoned":
      return "Stopped. Kept for reference";
  }
}

/**
 * Where the session stands, in one bar: the sentence, a quiet summary that opens the details (the approval being built,
 * the project, when it started), the one next move, and the rarer moves under "More actions".
 */
function StatusBar({
  session: s,
  saving,
  onChange,
  summary,
  action,
}: {
  session: DesignSessionDetailDTO;
  saving: boolean;
  onChange: (status: DesignStatus) => void;
  /** A few words on the mockups (round and versions), or nothing. */
  summary?: string;
  /** The decision, while the session is exploring: Approve this version. */
  action?: React.ReactNode;
}) {
  const [reopening, setReopening] = useState(false);
  const [details, setDetails] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const next = NEXT_STEP[s.status];
  const canReopen = s.status === "approved" || s.status === "building" || s.status === "done";
  const { approval: a, mockup: m } = currentApproval(s);
  const showApproval = !!a && ["approved", "building", "done"].includes(s.status);
  const label =
    summary ||
    (s.candidates?.length
      ? `${s.candidates.length} reference${s.candidates.length === 1 ? "" : "s"} proposed`
      : "Details");
  return (
    <div className="rounded-[14px] bg-surface">
      {/* on a phone the next move takes its own line, and More actions stays beside the sentence */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="order-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-3">
          <p className="flex min-h-8 items-center gap-2 text-sm font-medium text-ink" aria-live="polite">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" />
            ) : s.status === "approved" || s.status === "done" ? (
              <Check className={cn("size-4", s.status === "approved" ? "text-success" : "text-ink")} aria-hidden />
            ) : (
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[s.status])} />
            )}
            {statusSentence(s)}
          </p>
          <button
            type="button"
            aria-expanded={details}
            aria-controls="session-details"
            onClick={() => setDetails((o) => !o)}
            className="-mx-2 inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[13px] text-ink-muted outline-none hover:bg-surface-raised hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid [@media(pointer:coarse)]:min-h-11"
          >
            {label}
            <span className="sr-only">, details</span>
            <ChevronDown
              aria-hidden
              className={cn("size-3.5 transition-transform motion-reduce:transition-none", details && "rotate-180")}
            />
          </button>
        </div>
        <div className="order-3 flex items-center gap-1.5 empty:hidden max-sm:basis-full sm:order-2">
          {action}
          {next && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse [@media(pointer:coarse)]:h-11"
              disabled={saving}
              onClick={() => onChange(next.to)}
            >
              {next.label} <ArrowRight />
            </Button>
          )}
        </div>
        <div className="order-2 sm:order-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* stays enabled while a move saves, so focus stays on it after a menu choice */}
              <Button
                ref={moreRef}
                size="icon-sm"
                variant="ghost"
                aria-label="More actions"
                className="[@media(pointer:coarse)]:size-11"
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-52">
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
        </div>
      </div>
      <div id="session-details" hidden={!details} className="px-4 pb-3.5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {showApproval && (
            <>
              <dt className="text-ink-muted">Approved</dt>
              <dd className="[overflow-wrap:anywhere] text-ink">
                {m ? `Version ${m.n} “${m.title}”` : a.direction || a.summary}
                {a.source === "owner" && " in PIVOT"}
                {a.source === "chat" && " in the chat"} · {shortDate(a.createdAt)}
              </dd>
              <dt className="text-ink-muted">Note</dt>
              <dd className="[overflow-wrap:anywhere] text-ink-secondary">
                {a.details ? (
                  // a chat approval's details already quote the user's words
                  a.source === "chat" ? (
                    a.details
                  ) : (
                    <q>{a.details}</q>
                  )
                ) : (
                  <span className="text-ink-muted">No note.</span>
                )}
              </dd>
            </>
          )}
          {s.targetProject && (
            <>
              <dt className="text-ink-muted">Project</dt>
              <dd className="[overflow-wrap:anywhere] text-ink-secondary">{s.targetProject}</dd>
            </>
          )}
          <dt className="text-ink-muted">Started</dt>
          <dd className="text-ink-secondary">{shortDate(s.createdAt)}</dd>
        </dl>
      </div>
      <AlertDialog open={reopening} onOpenChange={setReopening}>
        <AlertDialogContent
          // opened from the menu, it has no trigger of its own: focus goes back to More actions
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

/** The status bar with the mockups below it: both follow the version shown (Approve this version approves it). */
function SessionMockups({
  session: s,
  saving,
  onChange,
}: {
  session: DesignSessionDetailDTO;
  saving: boolean;
  onChange: (status: DesignStatus) => void;
}) {
  const asked = Number(useSearchParams().get("round"));
  const nav = useMockupNav(s, { round: asked || undefined });
  const answers = s.rounds?.find((r) => r.round === nav.round)?.addressesFeedback.length ?? 0;
  const summary = [
    `Round ${nav.round}`,
    `${nav.versions.length} version${nav.versions.length === 1 ? "" : "s"}`,
    answers ? `answers ${answers} feedback` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const change = s.rounds?.find((r) => r.round === nav.round)?.designSystemChange;
  return (
    <>
      <StatusBar
        session={s}
        saving={saving}
        onChange={onChange}
        summary={summary}
        action={
          nav.canApprove &&
          nav.current && (
            // inverse, not ember: the top bar's Add is this screen's one ember button (One Ember Rule)
            <Button
              size="sm"
              variant="secondary"
              data-approve-trigger
              aria-describedby={[`version-tab-${nav.current.n}`, change ? "design-system-change-page" : ""]
                .filter(Boolean)
                .join(" ")}
              onClick={() => nav.setApproving(true)}
              className="rounded-full bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse [@media(pointer:coarse)]:h-11"
            >
              <Check /> Approve this version
            </Button>
          )
        }
      />
      <DesignMockups session={s} nav={nav} />
    </>
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
 * One design session, in the order you use it: where it stands (one status bar with its one action), the mockups, then
 * the references, the current brief and the history as collapsed rows with a one-line summary. At the references step
 * (no mockups yet) the proposed references stay open in full. Every brief and decision keeps its own link (#brief-…,
 * #decision-…, #references), which opens the row it sits in.
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
      // the item itself, and the collapsed row it sits in (History, References)
      let row = el?.closest("details");
      if (!el || !row) return;
      for (; row; row = row.parentElement?.closest("details")) row.open = true;
      el.scrollIntoView({ block: "start" });
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
      f.pins.length ? `${f.pins.length} note${f.pins.length === 1 ? "" : "s"}` : "",
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

  const rowSummary =
    "flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-[14px] px-4 py-2.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid [&::-webkit-details-marker]:hidden";
  const rowHeading = "shrink-0 text-[15px] font-medium text-ink";
  const rowLine = "min-w-0 flex-1 truncate text-ink-muted";
  const candidates = s.candidates ?? [];
  const picked = candidates.filter((c) => c.selected);
  // at the references step (no mockups yet) the references are the page: they stay open and in full
  const referencesFirst = s.mockups.length === 0 && candidates.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 pb-16 md:px-10">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link href="/design">
            <ArrowLeft /> Design sessions
          </Link>
        </Button>
        <h1 className="text-3xl leading-tight font-medium tracking-[-0.015em] [overflow-wrap:anywhere]">{s.title}</h1>
      </div>
      {s.mockups.length > 0 ? (
        <SessionMockups session={s} saving={saving} onChange={setStatus} />
      ) : (
        <StatusBar session={s} saving={saving} onChange={setStatus} />
      )}
      {referencesFirst && <DesignCandidates candidates={candidates} />}

      <div className="space-y-2">
        {candidates.length > 0 && !referencesFirst && (
          <details className="group rounded-[14px] bg-surface">
            <summary className={rowSummary}>
              <h2 className={rowHeading}>References</h2>
              <span className={rowLine}>
                {picked.length
                  ? `${picked.length} picked · ${picked.map((c) => c.title).join(", ")}`
                  : `${candidates.length} proposed`}
              </span>
              {chevron}
            </summary>
            <div className="px-4 pt-1 pb-4">
              <DesignCandidates candidates={candidates} bare />
            </div>
          </details>
        )}

        {brief && (
          <details id={`brief-${brief.id}`} className="group scroll-mt-28 rounded-[14px] bg-surface">
            <summary className={rowSummary}>
              <h2 className={rowHeading}>Brief</h2>
              <span className={rowLine}>{briefTitle(brief.markdown)}</span>
              {chevron}
            </summary>
            <div className="max-w-4xl px-4 pb-4">
              <p className="mb-2 text-[13px] text-ink-muted">
                {[
                  brief.note,
                  brief.referenceIds.length
                    ? `${brief.referenceIds.length} reference${brief.referenceIds.length === 1 ? "" : "s"}`
                    : "",
                  MILESTONE_LABEL[brief.milestone],
                  shortDate(brief.createdAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <SnapshotBody x={brief} />
            </div>
          </details>
        )}

        {history.length > 0 && (
          <details className="group/history rounded-[14px] bg-surface">
            <summary className={rowSummary}>
              <h2 className={rowHeading}>History</h2>
              <span className={rowLine}>
                {history.length} event{history.length === 1 ? "" : "s"} · last: {label(history[0]).toLowerCase()},{" "}
                {shortDate(history[0].at)}
              </span>
              <ChevronDown
                aria-hidden
                className="size-4 shrink-0 text-ink-muted transition-transform group-open/history:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <div className="max-w-4xl space-y-2 px-2 pb-3 sm:px-3">
              {history.length > 1 && (
                <div className="flex items-center justify-between gap-3 px-1.5">
                  <span className="text-[13px] text-ink-muted">Newest first</span>
                  <Button size="sm" variant="ghost" onClick={expandAll}>
                    {expanded ? "Collapse all" : "Expand all"}
                  </Button>
                </div>
              )}
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
                      <details
                        id={key}
                        onToggle={syncExpanded}
                        className="group scroll-mt-28 rounded-xl bg-surface-raised"
                      >
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
                                      <span className="font-mono text-ink-muted">{p.n ?? i + 1}</span> ·{" "}
                                      {p.element ? (
                                        <span className="font-mono text-ink">{elementName(p.element)}</span>
                                      ) : (
                                        <span className="text-ink-muted">
                                          Spot at {p.x}, {p.y}
                                        </span>
                                      )}{" "}
                                      — {p.text || "(no text)"}{" "}
                                      <span className="text-[12px] text-ink-muted">({item.f.width}px render)</span>
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
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
