"use client";

import Link from "next/link";
import {
  AppWindow,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Loader2,
  MessageSquarePlus,
  PanelRight,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DesignMockupDTO, DesignSessionDetailDTO } from "@pivot/core/types";
import {
  ApproveDialog,
  useMockupNav,
  useReducedMotion,
  WIDTH_LABEL,
  WIDTHS,
  type Width,
} from "@/components/design-mockups";
import { DESIGN_STATUS_LABEL } from "@/components/design-session";
import {
  DesignSystemBox,
  FeedbackSection,
  PinLayer,
  useFeedbackDrafts,
  type CommentTool,
} from "@/components/mockup-feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The full-screen mockup view (`/design/[id]/mockups`): the mockup fills the window like the real site; a floating
 * quick bar switches versions and opens the controls drawer (rounds, width, tools, Approve). The drawer is non-modal:
 * the mockup stays usable beside it.
 */

const DRAWER_KEY = "pivot.mockups.drawer";
const BAR_KEY = "pivot.mockups.bar";
/** Comment mode's last tool (Select or Pin), so the mode opens on it. */
const TOOL_KEY = "pivot.feedback.tool";
type BarPlace = "bottom" | "top" | "dot";
const BAR_LABEL: Record<BarPlace, string> = { bottom: "Bottom", top: "Top", dot: "Dot" };
/** The drawer's width plus its 12px inset on both sides: the quick bar centres itself in what is left. */
const DRAWER_SPACE = 384;
const DRAG_THRESHOLD = 6;

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window: the choice lasts this visit only */
  }
}

