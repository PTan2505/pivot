"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef, type RefObject } from "react";

/*
 * Motion for the Library landing and the References list (design session "PIVOT Library and References redesign",
 * direction "Index rail", motion round 2 approved 2026-11-15). Every move takes an object from where it was to where
 * it lands, in 220–420ms, and never blocks a click:
 * - M1: scrolling shrinks the display title into the compact head's title (scrubbed), the compact head's glass and
 *   controls fade in over the last quarter, the big head's controls fade out first, the folders recede one by one.
 * - M2: the References folder opens into the page: its name grows into the title, its sheets fly into the first
 *   cards' screenshots; Back shrinks the title into the folder's name.
 * - M3: a facet toggle: leaving cards fade and shrink, staying cards glide (Flip), new ones arrive.
 * - M4: grid <-> list: each screenshot morphs into its row's thumbnail and back.
 * - D1 rail selection slides, D2 counts roll, D4 first load rise (D3, the hover lift, is CSS).
 * GSAP moves wrappers only (title, folder wrappers, card cells, screenshot frames); it reads the folder's sheets but
 * never animates them, and never touches the screenshot inside a frame.
 */

gsap.registerPlugin(ScrollTrigger, Flip, CustomEase, useGSAP);

let eased = false;
function eases() {
  if (eased) return;
  CustomEase.create("pivot-out", "0.23,1,0.32,1");
  CustomEase.create("pivot-glide", "0.32,0.72,0,1");
  CustomEase.create("pivot-panel", ".45,0,.25,1");
  eased = true;
}

export const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The top bar's height: it is pinned at every width, and the top bar measures it into --topbar-h. */
function topbar() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 72;
}

function inView(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

type Box = { left: number; top: number; width: number; height: number };
const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** The box of an element's words (a block's own box can be much wider than its text). */
function textBox(el: Element): Box {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  return boxOf(r.width ? r : el.getBoundingClientRect());
}

/**
 * Moves `el` so that its `content` box (its own box by default) sits exactly on `from`, then lets it glide home.
 * Transform only, so nothing around it reflows; works inside scaled ancestors (the glass folder's stage).
 */
function morphFrom(
  el: HTMLElement,
  from: Box,
  opts: { content?: Box; uniform?: boolean; duration: number; delay?: number; inline?: boolean },
) {
  const e = el.getBoundingClientRect();
  const c = opts.content ?? boxOf(e);
  if (!c.width || !c.height) return null;
  // how much the ancestors scale it: translations are applied in its own (unscaled) space
  const k = el.offsetWidth ? e.width / el.offsetWidth : 1;
  const sx = from.width / c.width;
  const sy = opts.uniform ? sx : from.height / c.height;
  // with the origin at the element's top-left, a point p lands on e + s(p - e) + t
  const tx = from.left - e.left - sx * (c.left - e.left);
  const ty = from.top - e.top - sy * (c.top - e.top);
  return gsap.fromTo(
    el,
    {
      x: tx / k,
      y: ty / k,
      scaleX: sx,
      scaleY: sy,
      transformOrigin: "0 0",
      zIndex: 5,
      ...(opts.inline ? { display: "inline-block" } : {}),
    },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      duration: opts.duration,
      delay: opts.delay ?? 0,
      ease: "pivot-glide",
      force3D: false,
      clearProps: "transform,transformOrigin,zIndex,display",
    },
  );
}

/**
 * M1 (direction D, "Rail header, no strip", approved 2026-11-17): from lg, the display title collapses into the
 * header of the sticky rail while the page scrolls (scrubbed), the header fades in over the last quarter, and the
 * folders recede. Below lg there is no rail: once the title has scrolled past the bar, the page docks its title into
 * the top bar's row (`onDocked`). Reduced motion: the rail header fades in where the title leaves (150ms).
 */
