"use client";

import {
  ChevronDown,
  CircleAlert,
  Eye,
  FileText,
  Loader2,
  MapPin,
  MessageSquarePlus,
  MousePointer2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
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

/** The element a note is on, as PIVOT's map of the render describes it (the server checks it again when sent). */
export interface DraftElement {
  selector: string;
  tag: string;
  id?: string;
  cls?: string[];
  text?: string;
  label?: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface DraftPin {
  /** Stable inside a draft (gaps allowed): the feedback's text may say "pin 2". */
  n: number;
  x: number;
  y: number;
  text: string;
  /** Set for a note on an element (the Select tool); a spot from the Pin tool has none. */
  element?: DraftElement;
}

export interface FeedbackDraft {
  scope: "version" | "round";
  text: string;
  /** The render width the pins sit on (pins belong to one version and one width). */
  width: number | null;
  pins: DraftPin[];
}

/** Comment mode's tools: Select picks an element, Pin drops a note on a spot. */
export type CommentTool = "select" | "pin";

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

/** One element of a version's render, from `GET /api/design/mockups/[id]/elements` (render pixels). */
interface MapElement {
  i: number;
  /** The nearest ancestor in the map, or -1. */
  p: number;
  tag: string;
  id?: string;
  cls?: string[];
  text?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sel: string;
}

const clip = (t: string, max = 24) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const words = (e: { text?: string; label?: string }) => (e.text ?? e.label ?? "").trim();
const tagName = (e: { tag: string; id?: string; cls?: string[]; classes?: string[] }) => {
  const cls = e.cls ?? e.classes;
  return `${e.tag}${e.id ? `#${e.id}` : cls?.[0] ? `.${cls[0]}` : ""}`;
};

/**
 * An element's name, the same in the chip, the note, the drawer and History: its tag with its id or first class, then
 * its own text or label in quotes (24 characters), or else its size: `a.btn “Go Pro”`, `div.card · 668×192`.
 */
export function elementName(e: {
  tag: string;
  id?: string;
  cls?: string[];
  classes?: string[];
  text?: string;
  label?: string;
  box: { w: number; h: number };
}) {
  const t = words(e);
  return t ? `${tagName(e)} “${clip(t)}”` : `${tagName(e)} · ${e.box.w}×${e.box.h}`;
}

const asDraft = (e: MapElement): DraftElement => ({
  selector: e.sel,
  tag: e.tag,
  ...(e.id ? { id: e.id } : {}),
  ...(e.cls ? { cls: e.cls } : {}),
  ...(e.text ? { text: e.text } : {}),
  ...(e.label ? { label: e.label } : {}),
  box: { x: e.x, y: e.y, w: e.w, h: e.h },
});
const sameBox = (a: MapElement, b: MapElement) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** The deepest element at a point: the smallest box holding it (a later one wins a tie, being nested deeper). */
function hitAt(els: MapElement[], x: number, y: number) {
  let best = -1;
  let area = Infinity;
  for (const e of els)
    if (x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h && e.w * e.h <= area) {
      area = e.w * e.h;
      best = e.i;
    }
  return best;
}

const NUDGE = 8;
const UNAVAILABLE = "Couldn’t read this version’s elements. Pin only.";
/** Space the toolbar takes at the top of the layer (more when the quick bar sits above it). */
const toolbarSpace = (barOnTop: boolean) => (barOnTop ? 128 : 64);

/**
 * Comment mode: the version's full-page render at `renderWidth`, scaled to the space left (never up), scrolling like
 * the site, with two tools.
 * - Select: the element under the cursor is outlined with a chip naming it; a click comments on it. With the page
 *   focused, arrows walk the elements (↑ parent, ↓ first child, ← → siblings) and Enter comments.
 * - Pin: a click drops a numbered note on that spot.
 * Notes are buttons: Tab between them, Enter opens the note, Delete removes it; a spot also moves with the arrows
 * (Shift for 40px). Esc closes the note, then leaves the mode.
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
  tool,
  onTool,
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
  /** The quick bar sits at the top edge: the toolbar goes below it. */
  barOnTop?: boolean;
  tool: CommentTool;
  onTool: (tool: CommentTool) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [loaded, setLoaded] = useState<{ src: string; h: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollFrame = useRef(0);
  /** Set by a pointer press on the page, so the focus it brings doesn't start the keyboard walk. */
  const pointerFocus = useRef(false);
  /** Where the page starts inside the scroller (below the toolbar and any message). */
  const [pageTop, setPageTop] = useState(0);
  const src = `/api/design/mockups/${mockup.id}/render?width=${renderWidth}`;
  const mapSrc = `/api/design/mockups/${mockup.id}/elements?width=${renderWidth}`;
  // pins placed at another width aren't shown on this render
  const pins = draft.width === null || draft.width === renderWidth ? draft.pins : [];
  const other = draft.pins.length > 0 && draft.width !== null && draft.width !== renderWidth;

  // the element map of this render: what Select hovers and picks
  const [map, setMap] = useState<{ src: string; els: MapElement[] | null } | null>(null);
  /** What the live region says: element moves, edges, and when the elements are ready. */
  const [say, setSay] = useState("");
  /** Says it in the live region, even when it is the same words again (cleared first, set on the next frame). */
  const announce = (text: string) => {
    setSay("");
    requestAnimationFrame(() => setSay(text));
  };
  useEffect(() => {
    let cancelled = false;
    api<{ elements: MapElement[] }>(mapSrc)
      .then((r) => {
        if (cancelled) return;
        // an empty map is no better than none: Select has nothing to pick
        setMap({ src: mapSrc, els: r.elements.length ? r.elements : null });
        announce(r.elements.length ? "Elements ready." : UNAVAILABLE);
      })
      .catch(() => {
        if (cancelled) return;
        setMap({ src: mapSrc, els: null });
        announce(UNAVAILABLE);
      });
    return () => {
      cancelled = true;
    };
  }, [mapSrc]);
  const els = map?.src === mapSrc ? map.els : undefined; // undefined: loading; null: unavailable
  const reading = els === undefined;
  const noMap = els === null;
  // without elements the mode works as Pin, but the owner's choice of tool is kept for next time
  const active: CommentTool = noMap ? "pin" : tool;
  /** Switches the tool (the radios and the V and P keys) and says so. */
  const chooseTool = (t: CommentTool) => {
    if (t === "select" && noMap) return announce(UNAVAILABLE);
    onTool(t);
    announce(t === "select" ? "Select tool." : "Pin tool.");
  };
  // V picks Select and P picks Pin while this mode is on, never while typing in a field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((key !== "p" && key !== "v") || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable], [role=dialog]"))
        return;
      e.preventDefault();
      chooseTool(key === "v" ? "select" : "pin");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
  useLayoutEffect(() => {
    if (page.current) setPageTop(page.current.offsetTop);
  }, [avail, other, ready]);

  // A note closed with no text is dropped when it is on an element (an outline with nothing to say is noise).
  const showNote = (next: number | null) => {
    const was = pins.find((p) => p.n === open);
    if (was && was.n !== next && was.element && !was.text.trim())
      onChange((d) => ({ ...d, pins: d.pins.filter((p) => p.n !== was.n) }));
    setOpen(next);
  };
  const exit = () => {
    showNote(null);
    onExit();
  };
  // however the mode ends (Done, Esc, the quick bar, sending), element notes left with no text go
  const dropEmpty = useRef<() => void>(() => {});
  useEffect(() => {
    dropEmpty.current = () => onChange((d) => ({ ...d, pins: d.pins.filter((p) => !p.element || p.text.trim()) }));
  });
  useEffect(() => () => dropEmpty.current(), []);

  const nextN = () => Math.max(0, ...draft.pins.map((p) => p.n)) + 1;
  /** A draft's pins sit on one render width: never drop them for a note at another. */
  const wrongWidth = () => {
    if (!other) return false;
    toast(`This draft's notes are on the ${draft.width}px render`, {
      description: "Switch back to that width to add more, or send them first.",
    });
    return true;
  };
  const addAt = (x: number, y: number) => {
    if (wrongWidth()) return;
    const n = nextN();
    onChange((d) => ({
      ...d,
      width: renderWidth,
      pins: [...d.pins, { n, x: Math.round(x), y: Math.round(y), text: "" }],
    }));
    // its note opens with the focus, ready for typing; Esc then returns the focus to the pin
    showNote(n);
  };
  /** Comments on an element: opens its note when it has one, else adds one at the point. */
  const commentOn = (i: number, x: number, y: number) => {
    const e = els?.[i];
    if (!e) return;
    const has = pins.find((p) => p.element?.selector === e.sel);
    if (has) return showNote(has.n);
    if (wrongWidth()) return;
    const n = nextN();
    onChange((d) => ({
      ...d,
      width: renderWidth,
      pins: [...d.pins, { n, x: Math.round(x), y: Math.round(y), text: "", element: asDraft(e) }],
    }));
    showNote(n);
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
    toast(`Note ${n} removed`, { action: { label: "Undo", onClick: () => onChange(() => before) } });
  };
  const setText = (n: number, text: string) =>
    onChange((d) => ({ ...d, pins: d.pins.map((p) => (p.n === n ? { ...p, text } : p)) }));

  // Show from the drawer: scroll to the note, focus it and open it
  useEffect(() => {
    if (focusPin === null || !ready) return;
    const p = draft.pins.find((x) => x.n === focusPin);
    if (!p) return;
    const y = p.element ? p.element.box.y : p.y;
    scroller.current?.scrollTo({ top: Math.max(0, y * scale - 200), behavior: "instant" });
    // the note opens with the focus (its field is autofocused); Esc returns it to the pin
    const raf = requestAnimationFrame(() => showNote(focusPin));
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
        showNote(null);
        document.getElementById(`pin-${n}`)?.focus();
      } else exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Select: hover, and the keyboard walk ----
  const [hover, setHover] = useState(-1);
  const [walk, setWalk] = useState<{ i: number; on: boolean }>({ i: -1, on: false });
  const shown = active === "select" && els ? (walk.on ? walk.i : hover) : -1;
  const pointAt = (e: React.PointerEvent | React.MouseEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  };
  const onPageMove = (e: React.PointerEvent) => {
    if (active !== "select" || !els || drag.current) return;
    const { x, y } = pointAt(e);
    const i = hitAt(els, x, y);
    if (i !== hover) setHover(i);
  };
  const centreOfView = () => {
    const el = scroller.current;
    const top = page.current?.offsetTop ?? 0;
    const y = ((el?.scrollTop ?? 0) + (el?.clientHeight ?? 800) / 2 - top) / scale;
    return { x: renderWidth / 2, y: Math.max(0, Math.min(loaded?.h || y, y)) };
  };
  const describe = (i: number) => {
    const e = els?.[i];
    if (!e) return "";
    const t = words(e);
    const note = pins.find((p) => p.element?.selector === e.sel);
    return `${tagName(e)}${t ? `, ${clip(t, 60)}` : ""}, ${e.w} by ${e.h}${note ? `, has note ${note.n}` : ""}.`;
  };
  /** Moves the keyboard selection, keeping it in view below the toolbar. */
  const walkTo = (i: number) => {
    if (!els?.[i]) return;
    setWalk({ i, on: true });
    announce(describe(i));
    const el = scroller.current;
    const e = els[i];
    if (!el) return;
    const top = (page.current?.offsetTop ?? 0) + e.y * scale;
    const bottom = top + e.h * scale;
    const space = toolbarSpace(barOnTop) + 32;
    // and clear of the quick bar when it sits at the bottom
    const below = 24 + (barOnTop ? 0 : 68);
    if (top < el.scrollTop + space) el.scrollTo({ top: Math.max(0, top - space), behavior: "instant" });
    else if (bottom > el.scrollTop + el.clientHeight - below && e.h * scale < el.clientHeight - space - below)
      el.scrollTo({ top: bottom - el.clientHeight + below, behavior: "instant" });
  };
  const kids = (i: number) => els!.filter((e) => e.p === i);
  const parentOf = (i: number) => {
    let p = els![i].p;
    while (p >= 0 && sameBox(els![p], els![i])) p = els![p].p;
    return p;
  };
  const childOf = (i: number) => {
    let c = kids(i)[0];
    while (c && sameBox(c, els![i])) c = kids(c.i)[0];
    return c?.i ?? -1;
  };
  const onPageKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || active !== "select" || !els?.length) return;
    const i = els[walk.i] ? walk.i : 0;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (i >= 0) commentOn(i, els[i].x + els[i].w / 2, els[i].y + els[i].h / 2);
      return;
    }
    const step: Record<string, () => number | string> = {
      ArrowUp: () => (parentOf(i) >= 0 ? parentOf(i) : "Top element."),
      ArrowDown: () => (childOf(i) >= 0 ? childOf(i) : "No child elements."),
      ArrowLeft: () => {
        const sib = kids(els[i].p);
        const k = sib.findIndex((s) => s.i === i);
        return k > 0 ? sib[k - 1].i : "First element here.";
      },
      ArrowRight: () => {
        const sib = kids(els[i].p);
        const k = sib.findIndex((s) => s.i === i);
        return k >= 0 && k < sib.length - 1 ? sib[k + 1].i : "Last element here.";
      },
    };
    if (!step[e.key]) return;
    e.preventDefault();
    const to = step[e.key]();
    if (typeof to === "number") walkTo(to);
    else announce(to);
  };

  // dragging a spot, past a few pixels so a click stays a click (a note on an element stays on its element)
  const drag = useRef<{ n: number; sx: number; sy: number; moved: boolean } | null>(null);
  const onPinDown = (e: React.PointerEvent, p: DraftPin) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (p.element) return;
    drag.current = { n: p.n, sx: e.clientX, sy: e.clientY, moved: false };
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
    if (moves[e.key] && !p.element) {
      e.preventDefault();
      e.stopPropagation();
      move(p.n, p.x + moves[e.key][0], p.y + moves[e.key][1]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(p.n);
    }
  };

  // the open note's element, its place in the map and its ancestors (up to 3), for the breadcrumb
  const openPin = pins.find((p) => p.n === open);
  const openEl = openPin?.element && els ? els.find((e) => e.sel === openPin.element!.selector) : undefined;
  const crumbs: MapElement[] = [];
  for (let p = openEl ? parentOf(openEl.i) : -1; p >= 0 && crumbs.length < 3; p = parentOf(p)) crumbs.unshift(els![p]);
  const moveNote = (n: number, to: MapElement) => {
    onChange((d) => ({
      ...d,
      pins: d.pins.map((p) => {
        if (p.n !== n) return p;
        const inside = p.x >= to.x && p.x <= to.x + to.w && p.y >= to.y && p.y <= to.y + to.h;
        return {
          ...p,
          x: inside ? p.x : Math.round(to.x + to.w / 2),
          y: inside ? p.y : Math.round(to.y + to.h / 2),
          element: asDraft(to),
        };
      }),
    }));
    announce(`Note moved to ${tagName(to)}.`);
    requestAnimationFrame(() => document.getElementById(`pin-note-${n}`)?.focus());
  };

  const space = toolbarSpace(barOnTop);
  // an element that already has a note is known by its marker: the pointer doesn't outline it again (the keyboard does)
  const shownEl = shown >= 0 ? els?.[shown] : undefined;
  const hoverEl = shownEl && (walk.on || !pins.some((p) => p.element?.selector === shownEl.sel)) ? shownEl : undefined;
  // the chip sits above the element, or below it when that would be under the toolbar
  const chipBelow = hoverEl ? pageTop + hoverEl.y * scale - 28 < scrollTop + space : false;
  const markerAt = (p: DraftPin) =>
    p.element
      ? {
          left: Math.max(14, p.element.box.x * scale - 14),
          top: Math.max(14, p.element.box.y * scale - 14),
        }
      : { left: p.x * scale, top: p.y * scale };
  // the chip starts after a marker sitting where it would start (an element note on the same corner)
  const pageW = renderWidth * scale;
  const chipLeft = hoverEl ? Math.min(hoverEl.x * scale, pageW - 8) : 0;
  // near the right edge the chip ends where the element ends (never past the page) instead of starting with it
  const chipRight =
    hoverEl && hoverEl.x * scale > pageW * 0.6 ? Math.max(4, pageW - (hoverEl.x + hoverEl.w) * scale) : null;
  const chipTop = hoverEl ? (chipBelow ? (hoverEl.y + hoverEl.h) * scale + 6 : hoverEl.y * scale - 26) : 0;
  const chipShift = pins.some((p) => {
    const m = p.element && markerAt(p);
    return !!m && Math.abs(m.left - chipLeft) < 24 && m.top - 14 < chipTop + 20 && m.top + 14 > chipTop;
  })
    ? 22
    : 0;
  const popW = Math.min(300, renderWidth * scale - 16);
  const popAt = (p: DraftPin) => {
    const b = p.element?.box;
    const x = b ? b.x * scale : p.x * scale + 18;
    const y = b ? (b.h * scale > 240 ? b.y * scale + 18 : (b.y + b.h) * scale + 12) : p.y * scale + 18;
    return { left: Math.max(8, Math.min(x, renderWidth * scale - popW - 8)), top: y };
  };
  const hint = noMap
    ? "Couldn’t read this version’s elements · Pin only"
    : active === "pin"
      ? "Click the page to pin a note · Esc to leave"
      : reading
        ? "Reading the page’s elements…"
        : walk.on
          ? "Arrows move · Enter comments · Esc to leave"
          : "Click an element to comment · Esc to leave";

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (scrollFrame.current) return;
        scrollFrame.current = requestAnimationFrame(() => {
          scrollFrame.current = 0;
          setScrollTop(el.scrollTop);
        });
      }}
      className="fixed inset-y-0 left-0 z-20 [scroll-padding-block:96px] overflow-y-auto bg-canvas"
      style={{ right: inset }}
    >
      <div
        role="toolbar"
        aria-label="Comment on the page"
        className={cn(
          "glass-strong sticky z-30 mx-auto mt-3 flex w-max max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-full py-1 pr-1 pl-1 text-[13px] text-ink",
          barOnTop ? "top-[76px]" : "top-3",
        )}
      >
        <div
          role="radiogroup"
          aria-label="Tool"
          className="flex gap-0.5 rounded-full bg-surface p-[3px]"
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const from = (e.target as HTMLElement).id === "tool-select" ? "select" : "pin";
            const to = from === "select" ? "pin" : "select";
            // an unavailable Select can still be reached, to hear why
            if (!(to === "select" && noMap)) chooseTool(to);
            else announce(UNAVAILABLE);
            requestAnimationFrame(() => document.getElementById(`tool-${to}`)?.focus());
          }}
        >
          {(["select", "pin"] as const).map((t) => {
            const off = t === "select" && noMap;
            const on = active === t;
            return (
              <button
                key={t}
                id={`tool-${t}`}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={off || undefined}
                aria-keyshortcuts={t === "select" ? "V" : "P"}
                aria-describedby={off ? "comment-hint" : undefined}
                title={off ? "Couldn’t read this version’s elements" : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => chooseTool(t)}
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-full px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid",
                  on ? "bg-inverse text-on-inverse" : "text-ink-secondary hover:text-ink",
                  off && "text-ink-muted hover:text-ink-muted",
                )}
              >
                {t === "select" ? (
                  <MousePointer2 className="size-3.5" aria-hidden />
                ) : (
                  <MapPin className="size-3.5" aria-hidden />
                )}
                {t === "select" ? "Select" : "Pin"}
                <kbd
                  aria-hidden
                  className="rounded-[5px] border border-current px-1 font-mono text-[12px] leading-[14px] font-medium opacity-70"
                >
                  {t === "select" ? "V" : "P"}
                </kbd>
              </button>
            );
          })}
        </div>
        <span id="comment-hint" className="flex items-center gap-1.5 px-1 text-ink-muted max-sm:hidden">
          {noMap && <CircleAlert className="size-3.5" aria-hidden />}
          {hint}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={active === "select" && reading}
          onClick={() => {
            const c = centreOfView();
            if (active === "pin") return addAt(c.x, c.y);
            const i = els ? hitAt(els, c.x, c.y) : -1;
            if (i >= 0) commentOn(i, c.x, c.y);
            else toast("No element in the middle of the view", { description: "Scroll to one, or pin a spot (P)." });
          }}
        >
          <Plus /> {active === "pin" ? "Add pin at centre" : "Comment at centre"}
        </Button>
        <Button size="sm" variant="secondary" className="bg-inverse text-on-inverse hover:bg-inverse/90" onClick={exit}>
          Done
        </Button>
      </div>
      <p role="status" className="sr-only">
        {say}
      </p>
      {other && (
        <p className="mx-auto mt-2 w-max rounded-full bg-surface px-3 py-1 text-[13px] text-ink-muted">
          This draft&rsquo;s notes are on the {draft.width}px render: switch to that width to see them.
        </p>
      )}
      {ready && loaded?.h === 0 && (
        <p role="alert" className="mx-auto mt-8 max-w-md text-center text-[14px] text-ink-muted">
          PIVOT couldn&rsquo;t make the picture of this version to comment on. Leave this mode and write your feedback
          as text, or try again.
        </p>
      )}
      <div
        ref={page}
        tabIndex={active === "select" && els?.length ? 0 : -1}
        role="application"
        aria-roledescription="element picker"
        aria-label={`Version ${mockup.n}: ${mockup.title}, full page at ${renderWidth}px`}
        aria-describedby="comment-hint"
        onPointerDown={() => {
          pointerFocus.current = true;
        }}
        onFocus={(e) => {
          if (e.target !== e.currentTarget || !els?.length) return;
          if (pointerFocus.current) {
            pointerFocus.current = false;
            return;
          }
          const c = centreOfView();
          const i = walk.i >= 0 ? walk.i : hitAt(els, c.x, c.y);
          walkTo(i >= 0 ? i : 0);
        }}
        onBlur={(e) => e.target === e.currentTarget && setWalk((w) => ({ ...w, on: false }))}
        onKeyDown={onPageKey}
        onPointerMove={onPageMove}
        onPointerLeave={() => setHover(-1)}
        className={cn(
          "relative mx-auto my-4 bg-white transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid motion-reduce:transition-none",
          active === "pin" ? "cursor-crosshair" : "cursor-default",
          ready && loaded?.h ? "opacity-100" : "opacity-0",
          reduce && "transition-none",
        )}
        style={{ width: renderWidth * scale, height: (loaded?.h || 900) * scale }}
        onClick={(e) => {
          pointerFocus.current = false;
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.render) return;
          const { x, y } = pointAt(e);
          if (active === "pin") return addAt(x, y);
          if (!els) return;
          setWalk({ i: -1, on: false });
          const i = hitAt(els, x, y);
          if (i >= 0) commentOn(i, x, y);
          else toast("No element here", { description: "Pin a spot instead (P)." });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- PIVOT's own render, sized by the page */}
        <img
          data-render="1"
          src={src}
          alt=""
          width={renderWidth * scale}
          className="block select-none"
          draggable={false}
        />
        {/* notes on elements keep a thin outline; the open one, a solid one */}
        {pins.map(
          (p) =>
            p.element && (
              <div
                key={`box-${p.n}`}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute rounded-[2px] shadow-[0_0_0_3px_var(--canvas)]",
                  open === p.n ? "outline-2 outline-ink outline-solid" : "outline-[1.5px] outline-ink/75 outline-solid",
                )}
                style={{
                  left: p.element.box.x * scale,
                  top: p.element.box.y * scale,
                  width: p.element.box.w * scale,
                  height: p.element.box.h * scale,
                }}
              />
            ),
        )}
        {hoverEl && (
          <>
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-[2px] shadow-[0_0_0_3px_var(--canvas)] outline-2 outline-ink outline-solid"
              style={{
                left: hoverEl.x * scale,
                top: hoverEl.y * scale,
                width: hoverEl.w * scale,
                height: hoverEl.h * scale,
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-[6px] bg-inverse px-[7px] font-mono text-[12px] leading-[18px] font-medium whitespace-nowrap text-on-inverse shadow-[0_0_0_1px_var(--canvas)]"
              style={
                chipRight !== null ? { right: chipRight, top: chipTop } : { left: chipLeft + chipShift, top: chipTop }
              }
            >
              {words(hoverEl) ? `${tagName(hoverEl)} “${clip(words(hoverEl))}”` : tagName(hoverEl)}
              <span className="opacity-65">
                {" "}
                · {hoverEl.w}×{hoverEl.h}
              </span>
            </div>
          </>
        )}
        {pins.map((p) => (
          <button
            key={p.n}
            id={`pin-${p.n}`}
            type="button"
            aria-label={`Note ${p.n}${p.element ? ` on ${elementName(p.element)}` : ""}${p.text ? `: ${p.text.slice(0, 60)}` : ", no text yet"}`}
            aria-expanded={open === p.n}
            aria-controls={open === p.n ? `pin-note-${p.n}` : undefined}
            onPointerDown={(e) => onPinDown(e, p)}
            onPointerMove={onPinMove}
            onPointerUp={onPinUp}
            onPointerCancel={onPinUp}
            onLostPointerCapture={onPinUp}
            onKeyDown={(e) => onPinKey(e, p)}
            onClick={(e) => {
              e.stopPropagation();
              // a click, Enter or Space opens the note; the end of a drag doesn't
              if (dragged.current) dragged.current = false;
              else showNote(open === p.n ? null : p.n);
            }}
            className="absolute -mt-3.5 -ml-3.5 grid size-7 touch-none place-items-center rounded-full bg-inverse font-mono text-[13px] font-medium text-on-inverse shadow-[0_0_0_2px_var(--canvas),0_24px_64px_rgb(0_0_0/0.6),0_2px_8px_rgb(0_0_0/0.35)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid motion-safe:animate-[pin-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
            style={markerAt(p)}
          >
            {p.n}
          </button>
        ))}
        {openPin && (
          <div
            className="glass-strong absolute z-10 origin-top-left rounded-[14px] p-3 text-[13px] text-ink motion-safe:animate-[pop-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
            style={{ width: popW, ...popAt(openPin) }}
          >
            {crumbs.length > 0 && (
              <div
                role="group"
                aria-label="Comment on a parent instead"
                className="-mt-1 mb-1.5 -ml-1.5 flex flex-wrap items-center"
              >
                {crumbs.map((c) => {
                  const taken = pins.find((p) => p.element?.selector === c.sel);
                  return (
                    <span key={c.i} className="flex items-center">
                      <button
                        type="button"
                        disabled={!!taken}
                        title={taken ? `Already has note ${taken.n}` : `Move this note to ${tagName(c)}`}
                        onClick={() => moveNote(openPin.n, c)}
                        className="flex min-h-6 items-center rounded-full px-1.5 font-mono text-[12px] text-ink-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid disabled:text-ink-muted disabled:hover:bg-transparent"
                      >
                        {tagName(c)}
                      </button>
                      <span aria-hidden className="text-ink-muted">
                        ›
                      </span>
                    </span>
                  );
                })}
                <b aria-current="true" className="px-1.5 font-mono text-[12px] font-medium">
                  {tagName(openPin.element!)}
                </b>
              </div>
            )}
            <label htmlFor={`pin-note-${openPin.n}`} className="mb-1.5 block text-[12px] text-ink-muted">
              {openPin.element ? `Note on ${elementName(openPin.element)}` : `Note for pin ${openPin.n}`}
            </label>
            <textarea
              id={`pin-note-${openPin.n}`}
              autoFocus
              rows={3}
              maxLength={1000}
              value={openPin.text}
              onChange={(e) => setText(openPin.n, e.target.value)}
              placeholder={openPin.element ? "What should change on it?" : "What should change here?"}
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

const Kbd = ({ children }: { children: string }) => (
  <kbd className="rounded-[5px] border border-current px-1 font-mono text-[12px] leading-[14px] opacity-80">
    {children}
  </kbd>
);

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
            // each note keeps its number, so "pin 3" in the text still names it; an element is sent by its selector
            // (PIVOT finds the rest in its own map of the render)
            pins: withPins.map(({ n, x, y, text: t, element }) => ({
              n,
              x,
              y,
              text: t.trim(),
              ...(element ? { element: { selector: element.selector } } : {}),
            })),
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
        {pinMode && <span className="ml-1 font-normal tracking-normal normal-case">· commenting</span>}
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
            <ol aria-label="Notes on the page" className="mt-2.5 flex flex-col gap-0.5">
              {[...pins]
                .sort((a, b) => a.n - b.n)
                .map((p) => (
                  <li key={p.n} className="flex items-start gap-2.5 rounded-xl bg-surface py-2 pr-1.5 pl-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-inverse font-mono text-[12px] font-medium text-on-inverse">
                      {p.n}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink-secondary">
                      <span className="line-clamp-2">{p.text || <i className="text-ink-muted">No note yet</i>}</span>
                      <small className="block font-mono text-[12px] text-ink-muted">
                        {[p.element ? elementName(p.element) : "Spot", widthLabel(draft.width)]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    {!phone && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Show note ${p.n}`}
                        onClick={() => onShowPin(p.n)}
                      >
                        <Eye />
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete note ${p.n}`}
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
            <p className="mt-2 text-[12px] text-ink-muted">Comments on the page need a wider screen.</p>
          ) : (
            <div className="mt-2.5 text-[12px] text-ink-muted">
              <Button size="sm" variant="secondary" onClick={onPinMode}>
                <MessageSquarePlus /> Comment on the page
              </Button>
              <p className="mt-1.5">
                or press <Kbd>P</Kbd> · then <Kbd>V</Kbd> selects an element, <Kbd>P</Kbd> pins a spot
              </p>
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
                <span className="text-ink">{f.text || `${f.pins.length} note${f.pins.length === 1 ? "" : "s"}`}</span>
                <span className="mt-0.5 block text-[12px] text-ink-muted">
                  {f.mockupId ? `Version ${s.mockups.find((m) => m.id === f.mockupId)?.n ?? "?"}` : "Whole round"}
                  {f.pins.length ? ` · ${f.pins.length} note${f.pins.length === 1 ? "" : "s"}` : ""} ·{" "}
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
