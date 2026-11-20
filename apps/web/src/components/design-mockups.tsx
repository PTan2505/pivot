"use client";

import Link from "next/link";
import { AppWindow, Check, ExternalLink, Info, Loader2, Maximize2, RotateCcw, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PreviewState } from "@pivot/core/preview-launcher";
import type { DesignMockupDTO, DesignRoundDTO, DesignSessionDetailDTO } from "@pivot/core/types";
import { DesignSystemBox, DesignSystemDialog } from "@/components/mockup-feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const WIDTHS = { desktop: 1440, tablet: 834, phone: 390 } as const;
export type Width = keyof typeof WIDTHS;
export const WIDTH_LABEL: Record<Width, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };

/** The direction an approval of this version records (the same words as the app's owner approvals). */
export const directionOf = (m: DesignMockupDTO) => `Version ${m.n}: ${m.title} (round ${m.round})`;

function Pill({ active, className, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid",
        active ? "bg-inverse text-on-inverse" : "bg-surface text-ink-secondary hover:bg-surface-raised",
        className,
      )}
      {...props}
    />
  );
}

const REDUCE = "(prefers-reduced-motion: reduce)";
/** The browser's own reduced-motion setting, live (null before hydration). Never overridden: mockups follow it. */
export function useReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(REDUCE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia(REDUCE).matches,
    () => null,
  );
}

/**
 * A mockup at a device width, scaled down to fit the column (never up), about 80% of the window tall and scrolling
 * inside. It is served sandboxed: no scripts, no other hosts, no access to the app.
 */
