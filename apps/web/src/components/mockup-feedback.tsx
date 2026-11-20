"use client";

import { ChevronDown, Eye, FileText, Loader2, MapPin, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DesignMockupDTO, DesignRoundDTO, DesignSessionDetailDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The owner's feedback on a mockup round (docs/mockup-feedback-plan.md, Phase 3): pins on a version's full-page render,
 * a Feedback section in the full-screen drawer, and the DESIGN.md change a round proposes, shown beside Approve.
 */

export interface DraftPin {
  /** Stable inside a draft (gaps allowed): the feedback's text may say "pin 2". */
  n: number;
  x: number;
  y: number;
  text: string;
}

export interface FeedbackDraft {
  scope: "version" | "round";
  text: string;
  /** The render width the pins sit on (pins belong to one version and one width). */
  width: number | null;
  pins: DraftPin[];
}

const EMPTY: FeedbackDraft = { scope: "version", text: "", width: null, pins: [] };
export const hasContent = (d: FeedbackDraft) => !!d.text.trim() || d.pins.some((p) => p.text.trim());

/** Drafts by version, kept for this browser tab (sessionStorage) across version switches and reloads. */
export function useFeedbackDrafts(sessionId: string) {
  const key = `pivot.feedback.${sessionId}`;
  const [drafts, setDrafts] = useState<Record<string, FeedbackDraft>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, FeedbackDraft>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(drafts));
    } catch {
      /* private window: the draft lasts this page only */
    }
  }, [key, drafts]);
  // leaving with unsent feedback asks first
  useEffect(() => {
    const unsent = Object.values(drafts).some(hasContent);
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  const get = (mockupId: string) => drafts[mockupId] ?? EMPTY;
  const update = (mockupId: string, fn: (d: FeedbackDraft) => FeedbackDraft) =>
    setDrafts((all) => ({ ...all, [mockupId]: fn(all[mockupId] ?? EMPTY) }));
  const clear = (mockupId: string) =>
    setDrafts((all) => {
      const next = { ...all };
      delete next[mockupId];
      return next;
    });
  return { get, update, clear };
}

const NUDGE = 8;

/**
 * Pin mode: the version's full-page render at `renderWidth`, scaled to the space left (never up), scrolling like the
 * site; a click drops a numbered pin there and opens its note. Pins are buttons: Tab between them, arrows move the
 * focused one (Shift for 40px), Delete removes it, Enter opens its note. Esc closes the note, then leaves the mode.
 */
export function PinLayer({
  mockup,
  renderWidth,
  inset,
  draft,
  onChange,
  onExit,
  focusPin,
  reduce,
  barOnTop = false,
}: {
  mockup: DesignMockupDTO;
  renderWidth: number;
  /** Space on the right the drawer covers, so no pin hides under it. */
  inset: number;
  draft: FeedbackDraft;
  onChange: (fn: (d: FeedbackDraft) => FeedbackDraft) => void;
  onExit: () => void;
  /** A pin to scroll to and open (from the drawer's Show). */
  focusPin: number | null;
  reduce: boolean | null;
  /** The quick bar sits at the top edge: the banner goes below it. */
  barOnTop?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [loaded, setLoaded] = useState<{ src: string; h: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const src = `/api/design/mockups/${mockup.id}/render?width=${renderWidth}`;
  // pins placed at another width aren't shown on this render
  const pins = draft.width === null || draft.width === renderWidth ? draft.pins : [];
  const other = draft.pins.length > 0 && draft.width !== null && draft.width !== renderWidth;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = avail ? Math.min(1, (avail - 32) / renderWidth) : 1;

  // the render is decoded before it shows, so the swap never flashes blank
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img
      .decode()
      .then(() => !cancelled && setLoaded({ src, h: img.naturalHeight }))
      .catch(() => !cancelled && setLoaded({ src, h: 0 }));
    return () => {
      cancelled = true;
    };
  }, [src]);
  const ready = loaded?.src === src;

  const nextN = () => Math.max(0, ...draft.pins.map((p) => p.n)) + 1;
  const addAt = (x: number, y: number) => {
    // a draft's pins sit on one render width: never drop them for a pin at another
    if (other) {
      toast(`This draft's pins are on the ${draft.width}px render`, {
        description: "Switch back to that width to add more, or send them first.",
      });
      return;
    }
    const n = nextN();
    onChange((d) => ({
      ...d,
      width: renderWidth,
      pins: [...d.pins, { n, x: Math.round(x), y: Math.round(y), text: "" }],
    }));
    // its note opens with the focus, ready for typing; Esc then returns the focus to the pin
    setOpen(n);
  };
  const move = (n: number, x: number, y: number) =>
    onChange((d) => ({
      ...d,
      pins: d.pins.map((p) =>
        p.n === n
          ? {
              ...p,
              x: Math.round(Math.max(0, Math.min(renderWidth, x))),
              y: Math.round(Math.max(0, Math.min(loaded?.h || 12000, y))),
            }
          : p,
      ),
    }));
  const remove = (n: number) => {
    const before = draft;
    const rest = pins.filter((p) => p.n !== n);
    const next = rest.find((p) => p.n > n) ?? rest.at(-1);
    onChange((d) => ({ ...d, pins: d.pins.filter((p) => p.n !== n) }));
    setOpen(null);
    requestAnimationFrame(() =>
      (next ? document.getElementById(`pin-${next.n}`) : document.getElementById("pin-mode-button"))?.focus(),
    );
    toast(`Pin ${n} removed`, { action: { label: "Undo", onClick: () => onChange(() => before) } });
  };
  const setText = (n: number, text: string) =>
    onChange((d) => ({ ...d, pins: d.pins.map((p) => (p.n === n ? { ...p, text } : p)) }));

  // Show from the drawer: scroll to the pin, focus it and open its note
  useEffect(() => {
    if (focusPin === null || !ready) return;
    const p = draft.pins.find((x) => x.n === focusPin);
    if (!p) return;
    scroller.current?.scrollTo({ top: Math.max(0, p.y * scale - 200), behavior: "instant" });
    // the note opens with the focus (its field is autofocused); Esc returns it to the pin
    const raf = requestAnimationFrame(() => setOpen(focusPin));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when asked to show a pin
  }, [focusPin, ready]);

  // Esc in layers: the open note first, then the mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("[role=dialog]")) return;
      e.preventDefault();
      if (open !== null) {
        const n = open;
        setOpen(null);
        document.getElementById(`pin-${n}`)?.focus();
      } else onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // dragging a pin, past a few pixels so a click stays a click
  const drag = useRef<{ n: number; sx: number; sy: number; moved: boolean } | null>(null);
  const onPinDown = (e: React.PointerEvent, n: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { n, sx: e.clientX, sy: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPinMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    move(d.n, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale);
  };
  /** Set when a pointer gesture just moved a pin, so the click that ends it doesn't open the note. */
  const dragged = useRef(false);
  const onPinUp = () => {
    dragged.current = !!drag.current?.moved;
    drag.current = null;
  };
  const onPinKey = (e: React.KeyboardEvent, p: DraftPin) => {
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      move(p.n, p.x + moves[e.key][0], p.y + moves[e.key][1]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(p.n);
    }
  };

  const openPin = pins.find((p) => p.n === open);
  return (
    <div
      ref={scroller}
      className="fixed inset-y-0 left-0 z-20 [scroll-padding-block:96px] overflow-y-auto bg-canvas"
      style={{ right: inset }}
    >
      <div
        className={cn(
          "glass-strong sticky z-30 mx-auto mt-3 flex w-max max-w-[calc(100%-24px)] flex-wrap items-center gap-2.5 rounded-full py-1 pr-1 pl-4 text-[13px] text-ink",
          barOnTop ? "top-[76px]" : "top-3",
        )}
      >
        <span role="status" className="flex items-center gap-2.5">
          <b className="font-medium">Pin mode</b>
          <span className="text-ink-muted max-sm:hidden">Click the page to pin a note · Esc to leave</span>
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            // the centre of what is in view, in the render's own pixels
            const el = scroller.current;
            const top = page.current?.offsetTop ?? 0;
            const y = ((el?.scrollTop ?? 0) + (el?.clientHeight ?? 800) / 2 - top) / scale;
            addAt(renderWidth / 2, Math.max(0, Math.min(loaded?.h || y, y)));
          }}
        >
          <Plus /> Add pin at centre
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="bg-inverse text-on-inverse hover:bg-inverse/90"
          onClick={onExit}
        >
          Done
        </Button>
      </div>
      {other && (
        <p className="mx-auto mt-2 w-max rounded-full bg-surface px-3 py-1 text-[13px] text-ink-muted">
          This draft&rsquo;s pins are on the {draft.width}px render: switch to that width to see them.
        </p>
      )}
      {ready && loaded?.h === 0 && (
        <p role="alert" className="mx-auto mt-8 max-w-md text-center text-[14px] text-ink-muted">
          PIVOT couldn&rsquo;t make the picture of this version to pin on. Leave pin mode and write your feedback as
          text, or try again.
        </p>
      )}
      <div
        ref={page}
        className={cn(
          "relative mx-auto my-4 cursor-crosshair bg-white transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          ready && loaded?.h ? "opacity-100" : "opacity-0",
          reduce && "transition-none",
        )}
        style={{ width: renderWidth * scale, height: (loaded?.h || 900) * scale }}
        onClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.render) return;
          const box = e.currentTarget.getBoundingClientRect();
          addAt((e.clientX - box.left) / scale, (e.clientY - box.top) / scale);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- PIVOT's own render, sized by the page */}
        <img
          data-render="1"
          src={src}
          alt={`Version ${mockup.n}: ${mockup.title}, full page at ${renderWidth}px`}
          width={renderWidth * scale}
          className="block select-none"
          draggable={false}
        />
        {pins.map((p) => (
          <button
            key={p.n}
            id={`pin-${p.n}`}
            type="button"
            aria-label={`Pin ${p.n}${p.text ? `: ${p.text.slice(0, 60)}` : ", no note yet"}`}
            aria-expanded={open === p.n}
            aria-controls={open === p.n ? `pin-note-${p.n}` : undefined}
            onPointerDown={(e) => onPinDown(e, p.n)}
            onPointerMove={onPinMove}
            onPointerUp={onPinUp}
            onPointerCancel={onPinUp}
            onLostPointerCapture={onPinUp}
            onKeyDown={(e) => onPinKey(e, p)}
            onClick={(e) => {
              e.stopPropagation();
              // a click, Enter or Space opens the note; the end of a drag doesn't
              if (dragged.current) dragged.current = false;
              else setOpen((o) => (o === p.n ? null : p.n));
            }}
            className="absolute -mt-3.5 -ml-3.5 grid size-7 touch-none place-items-center rounded-full bg-inverse font-mono text-[13px] font-medium text-on-inverse shadow-[0_0_0_2px_var(--canvas),0_24px_64px_rgb(0_0_0/0.6),0_2px_8px_rgb(0_0_0/0.35)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid motion-safe:animate-[pin-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
            style={{ left: p.x * scale, top: p.y * scale }}
          >
            {p.n}
          </button>
        ))}
        {openPin && (
          <div
            className="glass-strong absolute z-10 origin-top-left rounded-[14px] p-3 text-[13px] text-ink motion-safe:animate-[pop-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
            style={{
              width: Math.min(288, renderWidth * scale - 16),
              left: Math.max(
                8,
                Math.min(openPin.x * scale + 18, renderWidth * scale - Math.min(288, renderWidth * scale - 16) - 8),
              ),
              top: openPin.y * scale + 18,
            }}
          >
            <label htmlFor={`pin-note-${openPin.n}`} className="mb-1.5 block text-[12px] text-ink-muted">
              Note for pin {openPin.n}
            </label>
            <textarea
              id={`pin-note-${openPin.n}`}
              autoFocus
              rows={3}
              maxLength={1000}
              value={openPin.text}
              onChange={(e) => setText(openPin.n, e.target.value)}
              placeholder="What should change here?"
              className="w-full resize-none rounded-xl bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
            />
            <div className="mt-2 flex items-center justify-between text-[12px] text-ink-muted">
              <span>Saved in your draft</span>
              <Button size="xs" variant="ghost" onClick={() => remove(openPin.n)}>
                <Trash2 /> Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The drawer's Feedback section: scope, text, the pins, Send to Claude, and this round's earlier feedback. */
export function FeedbackSection({
  session: s,
  round,
  mockup,
  draft,
  onChange,
  onSent,
  phone,
  pinMode,
  onPinMode,
  onShowPin,
  onOpenRound,
}: {
  session: DesignSessionDetailDTO;
  round: number;
  mockup: DesignMockupDTO;
  draft: FeedbackDraft;
  onChange: (fn: (d: FeedbackDraft) => FeedbackDraft) => void;
  onSent: () => void;
  phone: boolean;
  pinMode: boolean;
  onPinMode: () => void;
  onShowPin: (n: number) => void;
  /** Opens the round that answered a piece of feedback. */
  onOpenRound: (round: number) => void;
}) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const exploring = s.status === "exploring";
  const pins = draft.pins;
  const canSend = exploring && hasContent(draft) && !sending;
  const past = (s.feedback ?? []).filter((f) => f.round === round).reverse();
  const widthLabel = (w: number | null) => (w === 1440 ? "Desktop" : w === 834 ? "Tablet" : w === 390 ? "Phone" : "");

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const url = `/api/design/sessions/${s.id}/feedback`;
      const text = draft.text.trim();
      const withPins = draft.pins;
      // pins belong to this version; text for the whole round goes as its own feedback (and once sent, leaves the
      // draft, so trying again after a failure doesn't send it twice)
      if (draft.scope === "round" && text) {
        await api(url, { method: "POST", json: { round, mockupId: null, text } });
        onChange((d) => ({ ...d, text: "" }));
      }
      if (withPins.length || draft.scope === "version")
        await api(url, {
          method: "POST",
          json: {
            round,
            mockupId: mockup.id,
            text: draft.scope === "version" ? text : "",
            width: withPins.length ? draft.width : null,
            // each pin keeps its number, so "pin 3" in the text still names it
            pins: withPins.map(({ n, x, y, text: t }) => ({ n, x, y, text: t.trim() })),
          },
        });
      await qc.invalidateQueries({ queryKey: ["design-session", s.id] });
      setSent(true);
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the feedback");
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="stage-feedback">
      <h3 id="stage-feedback" className="mb-2 text-[12px] font-medium tracking-[0.02em] text-ink-muted uppercase">
        Feedback
        {pinMode && <span className="ml-1 font-normal tracking-normal normal-case">· pinning</span>}
      </h3>
      {!exploring ? (
        <p className="text-[13px] text-ink-muted">Feedback asks for a new round, while the session is exploring.</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Feedback for" className="flex flex-wrap gap-1.5">
            {(["version", "round"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={draft.scope === scope}
                onClick={() => onChange((d) => ({ ...d, scope }))}
                className={cn(
                  "flex h-8 items-center rounded-full px-3 text-[13px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid [@media(pointer:coarse)]:h-11",
                  draft.scope === scope
                    ? "bg-inverse text-on-inverse"
                    : "bg-surface text-ink-secondary hover:bg-surface-raised",
                )}
              >
                {scope === "version" ? `This version (${mockup.n})` : "Whole round"}
              </button>
            ))}
          </div>
          <label htmlFor="feedback-text" className="sr-only">
            What should change?
          </label>
          <textarea
            id="feedback-text"
            rows={3}
            maxLength={5000}
            value={draft.text}
            onChange={(e) => {
              setSent(false);
              onChange((d) => ({ ...d, text: e.target.value }));
            }}
            placeholder="What should change?"
            aria-describedby="feedback-help"
            className="mt-2.5 w-full resize-y rounded-[14px] bg-surface px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid max-sm:text-[16px]"
          />
          <p id="feedback-help" className="mt-1 text-[12px] text-ink-muted">
            Claude answers with a new round.
          </p>
          {pins.length > 0 ? (
            <ol aria-label="Pins" className="mt-2.5 flex flex-col gap-0.5">
              {[...pins]
                .sort((a, b) => a.n - b.n)
                .map((p) => (
                  <li key={p.n} className="flex items-start gap-2.5 rounded-xl bg-surface py-2 pr-1.5 pl-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-inverse font-mono text-[12px] font-medium text-on-inverse">
                      {p.n}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-secondary">
                      <span className="line-clamp-2">{p.text || <i className="text-ink-muted">No note yet</i>}</span>
                      <small className="block text-[12px] text-ink-muted">
                        v{mockup.n} · {widthLabel(draft.width)}
                      </small>
                    </span>
                    {!phone && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Show pin ${p.n}`}
                        onClick={() => onShowPin(p.n)}
                      >
                        <Eye />
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete pin ${p.n}`}
                      onClick={() => {
                        onChange((d) => ({ ...d, pins: d.pins.filter((x) => x.n !== p.n) }));
                        requestAnimationFrame(() => document.getElementById("feedback-text")?.focus());
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
            </ol>
          ) : phone ? (
            <p className="mt-2 text-[12px] text-ink-muted">Pins need a wider screen.</p>
          ) : (
            <div className="mt-2.5 flex items-center gap-2 text-[12px] text-ink-muted">
              <Button size="sm" variant="secondary" onClick={onPinMode}>
                <MapPin /> Pin on the page
              </Button>
              or press P
            </div>
          )}
          <div role="status" className="mt-3 min-h-9">
            {sent && !hasContent(draft) ? (
              <p className="flex h-9 items-center gap-2 text-[13px] text-ink-secondary">
                <span aria-hidden className="size-2 rounded-full bg-ink-muted" /> Sent · waiting for Claude
              </p>
            ) : (
              <Button
                className="h-9 w-full bg-inverse text-on-inverse hover:bg-inverse/90"
                disabled={!canSend}
                onClick={send}
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />} Send to Claude
              </Button>
            )}
          </div>
        </>
      )}
      {past.length > 0 && (
        <div className="mt-3 border-t border-divider pt-2">
          <button
            type="button"
            aria-expanded={earlier}
            aria-controls="earlier-feedback"
            onClick={() => setEarlier((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg py-1 text-left text-[13px] text-ink-secondary outline-none focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
          >
            <span>
              Earlier feedback · {past.length}
              <span className="text-ink-muted"> ({past.filter((f) => f.status === "open").length} open)</span>
            </span>
            <ChevronDown className={cn("size-3.5 transition-transform", earlier && "rotate-180")} aria-hidden />
          </button>
          <ul id="earlier-feedback" hidden={!earlier} className="mt-1.5 space-y-1.5">
            {past.map((f) => (
              <li key={f.id} className="rounded-xl bg-surface px-3 py-2 text-[13px]">
                <span className="text-ink">{f.text || `${f.pins.length} pin${f.pins.length === 1 ? "" : "s"}`}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  {f.mockupId ? `Version ${s.mockups.find((m) => m.id === f.mockupId)?.n ?? "?"}` : "Whole round"}
                  {f.pins.length ? ` · ${f.pins.length} pin${f.pins.length === 1 ? "" : "s"}` : ""} ·{" "}
                  {f.status === "open" ? (
                    "Open"
                  ) : (
                    <button
                      type="button"
                      onClick={() => f.addressedRound && onOpenRound(f.addressedRound)}
                      className="text-accent-text outline-none hover:underline focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
                    >
                      Answered in round {f.addressedRound}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A proposed DESIGN.md change, shown above Approve: one approval also writes it into the project. */
export function DesignSystemBox({
  round,
  id = "design-system-change",
}: {
  round: DesignRoundDTO | undefined;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const change = round?.designSystemChange;
  if (!change) return null;
  return (
    <div id={id} className="rounded-xl bg-surface-raised px-3 py-2.5 text-[13px]">
      <p className="flex items-center gap-2 font-medium text-ink">
        <FileText className="size-3.5" aria-hidden /> Also updates DESIGN.md
      </p>
      <p className="mt-1 line-clamp-2 text-ink-secondary">{change.summary}</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 font-medium text-accent-text outline-none hover:underline focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
      >
        View change
      </button>
      <DesignSystemDialog round={round} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * Whether a proposed change is written as a diff (a `+` line, or a unified-diff header) rather than as the new text of
 * the sections it touches: in new text, a line starting with "-" is a Markdown list item, not a removal.
 */
export const isDiff = (markdown: string) => /^(\+(?!\+\+)|@@|\+\+\+ |--- )/m.test(markdown);

/** The change: as a diff, lines starting with + or − are tinted and keep their sign; as new text, plain. */
export function DesignSystemDialog({
  round,
  open,
  onOpenChange,
}: {
  round: DesignRoundDTO;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = round.designSystemChange;
  if (!change) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>DESIGN.md change in round {round.round}</DialogTitle>
          <DialogDescription>
            {change.summary.replace(/\.$/, "")}. Written into the project&rsquo;s DESIGN.md only when you approve a
            version of this round, exactly as shown (digest{" "}
            <span className="font-mono">{change.digest.slice(0, 12)}</span>).
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12px] text-ink-muted">
          {isDiff(change.markdown) ? "As a diff: + added, − removed." : "The new text of the sections it changes."}
        </p>
        <div className="max-h-[50vh] overflow-auto rounded-xl bg-surface py-2 font-mono text-[13px] leading-relaxed">
          {change.markdown.split("\n").map((line, i) => {
            const diff = isDiff(change.markdown);
            const add = diff && /^\+(?!\+\+)/.test(line);
            const del = diff && /^-(?!--)/.test(line);
            return (
              <div
                key={i}
                className={cn("flex px-3 whitespace-pre-wrap", add && "bg-success/12", del && "bg-danger/12")}
              >
                <span
                  aria-hidden
                  className={cn("w-5 shrink-0", add ? "text-success" : del ? "text-danger" : "text-ink-muted")}
                >
                  {add ? "+" : del ? "−" : " "}
                </span>
                <span className="sr-only">{add ? "added: " : del ? "removed: " : ""}</span>
                <span className="text-ink">{add || del ? line.slice(1) : line}</span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