export function useCondensingHead(
  refs: {
    title: RefObject<HTMLElement | null>;
    rail: RefObject<HTMLElement | null>;
    railHead: RefObject<HTMLElement | null>;
    railTitle: RefObject<HTMLElement | null>;
    controls: RefObject<HTMLElement | null>;
    shelf: RefObject<HTMLElement | null>;
  },
  onDocked: (docked: boolean) => void,
  deps: unknown[],
) {
  const docked = useRef(onDocked);
  useLayoutEffect(() => {
    docked.current = onDocked;
  });
  useGSAP(
    () => {
      const title = refs.title.current;
      if (!title) return;
      eases();
      const rail = refs.rail.current;
      const head = refs.railHead.current;
      const rt = refs.railTitle.current;
      const controls = refs.controls.current;
      const shelf = refs.shelf.current;
      // the rail sticks this far below the bar
      const GAP = 16;
      const mm = gsap.matchMedia();
      mm.add(
        {
          desk: "(min-width: 64rem)",
          full: "(prefers-reduced-motion: no-preference)",
        },
        (ctx) => {
          const desk = !!ctx.conditions?.desk;
          const full = !!ctx.conditions?.full;
          if (!desk || !rail || !head || !rt) {
            // phones and tablets: dock the title into the top bar once it has gone under it
            ScrollTrigger.create({
              trigger: title,
              start: () => `bottom top+=${topbar()}`,
              invalidateOnRefresh: true,
              onEnter: () => docked.current(true),
              onLeaveBack: () => docked.current(false),
            });
            return () => docked.current(false);
          }
          if (!full) {
            gsap.set(head, { opacity: 0 });
            ScrollTrigger.create({
              trigger: title,
              start: () => `bottom top+=${topbar()}`,
              invalidateOnRefresh: true,
              onEnter: () => gsap.to(head, { opacity: 1, duration: 0.15 }),
              onLeaveBack: () => gsap.to(head, { opacity: 0, duration: 0.15 }),
            });
            return;
          }
          // Where the title rests, measured without its transform; refreshed with ScrollTrigger.
          let rest: { left: number; text: number; bottom: number } | null = null;
          const restOf = () => {
            if (!rest) {
              const keep = {
                x: gsap.getProperty(title, "x"),
                y: gsap.getProperty(title, "y"),
                scale: gsap.getProperty(title, "scale"),
              };
              gsap.set(title, { x: 0, y: 0, scale: 1 });
              const t = textBox(title);
              const e = title.getBoundingClientRect();
              rest = { left: t.left, text: t.top + t.height + window.scrollY, bottom: e.bottom + window.scrollY };
              gsap.set(title, keep);
            }
            return rest;
          };
          const scale = () => parseFloat(getComputedStyle(rt).fontSize) / parseFloat(getComputedStyle(title).fontSize);
          const tl = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: title,
              start: () => `top top+=${topbar()}`,
              end: () => `bottom+=24 top+=${topbar()}`,
              scrub: 0.3,
              invalidateOnRefresh: true,
              onRefreshInit: () => {
                rest = null;
              },
            },
          });
          // Where the rail header's words are when the scrub ends: the rail is stuck GAP below the bar by then, or
          // still on its way up; its header's place inside it never changes.
          const target = () => {
            const end = tl.scrollTrigger?.end ?? 0;
            const t = textBox(rt);
            const r = rail.getBoundingClientRect();
            const railTop = Math.max(topbar() + GAP, r.top + window.scrollY - end);
            return { left: t.left, bottom: railTop + (t.top + t.height - r.top), end };
          };
          tl.fromTo(
            title,
            { x: 0, y: 0, scale: 1 },
            {
              x: () => target().left - restOf().left,
              // the scale's origin is the title's bottom-left; its words hang a little below that edge
              y: () => {
                const g = target();
                const r = restOf();
                return g.bottom - (r.bottom - g.end) - (r.text - r.bottom) * scale();
              },
              scale,
              transformOrigin: "0% 100%",
              force3D: false,
              duration: 1,
            },
            0,
          )
            .fromTo(title, { opacity: 1 }, { opacity: 0, duration: 0.25 }, 0.75)
            .fromTo(head, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.75);
          if (controls) tl.fromTo(controls, { opacity: 1 }, { opacity: 0, duration: 0.35 }, 0.3);
          const folders = shelf?.querySelectorAll('[role="listitem"]');
          if (shelf && folders?.length)
            gsap.to(folders, {
              scale: 0.94,
              y: -16,
              opacity: 0,
              transformOrigin: "50% 0%",
              ease: "none",
              stagger: 0.06,
              scrollTrigger: {
                trigger: shelf,
                start: () => `top top+=${topbar() + 40}`,
                end: () => `bottom top+=${topbar()}`,
                scrub: 0.3,
                invalidateOnRefresh: true,
              },
            });
        },
      );
      // focus moved by the keyboard never lands under the bar (WCAG 2.4.11): nothing else is pinned at the top now
      const pad = () => document.documentElement.style.setProperty("scroll-padding-top", `${topbar() + GAP}px`);
      pad();
      ScrollTrigger.addEventListener("refresh", pad);
      const refresh = () => ScrollTrigger.refresh();
      window.addEventListener("load", refresh);
      const t = window.setTimeout(refresh, 400);
      return () => {
        window.removeEventListener("load", refresh);
        window.clearTimeout(t);
        mm.revert();
        ScrollTrigger.removeEventListener("refresh", pad);
        document.documentElement.style.removeProperty("scroll-padding-top");
      };
    },
    { dependencies: deps, revertOnUpdate: true },
  );
}