function Frame({ mockup, width, run }: { mockup: DesignMockupDTO; width: Width; run: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const device = WIDTHS[width];
  const scale = avail ? Math.min(1, avail / device) : 1;
  return (
    <div ref={box} className="h-[80vh] overflow-hidden rounded-[14px] bg-surface">
      {avail > 0 && (
        <iframe
          // a new key loads a fresh document: Replay restarts its motion with nothing left from the last run
          key={`${mockup.id}:${run}`}
          src={`/api/design/mockups/${mockup.id}`}
          title={`Version ${mockup.n}: ${mockup.title}`}
          sandbox=""
          referrerPolicy="no-referrer"
          className="mx-auto block origin-top-left border-0 bg-white"
          style={{
            width: device,
            height: `calc(80vh / ${scale})`,
            transform: `scale(${scale})`,
            marginLeft: scale < 1 ? 0 : undefined,
          }}
        />
      )}
    </div>
  );
}

/** Approve one version with an optional note for the build. The dialog keeps a stray click from approving. */
export function ApproveDialog({
  mockup,
  sessionId,
  open,
  onOpenChange,
  initialNote = "",
  round,
  project,
}: {
  mockup: DesignMockupDTO;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The note written when the version was chosen in the preview. */
  initialNote?: string;
  /** The version's round: when it proposes a DESIGN.md change, approving also writes that change into the project. */
  round?: DesignRoundDTO;
  /** The target project, to name where the change is written. */
  project?: string;
}) {
  const [viewChange, setViewChange] = useState(false);
  const qc = useQueryClient();
  const [note, setNote] = useState(initialNote);
  const [lastInitial, setLastInitial] = useState(initialNote);
  if (initialNote !== lastInitial) {
    setLastInitial(initialNote);
    setNote(initialNote);
  }
  const [passphrase, setPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  // A single-use challenge for this version and digest, fetched fresh for every attempt: `null` while loading, `false`
  // when no owner passphrase is set yet.
  const [attempt, setAttempt] = useState(0);
  const prepared = useQuery({
    queryKey: ["approval-challenge", mockup.id, mockup.digest, attempt],
    queryFn: () =>
      api<{ ready: boolean; challenge?: string }>(
        `/api/design/mockups/${mockup.id}/approval-challenge?session=${sessionId}&digest=${mockup.digest}`,
      ),
    enabled: open,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const challenge = prepared.data ? (prepared.data.ready && prepared.data.challenge) || false : null;
  const approve = async () => {
    if (!challenge) return;
    setSaving(true);
    try {
      const s = await api<DesignSessionDetailDTO>(`/api/design/mockups/${mockup.id}/approve`, {
        method: "POST",
        // the digest of the copy this page shows, the session and a single-use challenge: the approval is bound to
        // exactly that content, and only the owner passphrase makes it the owner's
        json: { note, digest: mockup.digest, sessionId, challenge, passphrase },
      });
      qc.setQueryData(["design-session", sessionId], s);
      await qc.invalidateQueries({ queryKey: ["design-sessions"] });
      await api(`/api/design/sessions/${sessionId}/preview`, { method: "DELETE" }).catch(() => {});
      onOpenChange(false);
      setNote("");
      setPassphrase("");
      toast.success(`Approved version ${mockup.n}`, {
        description: "A Claude Code session waiting on this starts building it.",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve this version");
      setAttempt((a) => a + 1); // each challenge works once
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (saving) return;
        if (!o) setAttempt((a) => a + 1);
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        // the dialog has no Radix trigger: focus goes back to the button, or to the chosen version once it is approved
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          (
            document.querySelector<HTMLElement>("[data-approve-trigger]") ??
            document.querySelector<HTMLElement>("[role=tab][aria-selected=true]")
          )?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Approve version {mockup.n}, “{mockup.title}”?
          </DialogTitle>
          <DialogDescription>
            Claude builds this version, exactly as shown (digest{" "}
            <span className="font-mono">{mockup.digest.slice(0, 12)}</span>). Add what it should change or keep from the
            others; the note is kept word for word.
          </DialogDescription>
        </DialogHeader>
        {round?.designSystemChange && (
          <p className="rounded-xl bg-surface-raised px-3 py-2.5 text-[13px] text-ink-secondary">
            Approving also writes this round&rsquo;s DESIGN.md change into {project || "the project"}:{" "}
            <span className="text-ink">{round.designSystemChange.summary}</span>.{" "}
            <button
              type="button"
              onClick={() => setViewChange(true)}
              className="font-medium text-accent-text outline-none hover:underline focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
            >
              View change
            </button>
            <DesignSystemDialog round={round} open={viewChange} onOpenChange={setViewChange} />
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="approve-note">Note for the build (optional)</Label>
          <Textarea
            id="approve-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={5000}
            rows={4}
            placeholder="Keep the table from version 2."
          />
        </div>
        {prepared.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {prepared.error.message}
          </p>
        ) : challenge === false ? (
          <p role="alert" className="text-[13px] text-ink-muted">
            Approving needs your owner passphrase, so that only you can approve, never an agent. Set it once in a
            terminal in the PIVOT folder: <span className="font-mono text-ink">pnpm owner:passphrase</span>, then open
            this dialog again.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="approve-passphrase">Owner passphrase</Label>
            <Input
              id="approve-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passphrase && !saving && void approve()}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !challenge || !passphrase} onClick={approve}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Which round and version are shown, the approval state, the interactive preview window and its pending pick, and the
 * version keys (1–9, ←/→): shared by the session page's Mockups section and the full-screen view.
 */
export function useMockupNav(s: DesignSessionDetailDTO, asked: { round?: number; n?: number } = {}) {
  const rounds = [...new Set(s.mockups.map((m) => m.round))].sort((a, b) => a - b);
  const latest = rounds.at(-1) ?? 0;
  const askedRound = asked.round !== undefined && rounds.includes(asked.round) ? asked.round : undefined;
  const approvals = s.decisions.filter((d) => d.kind === "approval");
  // the approval that counts now: none after a reopen or a major change, even if older ones exist
  const lastApproval = approvals.find((d) => d.id === s.currentApprovalId);
  // an approval names its version by id and digest; older ones only by their direction's words
  const isApproved = (m: DesignMockupDTO) =>
    lastApproval?.binding ? lastApproval.binding.mockupId === m.id : lastApproval?.direction === directionOf(m);
  // after an approval the page opens on the approved version; `?round=` still picks a round
  const approvedMockup = s.status !== "exploring" ? s.mockups.find(isApproved) : undefined;
  const [round, setRound] = useState(askedRound ?? approvedMockup?.round ?? latest);
  const [n, setN] = useState(askedRound !== undefined ? (asked.n ?? 1) : approvedMockup ? approvedMockup.n : 1);
  const [approving, setApproving] = useState(false);
  const qc = useQueryClient();
  const canApprove = s.status === "exploring";

  // The interactive preview window PIVOT opens for this session, and the version chosen there, if any.
  const preview = useQuery({
    queryKey: ["design-preview", s.id],
    queryFn: () => api<PreviewState>(`/api/design/sessions/${s.id}/preview`),
    refetchInterval: (q) => (q.state.data?.open || canApprove ? 2000 : false),
  });
  const pick = canApprove ? (preview.data?.pick ?? null) : null;
  const [opening, setOpening] = useState(false);
  const openPreview = async () => {
    setOpening(true);
    try {
      const st = await api<PreviewState>(`/api/design/sessions/${s.id}/preview`, { method: "POST", json: { round } });
      qc.setQueryData(["design-preview", s.id], st);
      if (st.error) toast.error(st.error);
      else toast.success("The interactive preview opened in its own window.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the preview");
    } finally {
      setOpening(false);
    }
  };
  const dismissPick = async () => {
    const st = await api<PreviewState>(`/api/design/sessions/${s.id}/preview`, { method: "DELETE" });
    qc.setQueryData(["design-preview", s.id], st);
  };
  // A version chosen in the preview: show it here and open its approval once.
  const [handledPick, setHandledPick] = useState<string | null>(null);
  if (pick && pick.at !== handledPick) {
    setHandledPick(pick.at);
    setRound(pick.round);
    setN(pick.n);
    setApproving(true);
  }

  // a new round arriving (the page refreshes while exploring) opens on its first version
  const seen = useRef(latest);
  useEffect(() => {
    if (latest > seen.current) {
      seen.current = latest;
      setRound(latest);
      setN(1);
    }
  }, [latest]);

  const versions = s.mockups.filter((m) => m.round === round);
  const current = versions.find((m) => m.n === n) ?? versions[0];
  const interactiveCount = versions.filter((m) => m.interactive).length;
  // the "Interactive" chip only tells versions apart in a round that mixes static and interactive ones
  const mixed = interactiveCount > 0 && interactiveCount < versions.length;
  const brokenBinding = lastApproval?.binding && lastApproval.binding.status !== "bound" ? lastApproval.binding : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || approving) return;
      const t = e.target as HTMLElement | null;
      // other controls keep their own keys: fields, dialogs, menus, the round and width radios, history rows, links
      if (
        t?.closest(
          "input, textarea, select, [contenteditable], [role=dialog], [role=menu], [role=radiogroup], summary, a, button:not([role=tab])",
        )
      )
        return;
      const count = versions.length;
      let next: number | null = null;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) next = Number(e.key);
      else if (e.key === "ArrowRight" && count > 1) next = (n % count) + 1;
      else if (e.key === "ArrowLeft" && count > 1) next = ((n + count - 2) % count) + 1;
      if (next === null) return;
      e.preventDefault();
      setN(next);
      // focus follows the selection when it was on a version tab (roving tabindex)
      if (t?.getAttribute("role") === "tab")
        requestAnimationFrame(() => document.getElementById(`version-tab-${next}`)?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [versions.length, approving, n]);

  /** The next or previous version in the round, wrapping around. */
  const step = (by: 1 | -1) => {
    const count = versions.length;
    if (count > 1) setN(((n - 1 + by + count) % count) + 1);
  };

  return {
    rounds,
    latest,
    round,
    setRound,
    n,
    setN,
    step,
    versions,
    current,
    isApproved,
    canApprove,
    approving,
    setApproving,
    preview,
    pick,
    opening,
    openPreview,
    dismissPick,
    interactiveCount,
    mixed,
    brokenBinding,
  };
}

/**
 * The session's mockup rounds: version tabs (1–9, ←/→), a width switch, the sandboxed mockup, "Open alone", "Open full
 * screen", and while the session is exploring, "Approve this version". The latest round shows first; `?round=` picks
 * another.
 */
export function DesignMockups({ session: s }: { session: DesignSessionDetailDTO }) {
  const asked = Number(useSearchParams().get("round"));
  const nav = useMockupNav(s, { round: asked || undefined });
  const {
    rounds,
    latest,
    round,
    setRound,
    setN,
    versions,
    current,
    isApproved,
    canApprove,
    approving,
    setApproving,
    preview,
    pick,
    opening,
    openPreview,
    dismissPick,
    interactiveCount,
    mixed,
    brokenBinding,
  } = nav;
  const [aboutMotion, setAboutMotion] = useState(false);
  const [width, setWidth] = useState<Width>("desktop");
  const [run, setRun] = useState(0);
  const reduce = useReducedMotion();

  if (!current) return null;

  return (
    <section aria-labelledby="mockups-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="mockups-title" className="text-xl font-medium tracking-[-0.02em]">
          Mockups
        </h2>
        <p className="text-sm text-ink-muted">
          Round {round} · {versions.length} version{versions.length === 1 ? "" : "s"}
          {(() => {
            const answers = s.rounds?.find((r) => r.round === round)?.addressesFeedback.length ?? 0;
            return answers ? ` · answers ${answers} feedback` : "";
          })()}
        </p>
      </div>

      {rounds.length > 1 && (
        <div role="radiogroup" aria-label="Round" className="flex flex-wrap gap-1.5">
          {rounds.map((r) => (
            <Pill
              key={r}
              role="radio"
              aria-checked={r === round}
              active={r === round}
              onClick={() => {
                setRound(r);
                setN(1);
              }}
            >
              Round {r}
              {r === latest && <span className="opacity-70">latest</span>}
            </Pill>
          ))}
        </div>
      )}

      <div role="tablist" aria-label="Versions" className="flex gap-1.5 overflow-x-auto pb-1">
        {versions.map((m) => {
          const approved = isApproved(m);
          return (
            <Pill
              key={m.id}
              role="tab"
              id={`version-tab-${m.n}`}
              aria-selected={m.id === current.id}
              aria-controls="mockup-panel"
              aria-keyshortcuts={m.n <= 9 ? String(m.n) : undefined}
              tabIndex={m.id === current.id ? 0 : -1}
              active={m.id === current.id}
              onClick={() => setN(m.n)}
            >
              <span className="font-mono tabular-nums opacity-70">{m.n}</span>
              {m.title}
              {mixed && m.interactive && (
                <span className="rounded-full bg-surface-raised px-1.5 text-[12px] text-ink-secondary">
                  Interactive
                </span>
              )}
              {approved && (
                <span className="flex items-center gap-1 rounded-full bg-success px-1.5 text-[12px] text-on-inverse">
                  <Check className="size-3" aria-hidden /> Approved
                </span>
              )}
            </Pill>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Width" className="flex gap-1.5">
          {(Object.keys(WIDTHS) as Width[]).map((w) => (
            <Pill key={w} role="radio" aria-checked={w === width} active={w === width} onClick={() => setWidth(w)}>
              {WIDTH_LABEL[w]}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setRun((r) => r + 1)}>
            <RotateCcw /> Replay
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={`/api/design/mockups/${current.id}`} target="_blank" rel="noopener noreferrer">
              Open alone <ExternalLink />
            </a>
          </Button>
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/design/${s.id}/mockups?round=${round}&v=${current.n}`}>
              <Maximize2 /> Open full screen
            </Link>
          </Button>
          <Button size="sm" variant="secondary" disabled={opening} onClick={openPreview}>
            {opening ? <Loader2 className="animate-spin" /> : <AppWindow />}
            {preview.data?.open && preview.data.round === round ? "Preview open" : "Open interactive preview"}
          </Button>
          {canApprove && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse"
              data-approve-trigger
              onClick={() => setApproving(true)}
            >
              <Check /> Approve this version
            </Button>
          )}
        </div>
      </div>

      {canApprove && (
        <DesignSystemBox round={s.rounds?.find((r) => r.round === round)} id="design-system-change-page" />
      )}
      {brokenBinding && (
        <p role="alert" className="text-[13px] text-danger">
          The approved version{" "}
          {brokenBinding.status === "missing" ? "is no longer stored" : "changed since it was approved"}: it can’t be
          built until a version is approved again.
        </p>
      )}

      {pick && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface px-4 py-3 text-sm">
          <span className="text-ink">
            You chose version {pick.n}, “{pick.title}”, in the preview.
          </span>
          <span className="ml-auto flex gap-1.5">
            <Button
              size="sm"
              className="rounded-full bg-inverse text-on-inverse hover:bg-inverse/90"
              onClick={() => {
                setRound(pick.round);
                setN(pick.n);
                setApproving(true);
              }}
            >
              <Check /> Approve it…
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissPick} aria-label="Dismiss the choice">
              <X />
            </Button>
          </span>
        </div>
      )}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-[13px] text-ink-muted">
          {interactiveCount === versions.length
            ? `${versions.length === 1 ? "This version is" : "All versions are"} interactive: ${versions.length === 1 ? "its" : "their"} motion runs in the interactive preview.`
            : current.interactive
              ? "Interactive version: its motion runs in the interactive preview."
              : "Motion follows your browser’s setting."}
          <button
            type="button"
            aria-label="About motion and reduced motion"
            aria-expanded={aboutMotion}
            aria-controls="about-motion"
            onClick={() => setAboutMotion((o) => !o)}
            className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-surface text-ink-secondary outline-none hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </p>
        <p
          id="about-motion"
          hidden={!aboutMotion}
          className="max-w-xl rounded-xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-muted"
        >
          Motion follows your browser
          {reduce !== null && (
            <>
              , which has reduced motion <b className="font-medium text-ink">{reduce ? "on" : "off"}</b>
            </>
          )}
          . To preview the other setting, switch Reduce motion in your system settings, or use Motion: reduced in the
          interactive preview, then press Replay.
        </p>
      </div>
      <div id="mockup-panel" role="tabpanel" aria-label={`Version ${current.n}: ${current.title}`}>
        <Frame mockup={current} width={width} run={run} />
      </div>

      <ApproveDialog
        mockup={current}
        sessionId={s.id}
        open={approving}
        onOpenChange={setApproving}
        initialNote={pick && pick.mockupId === current.id ? pick.note : ""}
        round={s.rounds?.find((r) => r.round === round)}
        project={s.targetProject}
      />
    </section>
  );
}
