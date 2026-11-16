"use client";

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/*
 * Motion for the top bar (design session "PIVOT navbar redesign", direction "1 · Floating capsule", approved
 * 2026-11-16). Only transform, opacity and clip-path move; reduced motion swaps states instantly (menus fade):
 * - M1: the current section is an inverse copy of the section list, clipped to that item; it slides (270ms).
 * - M2: scrolling down past 120px narrows the capsule from both sides and folds the search into its ⌘K pill;
 *   scrolling up 8px, or coming back near the top, restores it. The bar's height never changes.
 * - M3: the search field grows from the pill (or the phone's search icon) over its neighbours, which fade.
 * - M4: a section panel opens from its section; moving to another section morphs the panel's glass to the new
 *   size and place while the options crossfade.
 * - M5: on phones the dock slides away on downward scroll and comes back on upward scroll and at the page end.
 */

gsap.registerPlugin(CustomEase);

let eased = false;
/** The house eases. The names and values match the Library motion's, so either file may register them first. */
export function eases() {
  if (eased) return;
  CustomEase.create("pivot-out", "0.23,1,0.32,1");
  CustomEase.create("pivot-glide", "0.32,0.72,0,1");
  CustomEase.create("pivot-panel", ".45,0,.25,1");
  eased = true;
}

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function clip(t: number, r: number, b: number, l: number, round: number) {
  const p = (n: number) => `${Math.max(0, n)}px`;
  return `inset(${p(t)} ${p(r)} ${p(b)} ${p(l)} round ${round}px)`;
}

/**
 * Tweens a clip-path from where it is. The browser shortens a computed inset ("inset(0px round 999px)"), and a short
 * start would pair the wrong numbers with the target, so the start is spelled out with four values first.
 */
export function clipTo(el: Element, target: string, vars: gsap.TweenVars) {
  const cs = getComputedStyle(el).clipPath || "";
  const m = /^inset\(\s*([^)]*?)(?:\s+round\s+[^)]*)?\)$/.exec(cs);
  const round = (/round\s+([^)]*)\)/.exec(target) || [])[1];
  let from = target;
  if (m) {
    let v = m[1].trim().split(/\s+/);
    if (v.length === 1) v = [v[0], v[0], v[0], v[0]];
    else if (v.length === 2) v = [v[0], v[1], v[0], v[1]];
    else if (v.length === 3) v = [v[0], v[1], v[2], v[1]];
    from = `inset(${v.join(" ")}${round ? ` round ${round}` : ""})`;
  }
  return gsap.fromTo(el, { clipPath: from }, { clipPath: target, ...vars });
}

/**
 * Scroll direction with the brief's thresholds: `true` after 10px of downward scroll past 120px, `false` after 8px
 * upward or within 64px of the top. Calls `onChange` only when the answer flips; `onScroll` sees every move.
 */
export function useScrollDirection(onChange: (down: boolean) => void, onScroll?: (down: boolean) => void) {
  const change = useRef(onChange);
  const each = useRef(onScroll);
  useEffect(() => {
    change.current = onChange;
    each.current = onScroll;
  });
  useEffect(() => {
    let lastY = window.scrollY;
    let anchor = lastY;
    let dir = 0;
    let down = false;
    const on = () => {
      const y = window.scrollY;
      const d = y - lastY;
      lastY = y;
      if (!d) return;
      const nd = d > 0 ? 1 : -1;
      if (nd !== dir) {
        dir = nd;
        anchor = y - d;
      }
      const moved = Math.abs(y - anchor);
      let w = down;
      if (y < 64) w = false;
      else if (dir > 0 && y > 120 && moved >= 10) w = true;
      else if (dir < 0 && moved >= 8) w = false;
      if (w !== down) {
        down = w;
        change.current(w);
      }
      each.current?.(down);
    };
    // the bar was put back at rest (a width change): start over from here
    const reset = () => {
      down = false;
      lastY = anchor = window.scrollY;
      dir = 0;
    };
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("pivot:nav-reset", reset);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("pivot:nav-reset", reset);
    };
  }, []);
}

/**
 * M1: `ind` is an inverse copy of the items in `list`, laid out the same way; it is clipped to the item whose
 * `data-key` is `current`. The first placement, a resize, or coming back from no current item set it in place; a
 * change of item slides it (270ms). Once placed, `data-ready` on the list's parent hands the highlight from the item's
 * own fallback style to the copy.
 */
export function useIndicator(
  list: RefObject<HTMLElement | null>,
  ind: RefObject<HTMLElement | null>,
  current: string | null,
  round: number,
) {
  const last = useRef<string | null>(null);
  const place = (animate: boolean) => {
    const L = list.current;
    const I = ind.current;
    if (!L || !I || !L.getClientRects().length) return;
    const item = current ? L.querySelector<HTMLElement>(`:scope > [data-key="${current}"]`) : null;
    const W = I.offsetWidth;
    const H = I.offsetHeight;
    const target = item
      ? clip(
          item.offsetTop,
          W - item.offsetLeft - item.offsetWidth,
          H - item.offsetTop - item.offsetHeight,
          item.offsetLeft,
          round,
        )
      : clip(0, W, 0, 0, round);
    // with no current item the copy is hidden too: a clip of zero width still leaves a hairline
    gsap.set(I, { autoAlpha: item ? 1 : 0 });
    if (animate && !reducedMotion()) {
      eases();
      clipTo(I, target, { duration: 0.27, ease: "pivot-panel", overwrite: "auto" });
    } else gsap.set(I, { clipPath: target, overwrite: "auto" });
    L.parentElement?.setAttribute("data-ready", "");
  };

  useLayoutEffect(() => {
    place(!!last.current && !!current && last.current !== current);
    last.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Resizes set it in place; the observer's first call and same-size calls don't, so they never cut a slide short.
  const placeRef = useRef(place);
  useEffect(() => {
    placeRef.current = place;
  });
  useEffect(() => {
    const L = list.current;
    if (!L) return;
    let size = "";
    const ro = new ResizeObserver(() => {
      const next = `${L.offsetWidth}x${L.offsetHeight}`;
      if (next === size) return;
      size = next;
      placeRef.current(false);
    });
    ro.observe(L);
    document.fonts?.ready.then(() => placeRef.current(false));
    return () => ro.disconnect();
  }, [list]);
}