/** Re-measures the scroll animations after the page's height changed (view, filters, the Library's View choice). */
export function refreshScroll() {
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

// ---------- M2: the References folder opens into the page ----------

const REFERENCES = "type-reference";
/** What the clicked folder looked like, for the References page to grow out of (kept 300ms at most). */
let arrival: { at: number; label: Box | null; sheets: { id: string; box: Box }[] } | null = null;
/** Where the References title rested (page coordinates), for Back to shrink into the folder's name. */
let departure: { box: Box } | null = null;

/**
 * Opens a folder. The References folder hands its name and visible sheets to the page it opens (`ids` follow the
 * folder's files, in order); other folders, and reduced motion, fade the page out first.
 */
export function openFolder(
  page: RefObject<HTMLElement | null>,
  shelf: HTMLElement | null,
  folderId: string,
  ids: string[],
  go: () => void,
) {
  const folder = shelf?.querySelector(`[data-folder-id="${CSS.escape(folderId)}"]`);
  if (folderId !== REFERENCES || !folder || reduced()) return leavePage(page, go);
  eases();
  const label = folder.querySelector(".gf-title");
  const sheets = [...folder.querySelectorAll(".gf-sheet-slot")].flatMap((slot, i) => {
    const sheet = slot.querySelector(".gf-sheet") ?? slot;
    return ids[i] && inView(sheet) ? [{ id: ids[i], box: boxOf(sheet.getBoundingClientRect()) }] : [];
  });
  arrival = { at: performance.now(), label: label ? textBox(label) : null, sheets };
  gsap.to(
    [...shelf!.querySelectorAll('[role="listitem"]')].filter((f) => f !== folder),
    { opacity: 0, scale: 0.97, duration: 0.15, ease: "pivot-out" },
  );
  go();
}

/** Fades the page out, then goes (folders other than References). */
export function leavePage(scope: RefObject<HTMLElement | null>, go: () => void) {
  const root = scope.current;
  if (!root) return go();
  gsap.to(root, { opacity: 0, duration: reduced() ? 0.1 : 0.14, onComplete: go });
}

/** Cards and head on screen rise in (D4, and whenever a page arrives without a shared element). */
function rise(root: HTMLElement) {
  gsap.fromTo(
    root.querySelectorAll("[data-enter]"),
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.18, ease: "pivot-out", stagger: 0.04, clearProps: "transform,opacity" },
  );
  gsap.fromTo(
    [...root.querySelectorAll("[data-flip-id]")].filter(inView).slice(0, 9),
    { opacity: 0, y: 12 },
    {
      opacity: 1,
      y: 0,
      duration: 0.3,
      ease: "pivot-out",
      stagger: 0.035,
      delay: 0.04,
      clearProps: "transform,opacity",
    },
  );
}

