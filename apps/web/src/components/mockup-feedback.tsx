"use client";

import {
  ChevronDown,
  CircleAlert,
  EyeOff,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DesignMockupDTO, DesignRoundDTO, DesignSessionDetailDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { hitAt, liveBox, mapDocument, type MapElement } from "@/lib/element-map";
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
  /** The page width the notes sit on (notes belong to one version and one width). */
  width: number | null;
  /** The frame's viewport height when the notes were made (`100vh` depends on it). */
  vh?: number | null;
  /** The view and width the notes were made at, as shown: `Tablet 834` (the page's own width may be a scrollbar less). */
  label?: string;
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

const NUDGE = 8;
const UNAVAILABLE = "Couldn’t read this version’s page. Leave and write your feedback as text.";
/** Space the toolbar takes at the top of the window (more when the quick bar sits above it). */
const toolbarSpace = (barOnTop: boolean) => (barOnTop ? 128 : 64);

/** A width as the drawer names it: `Desktop 1512`, `Tablet 834`, `Phone 390`. */
export const widthName = (w: number | null | undefined) =>
  !w ? "" : w === 834 ? `Tablet ${w}` : w === 390 ? `Phone ${w}` : `Desktop ${w}`; // design-mockups WIDTHS

/** Where the frame is and how it is scrolled, read again whenever it scrolls or the window resizes. */
interface Geo {
  /** The frame's box in the window, and its scale (Tablet and Phone shrink in a narrow window). */
  left: number;
  top: number;
  w: number;
  h: number;
  scale: number;
  /** The page's own scroll, width (its CSS pixels, the notes' width) and viewport height. */
  sx: number;
  sy: number;
  pageW: number;
  vh: number;
}

function measure(frame: HTMLIFrameElement): Geo | null {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc?.documentElement || !win) return null;
  const r = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? r.width / frame.offsetWidth : 1;
  return {
    left: r.left,
    top: r.top,
    w: r.width,
    h: Math.min(r.height, window.innerHeight - Math.max(0, r.top)),
    scale,
    sx: win.scrollX,
    sy: win.scrollY,
    pageW: doc.documentElement.clientWidth,
    vh: win.innerHeight,
  };
}

/**
 * Comment mode on the live page: the version stays exactly as shown (its size, its scroll, its own hover styles) and
 * the layer draws over it, with two tools.
 * - Select: the element under the cursor is outlined with a chip naming it, and a strip under the toolbar shows its
 *   path (each part jumps to that element); a click comments on it. Arrows walk the elements from the outlined one,
 *   with no click or Tab first (↑ parent, ↓ first child, ← → siblings; from the middle of the view when nothing is
 *   outlined) and Enter comments; moving the pointer hands the outline back to it. The picker (a tab stop after the
 *   toolbar) starts a walk for keyboard users.
 * - Pin: a click drops a numbered note on that spot.
 * Clicks, presses and submits stop inside the page, before it sees them; scrolling and hover go on. Notes are buttons:
 * Tab between them, Enter opens the note, Delete removes it; a spot also moves with the arrows (Shift for 40px). Esc
 * closes the note, then ends a walk, then leaves the mode.
 */