const PHONE = "(max-width: 639px)";
function usePhone() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = matchMedia(PHONE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

/** A section heading inside the drawer. */
function Heading({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-2 text-[12px] font-medium tracking-[0.02em] text-ink-muted uppercase">
      {children}
    </h3>
  );
}

function Pill({ active, className, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid [@media(pointer:coarse)]:h-11",
        active ? "bg-inverse text-on-inverse" : "bg-surface text-ink-secondary hover:bg-surface-raised",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The mockup at the window's own size (Desktop) or at its device width, centred, full height (Tablet, Phone), scaled
 * down only when the window is narrower than the device. Served sandboxed: no scripts, no other hosts.
 */
function FullFrame({
  mockup,
  width,
  run,
  onScale,
}: {
  mockup: DesignMockupDTO;
  width: Width;
  run: number;
  onScale: (scale: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const device = width === "desktop" ? size.w : WIDTHS[width];
  const scale = size.w && device ? Math.min(1, size.w / device) : 1;
  useEffect(() => onScale(scale), [scale, onScale]);
  return (
    <div ref={box} className="fixed inset-0 overflow-hidden bg-canvas">
      {size.w > 0 && (
        <iframe
          // a new key loads a fresh document: Replay restarts its motion with nothing left from the last run
          key={`${mockup.id}:${run}`}
          src={`/api/design/mockups/${mockup.id}`}
          title={`Version ${mockup.n}: ${mockup.title}`}
          sandbox=""
          referrerPolicy="no-referrer"
          className="mx-auto block origin-top border-0 bg-white"
          style={{ width: device, height: size.h / scale, transform: scale < 1 ? `scale(${scale})` : undefined }}
        />
      )}
    </div>
  );
}

export function MockupStage({
  session: s,
  asked,
}: {
  session: DesignSessionDetailDTO;
  asked: { round?: number; n?: number };
}) {
  const nav = useMockupNav(s, asked);
  const {
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
  } = nav;
  const phone = usePhone();
  const reduce = useReducedMotion();
  const [width, setWidth] = useState<Width>("desktop");
  const [run, setRun] = useState(0);
  const [scale, setScale] = useState(1);
  const [aboutMotion, setAboutMotion] = useState(false);
  // The stage only renders in the browser (after the session loads), so the stored choices are read right away. First
  // visit: the drawer starts open, so the controls and Approve are found. The slide is switched on only after the first
  // frame, so a restored state never animates in.
  const [open, setOpen] = useState(() => stored(DRAWER_KEY) !== "closed");
  const [bar, setBar] = useState<BarPlace>(() => {
    const b = stored(BAR_KEY);
    return b === "top" || b === "dot" ? b : "bottom";
  });
  const [ready, setReady] = useState(false);
  // feedback: drafts by version, pin mode, and a pin the drawer asked to show
  const drafts = useFeedbackDrafts(s.id);
  const [pinMode, setPinMode] = useState(false);
  const [focusPin, setFocusPin] = useState<number | null>(null);
  const [tool, setToolState] = useState<CommentTool>(() => (stored(TOOL_KEY) === "pin" ? "pin" : "select"));
  const setTool = (t: CommentTool) => {
    setToolState(t);
    store(TOOL_KEY, t);
  };
  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  // Focus goes back to the toggle once the drawer has closed (on a phone the bar is hidden while the sheet is open).
  const focusToggle = useRef(false);
  const setDrawer = (next: boolean, { focus = true } = {}) => {
    setOpen(next);
    store(DRAWER_KEY, next ? "open" : "closed");
    if (!focus) return;
    if (next) requestAnimationFrame(() => document.getElementById(`version-tab-${n}`)?.focus());
    else focusToggle.current = true;
  };
  useEffect(() => {
    if (open || !focusToggle.current) return;
    focusToggle.current = false;
    toggle.current?.focus();
  }, [open]);
  const placeBar = (place: BarPlace) => {
    setBar(place);
    store(BAR_KEY, place);
  };

  // the address names the version, so a reload or a shared link opens it
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("round", String(round));
    url.searchParams.set("v", String(current?.n ?? n));
    history.replaceState(history.state, "", url);
  }, [round, n, current?.n]);

  // Keys typed in the mockup belong to the mockup: say so while it has focus, instead of forwarding them.
  const [frameFocused, setFrameFocused] = useState(false);
  useEffect(() => {
    const check = () => setFrameFocused(document.activeElement?.tagName === "IFRAME");
    const later = () => setTimeout(check, 0);
    window.addEventListener("blur", later);
    window.addEventListener("focus", check);
    document.addEventListener("focusin", check);
    return () => {
      window.removeEventListener("blur", later);
      window.removeEventListener("focus", check);
      document.removeEventListener("focusin", check);
    };
  }, []);

  // Esc closes the drawer (a dialog on top closes first, on its own)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open || approving || pinMode) return;
      if ((e.target as HTMLElement | null)?.closest("[role=dialog]")) return;
      e.preventDefault();
      setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // P opens comment mode, never while typing in a field (keys in the mockup's frame never reach the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== "p" && key !== "v") || e.metaKey || e.ctrlKey || e.altKey || approving) return;
      if (phone || s.status !== "exploring") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], [role=dialog]"))
        return;
      // inside the mode the layer handles V and P itself (it knows when Select can't work, and says so)
      if (pinMode || key !== "p") return;
      e.preventDefault();
      setFocusPin(null);
      setPinMode(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approving, phone, s.status, pinMode]);

  // Dragging the bar (past a few pixels, so a click stays a click) moves it to the top or bottom edge.
  const barBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const flipFrom = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag.current = { y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = barBox.current;
    if (!d || !el) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = barBox.current;
    drag.current = null;
    setDragging(false);
    if (!d?.moved || !el) return;
    const next: BarPlace = e.clientY < innerHeight / 2 ? "top" : "bottom";
    flipFrom.current = el.getBoundingClientRect().top;
    el.style.transform = "";
    if (next === bar) {
      // back to where it was: settle from the drop point
      settle(el);
      return;
    }
    placeBar(next);
  };
  const settle = (el: HTMLElement) => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (from === null) return;
    const delta = from - el.getBoundingClientRect().top;
    if (!delta || reduce) {
      el.style.transition = "";
      el.style.transform = "";
      return;
    }
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      el.style.transition = "transform 240ms cubic-bezier(0.23, 1, 0.32, 1)";
      el.style.transform = "";
    });
  };
  useLayoutEffect(() => {
    if (barBox.current && flipFrom.current !== null) settle(barBox.current);
  });

  if (!current) return null;
  const count = versions.length;
  const draft = drafts.get(current.id);
  const renderWidth = width === "desktop" ? WIDTHS.desktop : WIDTHS[width];
  const pinCount = draft.pins.length;
  const thisRound = s.rounds?.find((r) => r.round === round);
  const enterPins = (show: number | null = null) => {
    if (phone || s.status !== "exploring") return;
    setFocusPin(show);
    setPinMode(true);
  };
  const position = `Version ${current.n} of ${count}: ${current.title}`;
  // on a phone the sheet covers the bar's place: the bar hides (and leaves the tab order) while it is open
  const barHidden = phone && open;
  const dot = bar === "dot";
  // on a wide window the bar stays centred in the space left of the drawer
  const shift = open && !phone && !dot ? -DRAWER_SPACE / 2 : 0;

  const toggleButton = (
    <button
      ref={toggle}
      type="button"
      aria-label={dot ? `Preview controls, ${position}` : "Preview controls"}
      aria-expanded={open}
      aria-controls="mockup-controls"
      onClick={() => setDrawer(!open)}
      className={cn(
        "grid shrink-0 place-items-center rounded-full text-ink-secondary transition-[background-color,transform] duration-150 ease-out outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid active:scale-97 motion-reduce:active:scale-100",
        dot ? "relative size-11" : "size-9 [@media(pointer:coarse)]:size-11",
        open && !dot && "bg-surface-raised text-ink",
      )}
    >
      {dot ? (
        <>
          <span
            aria-hidden
            className="absolute inset-[3px] rounded-full [mask:radial-gradient(circle,transparent_17px,#000_17.5px)]"
            style={{
              background: `conic-gradient(var(--ink) ${(current.n / count) * 100}%, var(--glass-edge) 0)`,
            }}
          />
          <span aria-hidden className="relative font-mono text-[13px] text-ink tabular-nums">
            {current.n}
            <span className="text-[12px] text-ink-muted">/{count}</span>
          </span>
        </>
      ) : (
        <PanelRight className="size-4" aria-hidden />
      )}
    </button>
  );

  return (
    <div>
      {/* under the pin layer, the mockup's frame leaves the tab order */}
      <div inert={pinMode && !phone}>
        <FullFrame mockup={current} width={width} run={run} onScale={setScale} />
      </div>
      {pinMode && !phone && (
        <PinLayer
          // a new version or width starts a fresh layer: no hover, selection or note carried over
          key={`${current.id}:${renderWidth}`}
          mockup={current}
          renderWidth={renderWidth}
          // up to the drawer's left edge (its width and right inset), so nothing of the frame shows in between
          inset={open ? DRAWER_SPACE - 12 : 0}
          barOnTop={bar === "top"}
          draft={draft}
          onChange={(fn) => drafts.update(current.id, fn)}
          onExit={() => {
            setPinMode(false);
            setFocusPin(null);
            requestAnimationFrame(() => document.getElementById("pin-mode-button")?.focus());
          }}
          focusPin={focusPin}
          reduce={reduce}
          tool={tool}
          onTool={setTool}
        />
      )}

      {/* the quick bar comes right after the frame, so one Tab leaves the mockup */}
      <div
        inert={barHidden}
        className={cn(
          "fixed z-40",
          barHidden && "invisible",
          dot
            ? "right-[calc(16px+env(safe-area-inset-right))] bottom-[calc(16px+env(safe-area-inset-bottom))]"
            : cn(
                "left-1/2",
                bar === "top"
                  ? "top-[calc(16px+env(safe-area-inset-top))]"
                  : "bottom-[calc(16px+env(safe-area-inset-bottom))]",
              ),
          ready && "transition-transform duration-250 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
        )}
        style={dot ? undefined : { transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        <div
          ref={barBox}
          role="toolbar"
          aria-label="Versions"
          onPointerDown={dot ? undefined : onPointerDown}
          onPointerMove={dot ? undefined : onPointerMove}
          onPointerUp={dot ? undefined : onPointerUp}
          onPointerCancel={dot ? undefined : onPointerUp}
          onLostPointerCapture={dot ? undefined : onPointerUp}
          className={cn(
            // touch-none: a touch drag would otherwise pan the page and cancel the drag
            "glass-strong flex touch-none items-center rounded-full text-[13px]",
            dot ? "p-0" : "h-11 gap-0.5 px-1 [@media(pointer:coarse)]:h-13",
            !dot && (dragging ? "cursor-grabbing" : "cursor-grab"),
          )}
        >
          {!dot && (
            <>
              <button
                type="button"
                aria-label="Previous version"
                disabled={count < 2}
                onClick={() => step(-1)}
                className="grid size-9 place-items-center rounded-full text-ink-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid disabled:opacity-40 [@media(pointer:coarse)]:size-11"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span className="flex items-center gap-2 px-2 select-none" aria-live="polite">
                <span className="sr-only">{position}</span>
                <span aria-hidden className="font-mono text-ink-muted tabular-nums">
                  {current.n}/{count}
                </span>
                {!phone && (
                  <span aria-hidden className="max-w-[18rem] truncate font-medium text-ink">
                    {current.title}
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label="Next version"
                disabled={count < 2}
                onClick={() => step(1)}
                className="grid size-9 place-items-center rounded-full text-ink-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid disabled:opacity-40 [@media(pointer:coarse)]:size-11"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <span aria-hidden className="mx-1 h-5 w-px bg-divider" />
              {!phone && s.status === "exploring" && (
                <button
                  id="pin-mode-button"
                  type="button"
                  aria-pressed={pinMode}
                  aria-keyshortcuts="P"
                  aria-label={`Comment${pinCount ? `, ${pinCount} note${pinCount === 1 ? "" : "s"}` : ""}`}
                  onClick={() => (pinMode ? setPinMode(false) : enterPins())}
                  className={cn(
                    "flex h-9 items-center gap-1 rounded-full px-2.5 text-ink-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid [@media(pointer:coarse)]:h-11",
                    pinMode && "bg-inverse text-on-inverse hover:bg-inverse/90 hover:text-on-inverse",
                  )}
                >
                  <MessageSquarePlus className="size-4" aria-hidden />
                  {pinCount > 0 && <span className="font-mono text-[12px] tabular-nums">{pinCount}</span>}
                </button>
              )}
            </>
          )}
          {toggleButton}
        </div>
      </div>
      {/* while the bar is dragged, a shield keeps the pointer from disappearing into the mockup's frame */}
      {dragging && <div aria-hidden className="fixed inset-0 z-30 cursor-grabbing" />}

      <aside
        id="mockup-controls"
        ref={drawer}
        aria-labelledby="mockup-controls-title"
        data-state={open ? "open" : "closed"}
        inert={!open}
        className={cn(
          "glass-strong fixed z-50 flex flex-col text-[14px] text-ink",
          phone
            ? "inset-x-0 bottom-0 max-h-[75dvh] rounded-t-[24px] pb-[env(safe-area-inset-bottom)] data-[state=closed]:translate-y-[calc(100%+12px)]"
            : "top-3 right-3 bottom-3 w-[360px] rounded-[14px] data-[state=closed]:translate-x-[calc(100%+12px)]",
          "data-[state=closed]:invisible",
          // Tailwind's translate-* sets `translate`, so that is what moves; visible at once when it opens (so focus can
          // move in), hidden only once the 200ms exit has run
          ready &&
            "data-[state=closed]:[transition:translate_200ms_cubic-bezier(0.32,0.72,0,1),visibility_0s_200ms] data-[state=open]:[transition:translate_250ms_cubic-bezier(0.32,0.72,0,1),visibility_0s] motion-reduce:data-[state=closed]:[transition:none] motion-reduce:data-[state=open]:[transition:none]",
        )}
      >
        <div className="flex items-start gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <Button variant="ghost" size="sm" asChild className="mb-1 -ml-3 h-7">
              <Link href={`/design/${s.id}`}>
                <ArrowLeft /> Session
              </Link>
            </Button>
            <h2 id="mockup-controls-title" className="text-[15px] leading-snug font-medium">
              {s.title}
            </h2>
            <p className="text-[13px] text-ink-muted">
              Round {round} · {count} version{count === 1 ? "" : "s"} · {DESIGN_STATUS_LABEL[s.status]}
            </p>
          </div>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Close preview controls"
            onClick={() => setDrawer(false)}
            className="bg-surface-raised"
          >
            <X />
          </Button>
        </div>

        <div className="min-h-0 flex-1 [scroll-padding-bottom:16px] space-y-4 overflow-y-auto px-4 pt-2 pb-4">
          {rounds.length > 1 && (
            <section aria-labelledby="stage-round">
              <Heading id="stage-round">Round</Heading>
              <div role="radiogroup" aria-labelledby="stage-round" className="flex flex-wrap gap-1.5">
                {rounds.map((r) => (
                  <Pill
                    key={r}
                    role="radio"
                    aria-checked={r === round}
                    aria-label={r === latest ? `Round ${r}, latest` : `Round ${r}`}
                    active={r === round}
                    className="w-8 justify-center px-0 font-mono [@media(pointer:coarse)]:w-11"
                    onClick={() => {
                      setRound(r);
                      setN(1);
                    }}
                  >
                    {r}
                  </Pill>
                ))}
              </div>
            </section>
          )}

          <section aria-labelledby="stage-versions">
            <Heading id="stage-versions">
              Versions{" "}
              <span className="font-normal tracking-normal text-ink-subtle normal-case">
                · keys 1–{Math.min(count, 9)}, ← →
              </span>
            </Heading>
            <div
              role="tablist"
              aria-orientation="vertical"
              aria-labelledby="stage-versions"
              className="flex flex-col gap-0.5"
            >
              {versions.map((m) => {
                const selected = m.id === current.id;
                const approved = isApproved(m);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    id={`version-tab-${m.n}`}
                    aria-selected={selected}
                    aria-keyshortcuts={m.n <= 9 ? String(m.n) : undefined}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setN(m.n)}
                    className={cn(
                      "flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[14px] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid [@media(pointer:coarse)]:min-h-11",
                      selected ? "bg-inverse font-medium text-on-inverse" : "text-ink-secondary hover:bg-surface",
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 font-mono text-[12px] tabular-nums",
                        selected ? "opacity-60" : "text-ink-subtle",
                      )}
                    >
                      {m.n}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    {mixed && m.interactive && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 text-[12px] font-normal",
                          selected ? "bg-on-inverse/10" : "bg-surface-raised text-ink-secondary",
                        )}
                      >
                        Interactive
                      </span>
                    )}
                    {approved && (
                      <span className="flex items-center gap-1 rounded-full bg-success px-1.5 text-[12px] font-normal text-on-inverse">
                        <Check className="size-3" aria-hidden /> Approved
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {frameFocused && (
              <p role="status" className="mt-2 text-[13px] text-ink-muted">
                Shortcuts paused while the mockup has focus. Press Tab to leave it.
              </p>
            )}
          </section>

          <section aria-labelledby="stage-view">
            <Heading id="stage-view">View</Heading>
            <div role="radiogroup" aria-label="Width" className="flex flex-wrap gap-1.5">
              {(Object.keys(WIDTHS) as Width[]).map((w) => (
                <Pill key={w} role="radio" aria-checked={w === width} active={w === width} onClick={() => setWidth(w)}>
                  {WIDTH_LABEL[w]}
                </Pill>
              ))}
            </div>
            {scale < 1 && (
              <p className="mt-2 text-[13px] text-ink-muted">
                {WIDTH_LABEL[width]} is {WIDTHS[width]}px wide: scaled to {Math.round(scale * 100)}% to fit this window.
              </p>
            )}
            <p className="mt-2.5 flex items-center gap-2 text-[13px] text-ink-muted">
              {interactiveCount === versions.length
                ? "Interactive: motion runs in the interactive preview."
                : current.interactive
                  ? "Interactive version: motion runs in the interactive preview."
                  : "Motion follows your browser’s setting."}
              <button
                type="button"
                aria-label="About motion and reduced motion"
                aria-expanded={aboutMotion}
                aria-controls="stage-about-motion"
                onClick={() => setAboutMotion((o) => !o)}
                className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-surface text-ink-secondary outline-none hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </p>
            <p
              id="stage-about-motion"
              hidden={!aboutMotion}
              className="mt-2 rounded-xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-muted"
            >
              Motion follows your browser
              {reduce !== null && (
                <>
                  , which has reduced motion <b className="font-medium text-ink">{reduce ? "on" : "off"}</b>
                </>
              )}
              . To preview the other setting, switch Reduce motion in your system settings, or use Motion: reduced in
              the interactive preview, then press Replay.
            </p>
          </section>

          <FeedbackSection
            key={current.id}
            session={s}
            round={round}
            mockup={current}
            draft={draft}
            onChange={(fn) => drafts.update(current.id, fn)}
            onSent={() => {
              drafts.clear(current.id);
              setPinMode(false);
            }}
            phone={phone}
            pinMode={pinMode}
            onPinMode={() => enterPins()}
            onShowPin={(pin) => enterPins(pin)}
            onOpenRound={(r) => {
              setRound(r);
              setN(1);
            }}
          />

          <section aria-labelledby="stage-tools">
            <Heading id="stage-tools">Tools</Heading>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setRun((r) => r + 1)}>
                <RotateCcw /> Replay
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <a href={`/api/design/mockups/${current.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open alone
                </a>
              </Button>
              <Button size="sm" variant="secondary" disabled={opening} onClick={openPreview}>
                {opening ? <Loader2 className="animate-spin" /> : <AppWindow />}
                {preview.data?.open && preview.data.round === round ? "Preview open" : "Interactive preview"}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span id="stage-bar" className="text-[13px] text-ink-muted">
                Quick bar
              </span>
              <div role="radiogroup" aria-labelledby="stage-bar" className="flex gap-1.5">
                {(Object.keys(BAR_LABEL) as BarPlace[]).map((p) => (
                  <Pill key={p} role="radio" aria-checked={p === bar} active={p === bar} onClick={() => placeBar(p)}>
                    {BAR_LABEL[p]}
                  </Pill>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-2.5 border-t border-divider px-4 pt-3 pb-4">
          {brokenBinding && (
            <p role="alert" className="text-[13px] text-danger">
              The approved version{" "}
              {brokenBinding.status === "missing" ? "is no longer stored" : "changed since it was approved"}: it can’t
              be built until a version is approved again.
            </p>
          )}
          {pick && (
            <div role="status" className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-[13px]">
              <span className="flex-1">
                You chose version {pick.n}, “{pick.title}”, in the preview.
              </span>
              <Button size="icon-sm" variant="ghost" onClick={dismissPick} aria-label="Dismiss the choice">
                <X />
              </Button>
            </div>
          )}
          <DesignSystemBox round={thisRound} />
          {canApprove ? (
            <>
              <Button
                className="h-10 w-full"
                data-approve-trigger
                aria-describedby={thisRound?.designSystemChange ? "design-system-change" : undefined}
                onClick={() => setApproving(true)}
              >
                <Check /> Approve version {current.n}
              </Button>
              <p className="text-center text-[12px] text-ink-muted">
                Opens the approval: a note for the build and your owner passphrase.
              </p>
            </>
          ) : isApproved(current) ? (
            <p className="flex items-center justify-center gap-1.5 text-[14px] font-medium text-success">
              <Check className="size-4" aria-hidden /> Approved: version {current.n}
            </p>
          ) : (
            <p className="text-center text-[13px] text-ink-muted">
              {DESIGN_STATUS_LABEL[s.status]}: approving is closed for this session.
            </p>
          )}
        </div>
      </aside>

      <ApproveDialog
        mockup={current}
        sessionId={s.id}
        open={approving}
        onOpenChange={setApproving}
        initialNote={pick && pick.mockupId === current.id ? pick.note : ""}
        round={thisRound}
        project={s.targetProject}
      />
    </div>
  );
}