/** M2 forward: the title grows out of the folder's name, the sheets land in the first cards' frames. */
function arrive(root: HTMLElement, title: HTMLElement | null, a: NonNullable<typeof arrival>) {
  const tl = gsap.timeline();
  const words = morphTarget(title);
  if (words && a.label) {
    const t = morphFrom(words, a.label, { content: textBox(words), uniform: true, duration: 0.42 });
    if (t) tl.add(t, 0);
  }
  const landed: HTMLElement[] = [];
  for (const s of a.sheets) {
    const cell = root.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(s.id)}"]`);
    const frame = cell?.querySelector<HTMLElement>("[data-frame]");
    if (!cell || !frame || !inView(frame)) continue;
    const t = morphFrom(frame, s.box, { duration: 0.42 });
    if (t) {
      tl.add(t, 0);
      landed.push(cell);
    }
  }
  const rest = [...root.querySelectorAll<HTMLElement>("[data-flip-id]")]
    .filter((c) => !landed.includes(c) && inView(c))
    .slice(0, 9);
  if (rest.length)
    tl.fromTo(
      rest,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.3, ease: "pivot-out", stagger: 0.035, clearProps: "transform,opacity" },
      0.12,
    );
  const captions = landed.flatMap((c) => [...c.querySelectorAll("[data-caption]")]);
  if (captions.length)
    tl.fromTo(captions, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: "pivot-out", clearProps: "opacity" }, 0.2);
  const around = [...root.querySelectorAll<HTMLElement>("[data-enter], [data-arrive]")].filter(
    (el) => !title || !el.contains(title),
  );
  if (around.length) tl.fromTo(around, { opacity: 0 }, { opacity: 1, duration: 0.2, clearProps: "opacity" }, 0.1);
  // a click or a key finishes it at once (on click, not pointerdown, so the card under the pointer doesn't jump
  // between press and release)
  const finish = () => tl.progress(1);
  window.addEventListener("click", finish, { capture: true });
  window.addEventListener("keydown", finish, { capture: true });
  tl.eventCallback("onComplete", () => {
    window.removeEventListener("click", finish, { capture: true });
    window.removeEventListener("keydown", finish, { capture: true });
  });
  // the folder that had focus is gone: the page title takes it
  if (title && (!document.activeElement || document.activeElement === document.body))
    title.focus({ preventScroll: true });
}

/** M2 moves the words of the title (its `[data-morph]` span), so it never fights M1, which moves the title itself. */
const morphTarget = (title: HTMLElement | null) => title?.querySelector<HTMLElement>("[data-morph]") ?? title;

/** M2 back: the folder's name grows back down out of where the References title was. */
function returnHome(root: HTMLElement, from: Box) {
  const label = root.querySelector<HTMLElement>(`[data-folder-id="${REFERENCES}"] .gf-title`);
  if (!label) return false;
  // focus goes back to the folder the page came from
  if (!document.activeElement || document.activeElement === document.body)
    root.querySelector<HTMLElement>(`[data-folder-id="${REFERENCES}"] .gf-hit`)?.focus({ preventScroll: true });
  const box = { ...from, top: from.top - window.scrollY, left: from.left - window.scrollX };
  return !!morphFrom(label, box, { content: textBox(label), uniform: true, duration: 0.38, inline: true });
}

/**
 * Once per page, when its list is ready: the References page grows out of the folder just clicked (M2), the Library
 * takes the title back into the folder (M2 back), and any other arrival rises in (D4).
 */
