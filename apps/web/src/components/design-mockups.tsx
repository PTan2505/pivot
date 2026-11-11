"use client";

import { Check, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DesignMockupDTO, DesignSessionDetailDTO } from "@pivot/core/types";
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

const WIDTHS = { desktop: 1440, tablet: 834, phone: 390 } as const;
type Width = keyof typeof WIDTHS;
const WIDTH_LABEL: Record<Width, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };

/** The direction an approval of this version records (the same words as the app's owner approvals). */
const directionOf = (m: DesignMockupDTO) => `Version ${m.n}: ${m.title} (round ${m.round})`;

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
function useReducedMotion() {
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
function ApproveDialog({
  mockup,
  sessionId,
  open,
  onOpenChange,
}: {
  mockup: DesignMockupDTO;
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
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
 * The session's mockup rounds: version tabs (1–9, ←/→), a width switch, the sandboxed mockup, "Open alone", and while
 * the session is exploring, "Approve this version". The latest round shows first; `?round=` picks another.
 */
export function DesignMockups({ session: s }: { session: DesignSessionDetailDTO }) {
  const rounds = [...new Set(s.mockups.map((m) => m.round))].sort((a, b) => a - b);
  const latest = rounds.at(-1) ?? 0;
  const asked = Number(useSearchParams().get("round"));
  const [round, setRound] = useState(rounds.includes(asked) ? asked : latest);
  const [n, setN] = useState(1);
  const [width, setWidth] = useState<Width>("desktop");
  const [approving, setApproving] = useState(false);
  const [run, setRun] = useState(0);
  const reduce = useReducedMotion();

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
  const approvals = s.decisions.filter((d) => d.kind === "approval");
  // the approval that counts now: none after a reopen or a major change, even if older ones exist
  const lastApproval = approvals.find((d) => d.id === s.currentApprovalId);
  // an approval names its version by id and digest; older ones only by their direction's words
  const isApproved = (m: DesignMockupDTO) =>
    lastApproval?.binding ? lastApproval.binding.mockupId === m.id : lastApproval?.direction === directionOf(m);
  const brokenBinding = lastApproval?.binding && lastApproval.binding.status !== "bound" ? lastApproval.binding : null;
  const canApprove = s.status === "exploring";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || approving) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const count = versions.length;
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) setN(Number(e.key));
      else if (e.key === "ArrowRight" && count > 1) setN((x) => (x % count) + 1);
      else if (e.key === "ArrowLeft" && count > 1) setN((x) => ((x + count - 2) % count) + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [versions.length, approving]);

  if (!current) return null;

  return (
    <section aria-labelledby="mockups-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="mockups-title" className="text-xl font-medium tracking-[-0.02em]">
          Mockups
        </h2>
        <p className="text-sm text-ink-muted">
          Round {round} · {versions.length} version{versions.length === 1 ? "" : "s"}
          <span className="max-sm:hidden"> · 1–{versions.length} or ← → to switch</span>
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
              aria-selected={m.id === current.id}
              aria-controls="mockup-panel"
              active={m.id === current.id}
              onClick={() => setN(m.n)}
            >
              <span className="font-mono tabular-nums opacity-70">{m.n}</span>
              {m.title}
              {m.interactive && (
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

      {brokenBinding && (
        <p role="alert" className="text-[13px] text-danger">
          The approved version{" "}
          {brokenBinding.status === "missing" ? "is no longer stored" : "changed since it was approved"}: it can’t be
          built until a version is approved again.
        </p>
      )}

      {current.interactive && (
        <p className="text-[13px] text-ink-muted">
          <b className="font-medium text-ink">Interactive version.</b> Its scripts don’t run on this page, so its
          interactions and motion are missing here. Ask Claude to open the interactive preview: a separate browser
          window that runs this exact version (same digest) with no network and no access to PIVOT.
        </p>
      )}
      <div id="mockup-panel" role="tabpanel" aria-label={`Version ${current.n}: ${current.title}`}>
        <Frame mockup={current} width={width} run={run} />
      </div>
      <p className="text-[13px] text-ink-muted">
        Version {current.n} · digest <span className="font-mono">{current.digest.slice(0, 12)}</span>: an approval names
        this exact content.
      </p>
      {reduce !== null && (
        <p className="text-[13px] text-ink-muted" aria-live="polite">
          Motion follows your browser, which has reduced motion{" "}
          <b className="font-medium text-ink">{reduce ? "on" : "off"}</b>. To preview the other setting, switch Reduce
          motion in your system settings, or emulate it in DevTools › Rendering, then press Replay.
        </p>
      )}

      <ApproveDialog mockup={current} sessionId={s.id} open={approving} onOpenChange={setApproving} />
    </section>
  );
}