export function PinLayer({
  mockup,
  frame,
  inset,
  onHidePanel,
  draft,
  onChange,
  onExit,
  focusPin,
  barOnTop = false,
  tool,
  onTool,
  viewLabel = "Desktop",
}: {
  /** The view the page is shown at (Desktop, Tablet, Phone), for the notes' width labels. */
  viewLabel?: string;
  mockup: DesignMockupDTO;
  /** The full-screen frame (a same-origin, script-free copy of the version), once loaded. */
  frame: HTMLIFrameElement | null;
  /** Space on the right the drawer covers, so the toolbar and notes stay clear of it. */
  inset: number;
  onHidePanel: () => void;
  draft: FeedbackDraft;
  onChange: (fn: (d: FeedbackDraft) => FeedbackDraft) => void;
  onExit: () => void;
  /** A pin to scroll to and open (from the drawer's Show). */
  focusPin: number | null;
  reduce?: boolean | null;
  /** The quick bar sits at the top edge: the toolbar goes below it. */
  barOnTop?: boolean;
  tool: CommentTool;
  onTool: (tool: CommentTool) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  // the page's elements and their live nodes; undefined while reading, null when the page can't be read
  const [map, setMap] = useState<{ els: MapElement[]; nodes: Element[] } | null | undefined>(undefined);
  const els = map === undefined ? undefined : map ? map.els : null;
  const nodes = map?.nodes;
  const picker = useRef<HTMLDivElement>(null);
  /** Set by a pointer press on the page, so the focus it brings doesn't start the keyboard walk. */
  const pointerFocus = useRef(false);

  /** What the live region says: element moves, edges, tools and readiness. */
  const [say, setSay] = useState("");
  /** Says it in the live region, even when it is the same words again (cleared first, set on the next frame). */
  const announce = (text: string) => {
    setSay("");
    requestAnimationFrame(() => setSay(text));
  };

  // the page's place and scroll, and its elements: read once loaded, again on scroll and resize (once a frame)
  useEffect(() => {
    if (!frame) return;
    const win = frame.contentWindow;
    let raf = 0;
    let mapTimer = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setGeo(measure(frame));
      });
    };
    const remap = () => {
      clearTimeout(mapTimer);
      mapTimer = window.setTimeout(async () => {
        const doc = frame.contentDocument;
        // read the page once its entrance motion has settled (at most 1.5 s), so boxes aren't caught mid-animation
        const motion = doc?.getAnimations?.() ?? [];
        if (motion.length)
          await Promise.race([
            Promise.all(motion.map((a) => a.finished.catch(() => null))),
            new Promise((r) => setTimeout(r, 1500)),
          ]);
        const read = doc ? mapDocument(doc) : { els: [], nodes: [] };
        setMap(read.els.length ? read : null);
        setGeo(measure(frame));
      }, 0);
    };
    remapRef.current = remap;
    remap();
    const ro = new ResizeObserver(() => {
      update();
      remap();
    });
    ro.observe(frame);
    win?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(mapTimer);
      ro.disconnect();
      win?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [frame]);

  const pageW = geo?.pageW ?? 0;
  /** Each mapped node's place in the map, for hit-testing the live page. */
  const index = useMemo(() => new Map((nodes ?? []).map((n, i) => [n, i])), [nodes]);
  /** An element's box now (fixed and sticky ones move with the scroll), or its mapped box when the node is gone. */
  const boxOf = (i: number) => (nodes?.[i]?.isConnected ? liveBox(nodes[i]) : els?.[i]);
  /** The element the keyboard or Show reached under the drawer: its hint stays until another element is reached. */
  const [behindSel, setBehindSel] = useState<string | null>(null);
  const remapRef = useRef<() => void>(() => {});
  const isBehind = (e: { x: number }) =>
    !!geo && inset > 0 && geo.left + (e.x - geo.sx) * geo.scale > window.innerWidth - inset - 24;
  const reading = els === undefined;
  const noMap = els === null || !frame?.contentDocument;
  const active: CommentTool = tool;
  // notes made at another width aren't drawn on this one
  const pins = draft.width === null || draft.width === pageW ? draft.pins : [];
  const other = draft.pins.length > 0 && draft.width !== null && pageW > 0 && draft.width !== pageW;

  /** Switches the tool (the radios and the V and P keys) and says so. */
  const chooseTool = (t: CommentTool) => {
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
  /** A draft's notes sit on one width: never drop them for a note at another. */
  const wrongWidth = () => {
    if (!other) return false;
    toast(`This draft's notes were made at ${draft.label ?? widthName(draft.width)}`, {
      description: "Switch back to that width to add more, or send them first.",
    });
    return true;
  };
  const stamp = () => ({
    width: pageW,
    vh: geo?.vh ?? null,
    label: `${viewLabel} ${Math.round(frame?.offsetWidth ?? pageW)}`,
  });
  const addAt = (x: number, y: number) => {
    if (wrongWidth() || !pageW) return;
    const n = nextN();
    onChange((d) => ({ ...d, ...stamp(), pins: [...d.pins, { n, x: Math.round(x), y: Math.round(y), text: "" }] }));
    // its note opens with the focus, ready for typing; Esc then returns the focus to the pin
    showNote(n);
  };
  /** Comments on an element: opens its note when it has one, else adds one at the point. */
  const commentOn = (i: number, x: number, y: number) => {
    const e = els?.[i];
    if (!e || !pageW) return;
    const has = pins.find((p) => p.element?.selector === e.sel);
    if (has) return showNote(has.n);
    if (wrongWidth()) return;
    const n = nextN();
    onChange((d) => ({
      ...d,
      ...stamp(),
      pins: [...d.pins, { n, x: Math.round(x), y: Math.round(y), text: "", element: asDraft({ ...e, ...boxOf(i)! }) }],
    }));
    showNote(n);
  };
  const move = (n: number, x: number, y: number) =>
    onChange((d) => ({
      ...d,
      pins: d.pins.map((p) =>
        p.n === n
          ? { ...p, x: Math.round(Math.max(0, Math.min(pageW, x))), y: Math.round(Math.max(0, Math.min(12000, y))) }
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

  const scrollPageTo = (y: number) => frame?.contentWindow?.scrollTo({ top: Math.max(0, y), behavior: "instant" });

  // Show from the drawer: scroll the page to the note, then open it
  useEffect(() => {
    if (focusPin === null || !geo) return;
    const p = draft.pins.find((x) => x.n === focusPin);
    if (!p) return;
    const y = p.element ? p.element.box.y : p.y;
    scrollPageTo(y - (toolbarSpace(barOnTop) + 120) / geo.scale);
    // the note opens with the focus (its field is autofocused); Esc returns it to the pin
    const raf = requestAnimationFrame(() => {
      setBehindSel(p.element && isBehind(p.element.box) ? p.element.selector : null);
      showNote(focusPin);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when asked to show a pin
  }, [focusPin, !!geo]);

  // ---- Select: hover, and the keyboard walk ----
  const [hover, setHover] = useState(-1);
  const [walk, setWalk] = useState<{ i: number; on: boolean }>({ i: -1, on: false });
  const shown = active === "select" && els ? (walk.on ? walk.i : hover) : -1;
  /** Where the pointer last was over the page, and where it was when the keys took the outline from it. */
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const walkPt = useRef<{ x: number; y: number } | null>(null);

  // Esc in layers: the open note first, then a walk, then the mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest("[role=dialog]")) return;
      e.preventDefault();
      if (open !== null) {
        const n = open;
        showNote(null);
        document.getElementById(`pin-${n}`)?.focus();
      } else if (walk.on && active === "select") {
        setWalk((w) => ({ ...w, on: false }));
        announce("Back to the pointer.");
      } else exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The page's own events, while commenting: presses, clicks and submits stop inside it before it sees them (they
  // make notes instead); the pointer is read for Select. Scrolling and the page's hover styles go on.
  const live = useRef({ active, els, hover, walkOn: walk.on, commentOn, addAt, setHover, setWalk, index });
  // refreshed after every render on purpose: the page's listeners, added once, always call the latest handlers
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    live.current = { active, els, hover, walkOn: walk.on, commentOn, addAt, setHover, setWalk, index };
  });
  useEffect(() => {
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win) return;
    const at = (e: MouseEvent) => ({ x: e.clientX + win.scrollX, y: e.clientY + win.scrollY });
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    let lastRemap = 0;
    /** The mapped element under a point of the page's viewport: the live hit, or its nearest mapped ancestor. */
    const pick = (cx: number, cy: number) => {
      const hit = doc.elementFromPoint(cx, cy);
      let el: Element | null = hit;
      while (el && !live.current.index.has(el)) el = el.parentElement;
      // an element the map missed (shown by a hover style, or added since): read the page again, at most twice a second
      if (hit && hit !== el && hit !== doc.body && hit !== doc.documentElement && Date.now() - lastRemap > 500) {
        lastRemap = Date.now();
        remapRef.current();
      }
      return el ? live.current.index.get(el)! : -1;
    };
    const onMove = (e: PointerEvent) => {
      const l = live.current;
      if (l.active !== "select" || !l.els) return;
      lastPt.current = { x: e.clientX, y: e.clientY };
      // after a key step the outline stays with the keys until the pointer really moves (a few pixels)
      if (l.walkOn) {
        const s = walkPt.current;
        if (!s) walkPt.current = lastPt.current;
        if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) <= 4) return;
        l.setWalk((w) => ({ ...w, on: false }));
      }
      const i = pick(e.clientX, e.clientY);
      if (i !== l.hover) l.setHover(i);
    };
    // the page never takes the focus while commenting: it goes to the picker, where the keys work
    const keepOut = () => (picker.current ?? document.getElementById("tool-select"))?.focus();
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) live.current.setHover(-1);
    };
    const onClick = (e: MouseEvent) => {
      stop(e);
      if (e.button !== 0) return;
      const l = live.current;
      const { x, y } = at(e);
      if (l.active === "pin") return l.addAt(x, y);
      if (!l.els) return;
      l.setWalk({ i: -1, on: false });
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) l.commentOn(i, x, y);
      else toast("No element here", { description: "Pin a spot instead (P)." });
    };
    const blocked = ["mousedown", "pointerdown", "mouseup", "auxclick", "dblclick", "submit", "dragstart"];
    for (const t of blocked) doc.addEventListener(t, stop, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("pointermove", onMove, true);
    doc.addEventListener("pointerout", onOut, true);
    doc.addEventListener("focusin", keepOut, true);
    // the cursor says which tool is on, over every element of the page
    const style = doc.createElement("style");
    style.textContent = `html.pivot-commenting, html.pivot-commenting * { cursor: ${active === "pin" ? "crosshair" : "default"} !important; }`;
    doc.head?.append(style);
    doc.documentElement.classList.add("pivot-commenting");
    return () => {
      for (const t of blocked) doc.removeEventListener(t, stop, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("pointermove", onMove, true);
      doc.removeEventListener("pointerout", onOut, true);
      doc.removeEventListener("focusin", keepOut, true);
      style.remove();
      doc.documentElement.classList.remove("pivot-commenting");
    };
  }, [frame, active]);

  const visRight = geo ? Math.min(geo.left + geo.w, window.innerWidth - inset) : 0;
  const centreOfView = () => {
    if (!geo) return { x: 0, y: 0 };
    return {
      x: geo.sx + (visRight - geo.left) / 2 / geo.scale,
      y: geo.sy + geo.vh / 2,
    };
  };
  const describe = (i: number) => {
    const e = els?.[i];
    if (!e) return "";
    const t = words(e);
    const note = pins.find((p) => p.element?.selector === e.sel);
    return `${tagName(e)}${t ? `, ${clip(t, 60)}` : ""}, ${e.w} by ${e.h}${note ? `, has note ${note.n}` : ""}.`;
  };
  /** Moves the keyboard selection, keeping it in view below the toolbar and above a bottom quick bar. */
  const walkTo = (i: number) => {
    const e = els?.[i] && { ...els[i], ...boxOf(i)! };
    if (!e || !geo) return;
    setWalk({ i, on: true });
    walkPt.current = lastPt.current;
    setBehindSel(isBehind(e) ? e.sel : null);
    announce(describe(i));
    const above = (toolbarSpace(barOnTop) + 32) / geo.scale;
    const below = (24 + (barOnTop ? 0 : 68)) / geo.scale;
    if (e.y < geo.sy + above) scrollPageTo(e.y - above);
    else if (e.y + e.h > geo.sy + geo.vh - below && e.h < geo.vh - above - below)
      scrollPageTo(e.y + e.h - geo.vh + below);
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
  /** The element in the middle of the view, else the first one. */
  const centreEl = () => {
    const c = centreOfView();
    const i = els ? hitAt(els, c.x, c.y) : -1;
    return i >= 0 ? i : 0;
  };
  /**
   * The walk's keys, from the outlined element (walked to, or under the pointer): arrows move, Enter and Space comment
   * (only where the focus is the page's: the picker or nothing, never on a control). True when the key was used.
   */
  const walkKey = (e: { key: string; preventDefault: () => void }, onPage: boolean) => {
    if (active !== "select" || !els?.length || open !== null) return false;
    const from = walk.on && els[walk.i] ? walk.i : hover >= 0 && els[hover] ? hover : -1;
    if (e.key === "Enter" || e.key === " ") {
      if (!onPage) return false;
      e.preventDefault();
      const i = from >= 0 ? from : centreEl();
      commentOn(i, els[i].x + els[i].w / 2, els[i].y + els[i].h / 2);
      return true;
    }
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return false;
    e.preventDefault();
    // nothing outlined: the first arrow outlines the element in the middle of the view
    if (from < 0) {
      walkTo(centreEl());
      return true;
    }
    const i = from;
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
    const to = step[e.key]();
    if (typeof to === "number") walkTo(to);
    else {
      // at an edge the outline stays where it is, now held by the keys
      if (!walk.on) walkTo(i);
      announce(to);
    }
    return true;
  };
  const onPickerKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    walkKey(e, true);
  };
  // the same keys anywhere else that doesn't use them itself: no click or Tab needed after pointing at an element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t === picker.current) return;
      if (
        t?.closest(
          "input, textarea, select, [contenteditable], [role=dialog], [role=radiogroup], [role=tablist], [role=listbox], [role=menu], [role=slider]",
        )
      )
        return;
      // the keys take the page: an arrow moves the focus onto the picker (quietly), so Enter then comments instead of
      // pressing the button that had the focus
      if (
        walkKey(e, !t || t === document.body) &&
        e.key.startsWith("Arrow") &&
        picker.current &&
        document.activeElement !== picker.current
      ) {
        pointerFocus.current = true;
        picker.current.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    if (!d || !geo) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    move(d.n, geo.sx + (e.clientX - geo.left) / geo.scale, geo.sy + (e.clientY - geo.top) / geo.scale);
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

  // ---- geometry on the window: page pixels → the frame's box, scrolled and scaled ----
  const k = geo?.scale ?? 1;
  const px = (x: number) => (x - (geo?.sx ?? 0)) * k; // inside the clipped overlay, which sits on the frame's box
  const py = (y: number) => (y - (geo?.sy ?? 0)) * k;
  const space = toolbarSpace(barOnTop);
  // an element that already has a note is known by its marker: the pointer doesn't outline it again (the keyboard does)
  const shownEl = shown >= 0 && els?.[shown] ? { ...els[shown], ...boxOf(shown)! } : undefined;
  const hoverEl = shownEl && (walk.on || !pins.some((p) => p.element?.selector === shownEl.sel)) ? shownEl : undefined;
  const boxW = geo?.w ?? 0;
  // the chip sits above the element, or below it when that would be under the toolbar
  const chipBelow = hoverEl && geo ? geo.top + py(hoverEl.y) - 28 < space : false;
  /** A note's element where it is now (found again by its selector), or where it was when the note was made. */
  const noteBox = (p: DraftPin) => {
    if (!p.element) return null;
    const node = frame?.contentDocument?.querySelector(p.element.selector);
    return node ? liveBox(node) : p.element.box;
  };
  const markerAt = (p: DraftPin) =>
    p.element
      ? { left: Math.max(14, px(noteBox(p)!.x) - 14), top: Math.max(14, py(noteBox(p)!.y) - 14) }
      : { left: px(p.x), top: py(p.y) };
  const chipLeft = hoverEl ? Math.min(px(hoverEl.x), boxW - 8) : 0;
  // near the right edge the chip ends where the element ends (never past the page) instead of starting with it
  const chipRight = hoverEl && px(hoverEl.x) > boxW * 0.6 ? Math.max(4, boxW - px(hoverEl.x + hoverEl.w)) : null;
  const chipTop = hoverEl ? (chipBelow ? py(hoverEl.y + hoverEl.h) + 6 : py(hoverEl.y) - 26) : 0;
  // the chip starts after a marker sitting where it would start (an element note on the same corner)
  const chipShift = pins.some((p) => {
    const m = p.element && markerAt(p);
    return !!m && Math.abs(m.left - chipLeft) < 24 && m.top - 14 < chipTop + 20 && m.top + 14 > chipTop;
  })
    ? 22
    : 0;
  // the note opens below its element or spot, on the side away from the drawer
  const popW = Math.min(300, Math.max(200, visRight - (geo?.left ?? 0) - 16));
  const popAt = (p: DraftPin) => {
    if (!geo) return { left: 8, top: 8 };
    const b = p.element?.box;
    const x = geo.left + (b ? px(b.x) : px(p.x) + 18);
    const y = geo.top + (b ? (b.h * k > 240 ? py(b.y) + 18 : py(b.y + b.h) + 12) : py(p.y) + 18);
    return {
      left: Math.max(8, Math.min(x, visRight - popW - 8)),
      top: Math.max(space, Math.min(y, window.innerHeight - 240)),
    };
  };
  // the outlined element's path, under the toolbar: up to three ancestors (as the walk counts them), then the element
  const path: MapElement[] = [];
  if (hoverEl && open === null) {
    for (let p = parentOf(shown); p >= 0 && path.length < 3; p = parentOf(p)) path.unshift(els![p]);
    path.push(els![shown]);
  }
  // an element the keyboard (or Show) reached under the drawer: offer to hide it
  const behind = behindSel && inset > 0 ? els?.find((e) => e.sel === behindSel) : undefined;
  const hint = noMap
    ? UNAVAILABLE
    : active === "pin"
      ? "Click the page to pin a note · Esc to leave"
      : reading
        ? "Reading the page’s elements…"
        : walk.on
          ? "Arrows move · Enter comments · Esc to leave"
          : shown >= 0
            ? "Click to comment · Arrows move · Esc to leave"
            : "Click an element to comment · Esc to leave";

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <div
        role="toolbar"
        aria-label="Comment on the page"
        className={cn(
          "glass-strong pointer-events-auto fixed z-30 flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full py-1 pr-1 pl-1 text-[13px] text-ink",
          barOnTop ? "top-[76px]" : "top-3",
        )}
        style={{ left: `calc((100vw - ${inset}px) / 2)` }}
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
            chooseTool(to);
            requestAnimationFrame(() => document.getElementById(`tool-${to}`)?.focus());
          }}
        >
          {(["select", "pin"] as const).map((t) => {
            const on = active === t;
            return (
              <button
                key={t}
                id={`tool-${t}`}
                type="button"
                role="radio"
                aria-checked={on}
                aria-keyshortcuts={t === "select" ? "V" : "P"}
                tabIndex={on ? 0 : -1}
                onClick={(e) => {
                  chooseTool(t);
                  // picked with the pointer: the focus goes to the page (without starting a walk), so the arrows
                  // walk from the element pointed at next instead of switching the tool back
                  if (t === "select" && e.detail > 0 && picker.current) {
                    pointerFocus.current = true;
                    picker.current.focus();
                  }
                }}
                className={cn(
                  "flex h-[30px] items-center gap-1.5 rounded-full px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid",
                  on ? "bg-inverse text-on-inverse" : "text-ink-secondary hover:text-ink",
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
          {noMap && !reading && <CircleAlert className="size-3.5" aria-hidden />}
          {hint}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!geo || (active === "select" && (reading || noMap))}
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
        <p
          className="glass-strong pointer-events-auto fixed z-30 w-max -translate-x-1/2 rounded-full px-3 py-1 text-[13px] text-ink-secondary"
          style={{ left: `calc((100vw - ${inset}px) / 2)`, top: space }}
        >
          This draft&rsquo;s notes were made at {draft.label ?? widthName(draft.width)}: switch back to that width to
          see them.
        </p>
      )}
      {behind && (
        <button
          type="button"
          onClick={() => {
            setBehindSel(null);
            onHidePanel();
            // the button goes away with the drawer: the focus returns to the page's picker
            requestAnimationFrame(() => picker.current?.focus());
          }}
          className="glass-strong pointer-events-auto fixed z-30 flex h-10 -translate-x-1/2 items-center gap-2 rounded-full py-1 pr-1 pl-3 text-[13px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
          style={{ left: `calc((100vw - ${inset}px) / 2)`, top: space + (other ? 36 : 0) }}
        >
          <EyeOff className="size-3.5 text-ink-muted" aria-hidden />
          <span>{elementName({ ...behind, box: behind })} is behind the panel</span>
          <span className="flex h-8 items-center rounded-full bg-inverse px-3 font-medium text-on-inverse">
            Hide panel
          </span>
        </button>
      )}
      {path.length > 0 && (
        <nav
          aria-label="Element path"
          className="glass-strong pointer-events-auto fixed z-30 flex h-[30px] -translate-x-1/2 items-center justify-end overflow-hidden rounded-full px-1.5 whitespace-nowrap"
          style={{
            left: `calc((100vw - ${inset}px) / 2)`,
            maxWidth: `calc(100vw - ${inset}px - 32px)`,
            top: space + (other ? 36 : 0) + (behind ? 48 : 0),
          }}
        >
          {path.map((c, k) =>
            k === path.length - 1 ? (
              <b key={c.i} aria-current="true" className="shrink-0 px-1.5 font-mono text-[12px] font-medium text-ink">
                {tagName(c)}
              </b>
            ) : (
              <span key={c.i} className="flex min-w-0 items-center">
                <button
                  type="button"
                  title={`Outline ${tagName(c)}`}
                  onClick={() => {
                    walkTo(c.i);
                    // back to the page's picker, quietly: Enter then comments on it, the arrows go on walking
                    pointerFocus.current = true;
                    picker.current?.focus();
                  }}
                  className="flex min-h-6 min-w-0 items-center truncate rounded-full px-1.5 font-mono text-[12px] text-ink-secondary outline-none hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-text focus-visible:outline-solid"
                >
                  {tagName(c)}
                </button>
                <span aria-hidden className="text-ink-muted">
                  ›
                </span>
              </span>
            ),
          )}
        </nav>
      )}
      {geo && (
        <div
          // the picker: the page's stand-in in the tab order, for the keyboard walk (the pointer passes through it)
          ref={picker}
          tabIndex={active === "select" && els?.length ? 0 : -1}
          role="application"
          aria-roledescription="element picker"
          aria-label={`Version ${mockup.n}: ${mockup.title}, at ${widthName(pageW)}`}
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
            const i = hover >= 0 && els[hover] ? hover : els[walk.i] ? walk.i : hitAt(els, c.x, c.y);
            walkTo(i >= 0 ? i : 0);
          }}
          onBlur={(e) => e.target === e.currentTarget && setWalk((w) => ({ ...w, on: false }))}
          onKeyDown={onPickerKey}
          className="fixed rounded-[2px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-text focus-visible:outline-solid"
          style={{ left: geo.left, top: geo.top, width: visRight - geo.left, height: geo.h }}
        />
      )}
      {geo && (
        // everything drawn on the page, clipped to the frame's box so nothing spills over the window's chrome
        <div className="fixed overflow-hidden" style={{ left: geo.left, top: geo.top, width: geo.w, height: geo.h }}>
          {/* notes on elements keep a thin outline; the open one, a solid one */}
          {pins.map(
            (p) =>
              p.element && (
                <div
                  key={`box-${p.n}`}
                  aria-hidden
                  className={cn(
                    "absolute rounded-[2px] shadow-[0_0_0_3px_var(--canvas)]",
                    open === p.n
                      ? "outline-2 outline-ink outline-solid"
                      : "outline-[1.5px] outline-ink/75 outline-solid",
                  )}
                  style={{
                    left: px(noteBox(p)!.x),
                    top: py(noteBox(p)!.y),
                    width: noteBox(p)!.w * k,
                    height: noteBox(p)!.h * k,
                  }}
                />
              ),
          )}
          {hoverEl && (
            <>
              <div
                aria-hidden
                className="absolute rounded-[2px] shadow-[0_0_0_3px_var(--canvas)] outline-2 outline-ink outline-solid"
                style={{ left: px(hoverEl.x), top: py(hoverEl.y), width: hoverEl.w * k, height: hoverEl.h * k }}
              />
              <div
                aria-hidden
                className="absolute rounded-[6px] bg-inverse px-[7px] font-mono text-[12px] leading-[18px] font-medium whitespace-nowrap text-on-inverse shadow-[0_0_0_1px_var(--canvas)]"
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
              className="pointer-events-auto absolute -mt-3.5 -ml-3.5 grid size-7 touch-none place-items-center rounded-full bg-inverse font-mono text-[13px] font-medium text-on-inverse shadow-[0_0_0_2px_var(--canvas),0_24px_64px_rgb(0_0_0/0.6),0_2px_8px_rgb(0_0_0/0.35)] outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text focus-visible:outline-solid motion-safe:animate-[pin-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
              style={markerAt(p)}
            >
              {p.n}
            </button>
          ))}
        </div>
      )}
      {openPin && (
        <div
          className="glass-strong pointer-events-auto fixed z-30 origin-top-left rounded-[14px] p-3 text-[13px] text-ink motion-safe:animate-[pop-in_150ms_cubic-bezier(0.23,1,0.32,1)]"
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
            ...(withPins.length && draft.vh ? { height: draft.vh } : {}),
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
                        {[p.element ? elementName(p.element) : "Spot", draft.label ?? widthName(draft.width)]
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