export function useEntrance(
  scope: RefObject<HTMLElement | null>,
  title: RefObject<HTMLElement | null>,
  pageKey: string,
  ready: boolean,
  animate: boolean,
) {
  const done = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || done.current === pageKey) return;
    // a page left with leavePage comes back visible at once, while it loads or if loading fails, animated or not
    gsap.set(root, { clearProps: "opacity" });
    if (!ready) return;
    const before = done.current;
    done.current = pageKey;
    const a = arrival;
    arrival = null;
    if (!animate) return;
    eases();
    const isReferences = pageKey.endsWith(":reference");
    // where this page's title rests, before anything moves it
    const words = morphTarget(title.current);
    if (isReferences && words) {
      const b = textBox(words);
      departure = { box: { ...b, top: b.top + window.scrollY, left: b.left + window.scrollX } };
    }
    if (reduced()) {
      gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: a ? 0.2 : 0.14 });
      return;
    }
    if (isReferences && a && performance.now() - a.at < 300) return arrive(root, title.current, a);
    const back = before?.endsWith(":reference") && departure && window.scrollY < 40;
    if (back && departure && returnHome(root, departure.box)) {
      gsap.fromTo(
        [...root.querySelectorAll("[data-flip-id]")].filter(inView).slice(0, 9),
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.3, ease: "pivot-out", stagger: 0.035, clearProps: "transform,opacity" },
      );
      return;
    }
    rise(root);
  }, [scope, title, pageKey, ready, animate]);
}

// ---------- M3: filter reflow ----------

/**
 * Attach `grid` to the list and call `capture` right before a facet toggle changes it (with a test for which cards
 * stay): leaving cards fade and shrink at once, and when the new list renders the staying cards glide to their new
 * places and new ones arrive. A toggle while cards move starts from where they are.
 */
export function useFilterFlip(items: unknown) {
  const grid = useRef<HTMLDivElement>(null);
  const pending = useRef<{ state: Flip.FlipState; at: number } | null>(null);
  const running = useRef<gsap.core.Animation | null>(null);

  const capture = (stays: (id: string) => boolean) => {
    const root = grid.current;
    if (!root) return;
    eases();
    running.current?.kill();
    const cells = [...root.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")].filter(inView);
    pending.current = { state: Flip.getState(cells), at: performance.now() };
    root.setAttribute("data-flipping", "");
    if (reduced()) {
      gsap.to(root, { opacity: 0.4, duration: 0.07 });
      return;
    }
    gsap.to(
      cells.filter((c) => !stays(c.dataset.flipId ?? "")),
      { opacity: 0, scale: 0.96, duration: 0.16, ease: "pivot-out", stagger: 0.02, overwrite: true },
    );
  };

  useLayoutEffect(() => {
    const root = grid.current;
    const p = pending.current;
    if (!p) return;
    // used once, even when the list it was for never rendered (no results)
    pending.current = null;
    if (!root) return;
    const cells = [...root.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")];
    const done = () => {
      root.removeAttribute("data-flipping");
      gsap.set(cells, { clearProps: "opacity,transform" });
      ScrollTrigger.refresh();
    };
    if (reduced()) {
      running.current = gsap.to(root, { opacity: 1, duration: 0.15, onComplete: done });
      return;
    }
    gsap.set(cells, { opacity: 1, scale: 1 });
    // brief timings, counted from the toggle: cards move from 80ms, new ones arrive from 180ms (the list may arrive
    // later than that; then they start at once)
    const since = (performance.now() - p.at) / 1000;
    const wait = Math.max(0, 0.08 - since);
    const enter = Math.max(0, 0.18 - since);
    running.current = Flip.from(p.state, {
      targets: cells.filter(inView),
      duration: 0.34,
      ease: "pivot-glide",
      delay: wait,
      onEnter: (els) => {
        gsap.fromTo(
          els.slice(0, 6),
          { opacity: 0, scale: 0.96, y: 8 },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.26,
            ease: "pivot-out",
            stagger: 0.04,
            delay: enter,
            clearProps: "transform,opacity",
          },
        );
      },
      onComplete: done,
    });
  }, [items]);

  return { grid, capture };
}

// ---------- M4: grid <-> list ----------

/** Attach `list` to the list; `morph(switchView)` records the screenshots, switches, and morphs them into place. */
export function useViewMorph(view: string) {
  const list = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const pending = useRef<{ frames: Map<string, Box>; anchor: { id: string; top: number } | null } | null>(null);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = list.current;
    const p = pending.current;
    pending.current = null;
    if (!root || !p) return;
    // keep the first visible item where it was
    const a = p.anchor;
    const el = a && root.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(a.id)}"]`);
    if (a && el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
    if (reduced()) {
      gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.15 });
      return;
    }
    eases();
    for (const cell of [...root.querySelectorAll<HTMLElement>("[data-flip-id]")].filter(inView)) {
      const box = p.frames.get(cell.dataset.flipId ?? "");
      const frame = cell.querySelector<HTMLElement>("[data-frame]");
      if (box && frame && morphFrom(frame, box, { duration: 0.38 })) {
        // the words wait until the screenshot has nearly landed
        gsap.fromTo(
          cell.querySelectorAll("[data-caption]"),
          { opacity: 0 },
          { opacity: 1, duration: 0.16, ease: "pivot-out", delay: 0.26, clearProps: "opacity" },
        );
      } else {
        gsap.fromTo(cell, { opacity: 0 }, { opacity: 1, duration: 0.16, delay: 0.2, clearProps: "opacity" });
      }
    }
  }, [view]);
  const morph = (switchView: () => void) => {
    const root = list.current;
    if (root) {
      const cells = [...root.querySelectorAll<HTMLElement>("[data-flip-id]")].filter(inView);
      const frames = new Map<string, Box>();
      for (const c of cells) {
        const f = c.querySelector("[data-frame]");
        if (f) frames.set(c.dataset.flipId ?? "", boxOf(f.getBoundingClientRect()));
      }
      const firstVisible = cells.find((c) => c.getBoundingClientRect().bottom > topbar() + 56);
      pending.current = {
        frames,
        anchor: firstVisible
          ? { id: firstVisible.dataset.flipId ?? "", top: firstVisible.getBoundingClientRect().top }
          : null,
      };
    }
    switchView();
  };
  return { list, morph };
}

// ---------- D1, D2 ----------

/**
 * D1: in a single-choice option list, a highlight (`[data-ind]`) slides to the pressed option. Until it is placed the
 * pressed option keeps its own background (the list gets `data-sliding` once it is).
 */
function placeIndicator(root: HTMLElement, animate: boolean) {
  const ind = root.querySelector<HTMLElement>("[data-ind]");
  if (!ind) return;
  const on = root.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!on || !on.offsetHeight) return void gsap.set(ind, { opacity: 0 });
  const vars = { y: on.offsetTop - ind.offsetTop, height: on.offsetHeight, opacity: 1 };
  root.setAttribute("data-sliding", "");
  if (animate && !reduced()) {
    eases();
    gsap.to(ind, { ...vars, duration: 0.27, ease: "pivot-panel", overwrite: "auto" });
  } else gsap.set(ind, vars);
}

export function useSlidingIndicator(box: RefObject<HTMLElement | null>, value: string) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    placeIndicator(root, placed.current);
    placed.current = true;
  }, [box, value]);
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    // a rail that was hidden (phones, the popover) gets placed when it shows; never in the middle of a slide
    const ro = new ResizeObserver(() => {
      const ind = root.querySelector("[data-ind]");
      if (!ind || !gsap.isTweening(ind)) placeIndicator(root, false);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [box]);
}

/** D2: the number in `box` (its first child) rolls up or down to a new value. */
export function useRoll(box: RefObject<HTMLElement | null>, value: number) {
  const prev = useRef(value);
  useLayoutEffect(() => {
    const root = box.current;
    const before = prev.current;
    prev.current = value;
    const cur = root?.firstElementChild as HTMLElement | null;
    if (!root || !cur || before === value || reduced()) return;
    eases();
    const old = cur.cloneNode() as HTMLElement;
    old.textContent = String(before);
    old.setAttribute("aria-hidden", "true");
    root.append(old);
    const dir = value > before ? 1 : -1;
    gsap.fromTo(
      old,
      { yPercent: 0, opacity: 1 },
      {
        yPercent: -100 * dir,
        opacity: 0,
        duration: 0.22,
        ease: "pivot-out",
        overwrite: true,
        onComplete: () => old.remove(),
      },
    );
    gsap.fromTo(
      cur,
      { yPercent: 100 * dir, opacity: 0 },
      { yPercent: 0, opacity: 1, duration: 0.22, ease: "pivot-out", overwrite: true, clearProps: "transform,opacity" },
    );
  }, [box, value]);
}
