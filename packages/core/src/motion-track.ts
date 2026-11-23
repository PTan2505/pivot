import {
  compactEasing,
  FIT_NAMED_RMS,
  fitEasing,
  fmt,
  FRAME_MS,
  linearFit,
  median,
  MOTION_TRACK_FPS,
  parseBlur,
  parseTransform,
  tidyValue,
} from "./motion-fit";

/**
 * A reference's motion as numbers: what moves, when, how far, for how long and on which curve, read while "Record
 * motion" films the page scrolling (capture.ts) and stored as the `motion-track` asset. Every item says where its
 * numbers come from: `exact` when the page declared them (a CSS transition or animation, a Web Animation, a GSAP
 * tween or ScrollTrigger), `measured` when PIVOT watched the element change frame by frame and fitted the samples.
 */

// ---------------------------------------------------------------- what the probes return (motion-probe.ts)

export interface ProbeState {
  y: number;
  dy: number;
  tf: string;
  op: string;
  clip?: string;
  filt?: string;
}
export interface ProbeChange extends ProbeState {
  id: number;
  /** Visible area, px². */
  a: number;
  w: number;
  h: number;
  pos: string;
  /** The element's state one frame earlier, sent the first time it changes. */
  prev?: ProbeState;
}
export interface ProbeAnimation {
  f: number;
  t: number;
  at: number;
  type: string;
  timeline: string;
  duration?: number;
  delay?: number;
  easing?: string;
  iterations?: number | "infinite";
  props?: { property: string; values: (string | null)[] }[];
  keyframeEasing?: string | null;
  el?: number;
  pseudo?: string;
}
export interface ProbeFrame {
  f: number;
  /** The page's clock, ms since the recording started. */
  t: number;
  /** How far the page has scrolled, px (followed through a smooth scroller's content when there is one). */
  at: number;
  ch: ProbeChange[];
  anims: ProbeAnimation[];
  changed: number;
  visible: number;
  media?: [number, number];
}
export interface ProbeElement {
  name: string;
  selector: string;
  parent: number;
  /** The element (its own id) or ancestor that is `position: fixed`, 0 when none. */
  fixedIn: number;
}
export interface LibraryTarget {
  name: string;
  selector: string;
}
export interface LibraryProp {
  property: string;
  to: string | number;
}
export interface LibraryTween {
  duration?: number;
  delay?: number;
  ease?: string;
  stagger?: number;
  props: LibraryProp[];
  from?: boolean;
  count: number;
  target: LibraryTarget | null;
  scrollTrigger?: { start?: number; end?: number; scrub?: unknown };
  f: number;
  t: number;
  at: number;
}
export interface LibraryTrigger {
  start?: number;
  end?: number;
  scrub?: unknown;
  pin?: LibraryTarget;
  trigger?: LibraryTarget | null;
  target?: LibraryTarget;
  count: number;
  props: LibraryProp[];
  duration?: number;
  ease?: string;
  from?: boolean;
}

/** Everything a recording gathered, for `buildMotionTrack`. */
export interface MotionRecording {
  viewport: { width: number; height: number };
  /** `wheel` when a smooth-scroll library had to be scrolled with the mouse wheel. */
  method: "scroll" | "wheel";
  frames: ProbeFrame[];
  elements: Record<string, ProbeElement>;
  libraries: string[];
  tweens: LibraryTween[];
  triggers: LibraryTrigger[];
  lenis?: { lerp?: number; duration?: number };
  /** The most changed elements read per frame. */
  cap: number;
  /** Why the recording stopped before the bottom, if it did. */
  stopped?: "budget" | "stuck";
}

// ---------------------------------------------------------------- what is stored and served

export interface MotionChange {
  property: string;
  /** From, through up to two values in between, to. A GSAP value read from its tween has only its end. */
  values: string[];
}
export interface MotionItem {
  /** `M1`, `M2`…, most visible first. */
  id: string;
  /** The same motion gets the same key in another recording of the page (element, properties, trigger). */
  key: string;
  source: "exact" | "measured";
  /** CSS transition, CSS animation, Web Animation, GSAP tween, ScrollTrigger, or measured. */
  via: string;
  trigger: {
    kind: "load" | "scroll" | "always";
    /** The scroll position where it started. */
    at?: number;
    /** A scroll range for scroll-linked motion and pins. */
    from?: number;
    to?: number;
    /** The same motion on several elements, started at these scroll positions. */
    spread?: [number, number];
  };
  target: { name: string; selector: string; count: number };
  changes: MotionChange[];
  durationMs?: number;
  delayMs?: number | [number, number];
  easing?: string;
  /** The fit's error when the easing was measured (0 is a perfect match); "custom" when above 0.03. */
  fitRms?: number;
  staggerMs?: number;
  iterations?: number | "infinite";
  /** Follows the scroll position rather than time. */
  scrubbed?: boolean;
  /** Moves this many px per px scrolled; `smoothed` when it trails the scroll (lerped). */
  parallax?: { ratio: number; smoothed?: boolean };
  /** Held at this viewport y while the page scrolls `trigger.from`–`to`. */
  pinnedAt?: number;
  /** Fixed at this viewport y for the whole page. */
  fixedAt?: number;
  /** Measured as a jump between two frames: no duration or curve to tell. */
  instant?: boolean;
  /** Largest visible area, px², which orders the items. */
  area: number;
}
export interface MotionTrack {
  version: 1;
  fps: number;
  viewport: { width: number; height: number };
  method: "scroll" | "wheel";
  frames: number;
  /** How far the recording scrolled, px. */
  scrolledTo: number;
  libraries: string[];
  lenis?: { lerp?: number; duration?: number };
  items: MotionItem[];
  /** All items found; `items` keeps at most `MAX_TRACK_ITEMS`. */
  itemsTotal: number;
  limits: string[];
  stats: { changedPerFrameMedian: number; changedPerFrameMax: number; framesOverCap: number };
}

export const MAX_TRACK_ITEMS = 200;
/** Items in a reply to Claude (`get_reference`); the rest are counted. */
export const MOTION_TABLE_ITEMS = 24;

// ---------------------------------------------------------------- measured motion

type Key = "tx" | "ty" | "sc" | "rot" | "op" | "blur";
const CHANNELS: { key: Key; property: string; unit: string; eps: number; amp: number }[] = [
  { key: "tx", property: "translateX", unit: "px", eps: 0.5, amp: 2 },
  { key: "ty", property: "translateY", unit: "px", eps: 0.5, amp: 2 },
  { key: "sc", property: "scale", unit: "", eps: 0.002, amp: 0.01 },
  { key: "rot", property: "rotate", unit: "deg", eps: 0.2, amp: 1 },
  { key: "op", property: "opacity", unit: "", eps: 0.005, amp: 0.05 },
  { key: "blur", property: "blur", unit: "px", eps: 0.1, amp: 0.5 },
];
/** Smaller boxes are left out of measured motion: icons, dots and text runs say little about a page's motion. */
const MIN_AREA = 1500;
/** Measured runs longer than this are not fitted to a curve (a loop, a slow drift). */
const MAX_FIT_MS = 4000;

type Values = Record<Key, number> & { dy: number; y: number };
const valuesOf = (s: ProbeState): Values => {
  const t = parseTransform(s.tf);
  return {
    tx: t.translateX,
    ty: t.translateY,
    sc: t.scale,
    rot: t.rotate,
    op: Number(s.op ?? 1),
    blur: parseBlur(s.filt),
    dy: s.dy,
    y: s.y,
  };
};

interface Track {
  el: number;
  pts: Map<number, Values>;
  area: number;
  pos: string;
}

interface Segment {
  /** The samples of a run, for merging scroll-linked runs (scroll position, value). */
  xs?: number[];
  ys?: number[];
  el: number;
  kind: "time" | "scroll" | "pin" | "fixed";
  key?: Key;
  vFrom: number;
  vTo: number;
  tPrev: number;
  tLast: number;
  atStart: number;
  atEnd: number;
  area: number;
  ratio?: number;
  smoothed?: boolean;
  scrollFrom?: number;
  scrollTo?: number;
  y?: number;
  fit?: { easing: string; rms: number; startMs: number; durationMs: number };
}

function tracksOf(frames: ProbeFrame[]) {
  const tracks = new Map<number, Track>();
  for (const fr of frames)
    for (const c of fr.ch) {
      let tr = tracks.get(c.id);
      if (!tr) {
        tr = { el: c.id, pts: new Map(), area: 0, pos: c.pos };
        tracks.set(c.id, tr);
        if (c.prev) tr.pts.set(fr.f - 1, valuesOf(c.prev));
      }
      tr.pts.set(fr.f, valuesOf(c));
      tr.area = Math.max(tr.area, c.a);
      tr.pos = c.pos || tr.pos;
    }
  return tracks;
}

/** Splits the frames where a value changed into runs; gaps of up to two frames are bridged. */
function runsOf(frames: number[], changed: Set<number>) {
  const out: number[][] = [];
  let cur: number[] = [];
  for (const f of frames) {
    if (!changed.has(f)) continue;
    if (cur.length && f - cur[cur.length - 1] > 3) {
      out.push(cur);
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length) out.push(cur);
  return out;
}

function segmentsOf(tr: Track, timeOf: Map<number, number>, atOf: Map<number, number>): Segment[] {
  const fs = [...tr.pts.keys()].sort((a, b) => a - b);
  const pt = (f: number) => tr.pts.get(f)!;
  const valueAt = (f: number, key: Key) => {
    let v: number | undefined;
    for (const g of fs) {
      if (g > f) break;
      v = pt(g)[key];
    }
    return v;
  };
  const at = (f: number) => atOf.get(f) ?? 0;
  const out: Segment[] = [];

  // a pin: the document position moves one for one with the scroll, so it stays put on screen
  const moved = fs.filter((f, i) => i > 0 && Math.abs(pt(f).dy - pt(fs[i - 1]).dy) > 0.5);
  if (moved.length >= 3) {
    const ratios: number[] = [];
    for (let i = 1; i < fs.length; i++) {
      const dat = at(fs[i]) - at(fs[i - 1]);
      const ddy = pt(fs[i]).dy - pt(fs[i - 1]).dy;
      if (Math.abs(dat) > 0.5 && Math.abs(ddy) > 0.5) ratios.push(ddy / dat);
    }
    if (ratios.length && Math.abs(median(ratios) - 1) < 0.05) {
      const y = median(moved.map((f) => pt(f).y));
      out.push({
        el: tr.el,
        kind: tr.pos === "fixed" ? "fixed" : "pin",
        vFrom: 0,
        vTo: 0,
        tPrev: timeOf.get(moved[0] - 1) ?? 0,
        tLast: timeOf.get(moved[moved.length - 1]) ?? 0,
        atStart: pt(fs[0]).dy - y,
        atEnd: pt(fs[fs.length - 1]).dy - y,
        area: tr.area,
        y,
        scrollFrom: pt(fs[0]).dy - y,
        scrollTo: pt(fs[fs.length - 1]).dy - y,
      });
      return out;
    }
  }

  for (const ch of CHANNELS) {
    const runs: Segment[] = [];
    const changed = new Set<number>();
    for (let i = 1; i < fs.length; i++)
      if (Math.abs(pt(fs[i])[ch.key] - pt(fs[i - 1])[ch.key]) > ch.eps) changed.add(fs[i]);
    for (const run of runsOf(fs, changed)) {
      const fPrev = run[0] - 1;
      let fLast = run[run.length - 1];
      while (tr.pts.has(fLast + 1) && Math.abs(pt(fLast + 1)[ch.key] - pt(fLast)[ch.key]) > 1e-6) fLast++;
      const vFrom = valueAt(fPrev, ch.key) ?? pt(run[0])[ch.key];
      const vTo = pt(fLast)[ch.key];
      const seg: Segment = {
        el: tr.el,
        kind: "time",
        key: ch.key,
        vFrom,
        vTo,
        tPrev: timeOf.get(fPrev) ?? 0,
        tLast: timeOf.get(fLast) ?? 0,
        atStart: at(fPrev),
        atEnd: at(fLast),
        area: tr.area,
      };
      // time or scroll: motion that goes on while the page rests plays in time; motion that only happens while
      // scrolling, in step with it, is scroll-linked
      const resting = (f: number) => Math.abs(at(f) - at(f - 1)) < 0.5;
      const restChanges = run.filter(resting).length;
      let restFrames = 0;
      for (let f = fPrev + 1; f <= fLast; f++) if (resting(f)) restFrames++;
      const frames = [fPrev, ...Array.from({ length: fLast - run[0] + 1 }, (_, i) => run[0] + i)];
      const xs = frames.map(at);
      const ys = frames.map((f) => valueAt(f, ch.key) ?? vFrom);
      seg.xs = xs;
      seg.ys = ys;
      const line = xs.length >= 3 ? linearFit(xs, ys) : { slope: 0, intercept: 0, r2: 0 };
      if (restChanges >= 2 && restChanges >= 0.3 * restFrames) seg.kind = "time";
      else if (restFrames >= 3 && restChanges <= 1 && line.r2 > 0.9) seg.kind = "scroll";
      else if (line.r2 >= 0.998 && xs.length >= 6) seg.kind = "scroll";
      // trailing the scroll (a lerped parallax) keeps moving at each rest, yet follows the scroll over the run
      if (
        seg.kind === "time" &&
        seg.tLast - seg.tPrev > 1500 &&
        line.r2 > 0.9 &&
        Math.abs(seg.atEnd - seg.atStart) > 200
      ) {
        seg.kind = "scroll";
        seg.smoothed = true;
      }
      if (seg.kind === "scroll") {
        seg.ratio = line.slope;
        if (line.slope !== 0) {
          seg.scrollFrom = (vFrom - line.intercept) / line.slope;
          seg.scrollTo = (vTo - line.intercept) / line.slope;
        }
      }
      const range = vTo - vFrom;
      if (
        seg.kind === "time" &&
        Math.abs(range) > ch.eps * 3 &&
        run.length >= 2 &&
        seg.tLast - seg.tPrev <= MAX_FIT_MS
      ) {
        const points: [number, number][] = [];
        for (const f of [
          fPrev,
          ...Array.from({ length: fLast - run[0] + 1 }, (_, i) => run[0] + i),
          fLast + 1,
          fLast + 2,
        ]) {
          const t = timeOf.get(f);
          const v = valueAt(f, ch.key);
          if (t !== undefined && v !== undefined) points.push([t, (v - vFrom) / range]);
        }
        const [best] = fitEasing(points, seg.tPrev, timeOf.get(run[0]) ?? seg.tPrev, seg.tLast);
        seg.fit = best;
      }
      runs.push(seg);
    }
    out.push(...mergeScrollRuns(runs));
  }
  // content that moves one for one against the scroll is the page itself (a smooth scroller's wrapper), not motion
  return out.filter((s) => !(s.kind === "scroll" && s.ratio !== undefined && Math.abs(s.ratio + 1) < 0.03));
}

/**
 * Scroll-linked motion moves only while the page scrolls, so one parallax shows up as a run per glide (a trailing
 * one also keeps settling at each rest). When every sample of those runs lies on one line against the scroll
 * position, they are one item over the whole range.
 */
function mergeScrollRuns(runs: Segment[]): Segment[] {
  const linked = runs.filter((s) => s.kind === "scroll" || (s.kind === "time" && s.tLast - s.tPrev > 600));
  if (linked.length < 2 || !linked.some((s) => s.kind === "scroll")) return runs;
  const xs = linked.flatMap((s) => s.xs ?? []);
  const ys = linked.flatMap((s) => s.ys ?? []);
  const line = linearFit(xs, ys);
  if (line.r2 < 0.95) return runs;
  const first = linked[0];
  const last = linked[linked.length - 1];
  const merged: Segment = {
    ...first,
    kind: "scroll",
    vTo: last.vTo,
    tLast: last.tLast,
    atEnd: last.atEnd,
    area: Math.max(...linked.map((s) => s.area)),
    ratio: line.slope,
    smoothed: linked.some((s) => s.smoothed || s.kind === "time") || undefined,
    scrollFrom: Math.min(...xs),
    scrollTo: Math.max(...xs),
    fit: undefined,
  };
  return [...runs.filter((s) => !linked.includes(s)), merged];
}

// ---------------------------------------------------------------- the table

interface Draft extends Omit<MotionItem, "id" | "key"> {
  t: number;
  el?: number;
  /** Every element the item describes, so measured motion of the same elements isn't listed again. */
  els?: number[];
  noGroup?: boolean;
}

const triggerAt = (at: number, t: number): MotionItem["trigger"] =>
  at < 1 && t < 1500 ? { kind: "load" } : { kind: "scroll", at: Math.round(at) };

/** Values of one property through the keyframes: consecutive repeats dropped, at most four kept. */
function valuesOfProp(property: string, values: (string | null)[]) {
  const vs: string[] = [];
  for (const raw of values) {
    if (raw === null || raw === "") continue;
    const v = tidyValue(property, raw);
    if (vs[vs.length - 1] !== v) vs.push(v);
  }
  if (vs.length <= 4) return vs;
  return [vs[0], vs[Math.floor(vs.length / 3)], vs[Math.floor((2 * vs.length) / 3)], vs[vs.length - 1]];
}

/** A change too small to see: the tail of an interrupted spring, a sub-pixel nudge. */
function tiny(property: string, values: string[]) {
  const nums = values.map((v) => (v.match(/-?\d*\.?\d+(e-?\d+)?/g) ?? []).map(Number));
  if (nums.some((n) => n.length !== nums[0].length) || !nums[0].length) return false;
  const limit = /opacity/i.test(property) ? 0.02 : 0.5;
  for (let i = 0; i < nums[0].length; i++) {
    const col = nums.map((n) => n[i]);
    if (Math.max(...col) - Math.min(...col) >= limit) return false;
  }
  return true;
}

const VIA: Record<string, string> = {
  CSSTransition: "CSS transition",
  CSSAnimation: "CSS animation",
  Animation: "Web Animation",
};

function declaredItems(rec: MotionRecording, area: (el?: number) => number): Draft[] {
  const groups = new Map<string, { a: ProbeAnimation; changes: MotionChange[]; easing: string }>();
  for (const fr of rec.frames)
    for (const a of fr.anims) {
      if (!a.duration || a.duration < 50 || a.el === undefined) continue;
      const easing = compactEasing(
        a.type === "CSSAnimation" && (!a.easing || a.easing === "linear") && a.keyframeEasing
          ? a.keyframeEasing
          : a.easing,
      );
      const id = [a.el, a.pseudo, a.type, Math.round(a.duration), Math.round(a.delay ?? 0), easing, a.timeline].join(
        "|",
      );
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { a, changes: [], easing }));
      for (const p of a.props ?? []) {
        if (g.changes.some((c) => c.property === p.property)) continue;
        const values = valuesOfProp(p.property, p.values);
        if (values.length >= 2 && !tiny(p.property, values)) g.changes.push({ property: p.property, values });
      }
    }
  const live = [...groups.values()].filter((g) => g.changes.length);
  const out: Draft[] = [];
  // the same animation on siblings with regular delays is one staggered item
  const bySignature = new Map<string, typeof live>();
  for (const g of live) {
    const sig = [g.a.f, g.a.type, Math.round(g.a.duration!), g.easing, g.changes.map((c) => c.property).join(",")].join(
      "|",
    );
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), g]);
  }
  const used = new Set<object>();
  for (const gs of bySignature.values()) {
    if (gs.length < 3) continue;
    gs.sort((x, y) => (x.a.delay ?? 0) - (y.a.delay ?? 0));
    const gaps = gs.slice(1).map((g, i) => (g.a.delay ?? 0) - (gs[i].a.delay ?? 0));
    if (Math.min(...gaps) <= 0 || Math.max(...gaps) - Math.min(...gaps) > 1) continue;
    const a = gs[0].a;
    const el = rec.elements[a.el!];
    out.push({
      source: "exact",
      via: VIA[a.type] ?? a.type,
      trigger: triggerAt(a.at, a.t),
      target: { name: el?.name ?? "?", selector: el?.selector ?? "?", count: gs.length },
      changes: gs[0].changes,
      durationMs: Math.round(a.duration!),
      easing: gs[0].easing,
      staggerMs: Math.round(median(gaps)),
      ...(a.delay ? { delayMs: Math.round(a.delay) } : {}),
      area: gs.reduce((s, g) => s + area(g.a.el), 0),
      t: a.t,
      el: a.el,
      els: gs.map((g) => g.a.el!),
      noGroup: true,
    });
    gs.forEach((g) => used.add(g));
  }
  for (const g of live) {
    if (used.has(g)) continue;
    const a = g.a;
    const el = rec.elements[a.el!];
    const scrollTimeline = a.timeline === "scroll" || a.timeline === "view";
    out.push({
      source: "exact",
      via: VIA[a.type] ?? a.type,
      trigger: scrollTimeline ? { kind: "scroll", at: Math.round(a.at) } : triggerAt(a.at, a.t),
      target: { name: el?.name ?? "?", selector: (el?.selector ?? "?") + (a.pseudo ?? ""), count: 1 },
      changes: g.changes,
      ...(scrollTimeline ? { scrubbed: true } : { durationMs: Math.round(a.duration!) }),
      easing: g.easing,
      ...(a.delay ? { delayMs: Math.round(a.delay) } : {}),
      ...(a.iterations === "infinite" || (typeof a.iterations === "number" && a.iterations > 1)
        ? { iterations: a.iterations }
        : {}),
      area: area(a.el),
      t: a.t,
      el: a.el,
    });
  }
  return out;
}

const libChanges = (props: LibraryProp[], from?: boolean): MotionChange[] =>
  props.map((p) => ({ property: p.property, values: from ? [String(p.to), "(its own value)"] : [String(p.to)] }));

function libraryItems(rec: MotionRecording): Draft[] {
  const out: Draft[] = [];
  for (const s of rec.triggers) {
    const target = s.target ?? s.trigger;
    const range = { kind: "scroll" as const, from: Math.round(s.start ?? 0), to: Math.round(s.end ?? 0) };
    if (s.pin)
      out.push({
        source: "exact",
        via: "ScrollTrigger",
        trigger: range,
        target: { ...s.pin, count: 1 },
        changes: [{ property: "pinned", values: ["while scrolling the range"] }],
        area: 0,
        t: 0,
      });
    if (!target || !s.props.length) continue;
    const scrub = s.scrub !== undefined && s.scrub !== false;
    out.push({
      source: "exact",
      via: "ScrollTrigger",
      trigger: scrub ? range : { kind: "scroll", at: range.from },
      target: { ...target, count: Math.max(1, s.count) },
      changes: libChanges(s.props, s.from),
      ...(scrub
        ? { scrubbed: true, ...(typeof s.scrub === "number" ? { parallax: { ratio: 0, smoothed: true } } : {}) }
        : { durationMs: s.duration, easing: s.ease ?? "power1.out" }),
      area: 0,
      t: 0,
    });
  }
  for (const tw of rec.tweens) {
    if (!tw.target || (tw.scrollTrigger && rec.triggers.length)) continue;
    out.push({
      source: "exact",
      via: "GSAP tween",
      trigger: triggerAt(tw.at, tw.t),
      target: { ...tw.target, count: tw.count },
      changes: libChanges(tw.props, tw.from),
      durationMs: tw.duration,
      easing: tw.ease ?? "power1.out",
      ...(tw.delay ? { delayMs: tw.delay } : {}),
      ...(tw.stagger ? { staggerMs: tw.stagger } : {}),
      area: 0,
      t: tw.t,
    });
  }
  return out;
}

function measuredItems(
  rec: MotionRecording,
  segs: Segment[],
  covered: (el: number) => boolean,
  elements: Record<string, ProbeElement>,
): Draft[] {
  const out: Draft[] = [];
  const name = (el: number) => elements[el]?.name ?? "?";
  const selector = (el: number) => elements[el]?.selector ?? "?";
  const channel = (k?: Key) => CHANNELS.find((c) => c.key === k)!;
  const changeOf = (s: Segment): MotionChange => {
    const c = channel(s.key);
    return { property: c.property, values: [fmt(s.vFrom, c.unit), fmt(s.vTo, c.unit)] };
  };

  // siblings starting at a regular interval: one staggered item
  const byParent = new Map<string, Segment[]>();
  for (const s of segs) {
    const parent = elements[s.el]?.parent;
    if (s.kind !== "time" || !s.fit || !parent) continue;
    byParent.set(`${parent}|${s.key}`, [...(byParent.get(`${parent}|${s.key}`) ?? []), s]);
  }
  const inStagger = new Set<number>();
  for (const g of byParent.values()) {
    if (g.length < 3 || g.every((s) => covered(s.el))) continue;
    g.sort((a, b) => a.fit!.startMs - b.fit!.startMs);
    const gaps = g.slice(1).map((s, i) => s.fit!.startMs - g[i].fit!.startMs);
    const stagger = median(gaps);
    if (stagger <= 0 || stagger > 1000 || !gaps.every((x) => Math.abs(x - stagger) <= FRAME_MS)) continue;
    const s0 = g[0];
    const easing = s0.fit!.rms < FIT_NAMED_RMS ? s0.fit!.easing : "custom";
    out.push({
      source: "measured",
      via: "measured",
      trigger: triggerAt(s0.atStart, s0.tPrev),
      target: { name: name(s0.el), selector: selector(s0.el), count: g.length },
      changes: [changeOf(s0)],
      durationMs: Math.round(median(g.map((s) => s.fit!.durationMs))),
      easing,
      fitRms: round3(s0.fit!.rms),
      staggerMs: Math.round(stagger),
      area: g.reduce((s, x) => s + x.area, 0),
      t: s0.tPrev,
      el: s0.el,
      noGroup: true,
    });
    g.forEach((s) => inStagger.add(s.el));
  }

  // what is left, merged per element: channels that start together are one item
  const groups = new Map<string, Segment[][]>();
  for (const s of segs) {
    const fixedIn = elements[s.el]?.fixedIn ?? 0;
    if (s.kind === "pin" || s.kind === "fixed") {
      // inside a fixed layer it is the layer that holds still, reported once for the layer itself
      if (fixedIn && fixedIn !== s.el) continue;
    } else {
      if (covered(s.el) || (s.kind === "time" && inStagger.has(s.el))) continue;
      if (Math.abs(s.vTo - s.vFrom) < channel(s.key).amp) continue;
    }
    if (s.area < MIN_AREA) continue;
    const id = `${s.el}|${s.kind}`;
    const list = groups.get(id) ?? [];
    const near = list.find((grp) =>
      s.kind === "time"
        ? Math.abs(grp[0].tPrev - s.tPrev) <= FRAME_MS + 1
        : s.kind === "scroll"
          ? Math.abs(grp[0].atStart - s.atStart) <= 30
          : false,
    );
    if (near) near.push(s);
    else list.push([s]);
    groups.set(id, list);
  }
  for (const list of groups.values())
    for (const grp of list) {
      const s = grp[0];
      const base = {
        source: "measured" as const,
        via: "measured",
        target: { name: name(s.el), selector: selector(s.el), count: 1 },
        area: s.area,
        t: s.tPrev,
        el: s.el,
      };
      if (s.kind === "fixed") {
        out.push({ ...base, trigger: { kind: "always" }, changes: [], fixedAt: Math.round(s.y!) });
        continue;
      }
      if (s.kind === "pin") {
        const from = round10(s.scrollFrom!);
        const to = round10(s.scrollTo!);
        out.push({ ...base, trigger: { kind: "scroll", from, to }, changes: [], pinnedAt: Math.round(s.y!) });
        continue;
      }
      const changes = grp.map(changeOf);
      if (s.kind === "scroll") {
        out.push({
          ...base,
          trigger: {
            kind: "scroll",
            from: round10(s.scrollFrom ?? s.atStart),
            to: round10(s.scrollTo ?? s.atEnd),
          },
          changes,
          scrubbed: true,
          parallax: { ratio: Math.round((s.ratio ?? 0) * 1000) / 1000, ...(s.smoothed ? { smoothed: true } : {}) },
        });
        continue;
      }
      const fitted = grp.find((x) => x.fit);
      out.push({
        ...base,
        trigger: triggerAt(s.atStart, s.tPrev),
        changes,
        ...(fitted
          ? {
              durationMs: round10(fitted.fit!.durationMs),
              easing: fitted.fit!.rms < FIT_NAMED_RMS ? fitted.fit!.easing : "custom",
              fitRms: round3(fitted.fit!.rms),
            }
          : s.tLast - s.tPrev <= FRAME_MS + 1
            ? { instant: true }
            : { durationMs: round10(s.tLast - s.tPrev) }),
      });
    }
  return out;
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The selector with numbers taken out, so the same component repeated reads as one. */
const family = (selector: string) => selector.replace(/:nth-of-type\(\d+\)/g, "").replace(/\d+/g, "#");

export function timingText(it: MotionItem) {
  const parts: string[] = [];
  if (it.fixedAt !== undefined) return `fixed at y=${it.fixedAt}`;
  if (it.pinnedAt !== undefined) return `pinned at y=${it.pinnedAt}`;
  if (it.instant) parts.push("jumps within one frame");
  if (it.scrubbed) {
    parts.push(
      it.parallax && it.parallax.ratio
        ? `scroll-linked ${it.parallax.ratio > 0 ? "+" : ""}${it.parallax.ratio}/px${it.parallax.smoothed ? ", smoothed" : ""}`
        : `scrubbed${it.parallax?.smoothed ? ", smoothed" : ""}`,
    );
  }
  if (it.durationMs !== undefined) parts.push(`${Math.round(it.durationMs)}ms`);
  if (it.easing && !it.scrubbed) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""} ${it.easing}`.trim();
  if (it.iterations !== undefined) parts.push(it.iterations === "infinite" ? "loops" : `×${it.iterations}`);
  if (it.staggerMs) parts.push(`stagger ${it.staggerMs}ms`);
  if (it.delayMs !== undefined)
    parts.push(`delay ${Array.isArray(it.delayMs) ? `${it.delayMs[0]}–${it.delayMs[1]}` : it.delayMs}ms`);
  if (it.fitRms !== undefined) parts.push(`fit error ${it.fitRms}`);
  return parts.join(", ");
}

const triggerText = (tr: MotionItem["trigger"]) =>
  tr.kind === "load"
    ? "load"
    : tr.kind === "always"
      ? "always"
      : tr.spread
        ? `scroll@${tr.spread[0]}…${tr.spread[1]}`
        : tr.from !== undefined
          ? `scroll ${tr.from}–${tr.to}`
          : `scroll@${tr.at ?? 0}`;

/** One line per item: `M3 scroll@2700 3× img "Gallery" (div.card) | opacity 0→1 | 600ms ease-out | exact (CSS transition)`. */
export function motionLine(it: MotionItem) {
  const count = it.target.count > 1 ? `${it.target.count}× ` : "";
  const changes = it.changes
    .map((c) => `${c.property} ${c.values.length === 1 ? `→${c.values[0]}` : c.values.join("→")}`)
    .join("; ");
  const timing = timingText(it);
  const source = it.source === "exact" ? `exact (${it.via})` : "measured";
  return [
    `${it.id} ${triggerText(it.trigger)} ${count}${it.target.name} (${it.target.selector})`,
    changes,
    timing,
    source,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** The table Claude reads: at most `cap` lines, the most visible first, and a count of the rest. */
export function motionTable(track: MotionTrack, cap = MOTION_TABLE_ITEMS) {
  const lines = track.items.slice(0, cap).map(motionLine);
  const more = track.itemsTotal - Math.min(cap, track.items.length);
  if (more > 0) lines.push(`(+${more} more item${more === 1 ? "" : "s"})`);
  return lines;
}

/** Turns what a recording gathered into the stored track. Pure: same recording, same track. */
export function buildMotionTrack(rec: MotionRecording): MotionTrack {
  const timeOf = new Map(rec.frames.map((f) => [f.f, f.t]));
  const atOf = new Map(rec.frames.map((f) => [f.f, f.at]));
  const tracks = tracksOf(rec.frames);
  const area = (el?: number) => (el === undefined ? 0 : (tracks.get(el)?.area ?? 0));
  const declared = declaredItems(rec, area);
  const library = libraryItems(rec);
  const declaredEls = new Set(declared.flatMap((d) => d.els ?? (d.el === undefined ? [] : [d.el])));
  const librarySelectors = new Set(library.map((d) => d.target.selector));
  const covered = (el: number) => declaredEls.has(el) || librarySelectors.has(rec.elements[el]?.selector ?? "");
  const segs = [...tracks.values()].flatMap((tr) => segmentsOf(tr, timeOf, atOf));
  const drafts = [...declared, ...library, ...measuredItems(rec, segs, covered, rec.elements)];

  // the same motion on several elements is one item
  const buckets = new Map<string, Draft[]>();
  for (const d of drafts) {
    const id = d.noGroup
      ? `solo|${buckets.size}`
      : [
          d.source,
          d.via,
          family(d.target.selector),
          // a loop is the same loop whatever phase each copy started in
          JSON.stringify(
            d.iterations === "infinite" ? d.changes.map((c) => [c.property, [...new Set(c.values)].sort()]) : d.changes,
          ),
          d.durationMs,
          d.easing,
          d.trigger.kind,
          d.pinnedAt,
          d.fixedAt,
        ].join("|");
    buckets.set(id, [...(buckets.get(id) ?? []), d]);
  }
  const merged: Draft[] = [...buckets.values()].map((ds) => {
    if (ds.length === 1) return ds[0];
    ds.sort((a, b) => a.t - b.t);
    const first = ds[0];
    const ats = ds.map((d) => d.trigger.at).filter((x): x is number => x !== undefined);
    const delays = [...new Set(ds.map((d) => (typeof d.delayMs === "number" ? d.delayMs : 0)))].sort((a, b) => a - b);
    const lo = Math.min(...ats);
    const hi = Math.max(...ats);
    return {
      ...first,
      trigger:
        ats.length && hi - lo > 30 ? { ...first.trigger, at: lo, spread: [lo, hi] as [number, number] } : first.trigger,
      target: { ...first.target, count: ds.reduce((s, d) => s + d.target.count, 0) },
      ...(delays.length > 1 ? { delayMs: [delays[0], delays[delays.length - 1]] as [number, number] } : {}),
      area: ds.reduce((s, d) => s + d.area, 0),
    };
  });
  merged.sort((a, b) => b.area - a.area || a.t - b.t);
  // the key: what moved and how it was triggered; repeats of the same are told apart by their order down the page,
  // not by a scroll position that can shift by a few pixels between two recordings
  const base = (d: Draft) =>
    [d.source, family(d.target.selector), d.changes.map((c) => c.property).join(","), d.trigger.kind].join("|");
  const order = new Map<Draft, number>();
  const byBase = new Map<string, Draft[]>();
  for (const d of merged) byBase.set(base(d), [...(byBase.get(base(d)) ?? []), d]);
  for (const ds of byBase.values())
    ds.sort(
      (a, b) => (a.trigger.from ?? a.trigger.at ?? 0) - (b.trigger.from ?? b.trigger.at ?? 0) || a.t - b.t,
    ).forEach((d, n) => order.set(d, n + 1));
  const items: MotionItem[] = merged.slice(0, MAX_TRACK_ITEMS).map((d, i) => {
    const { t: _t, el: _el, els: _els, noGroup: _n, ...rest } = d;
    return { id: `M${i + 1}`, key: `${base(d)}#${order.get(d)}`, ...rest };
  });

  const changedPerFrame = rec.frames.map((f) => f.changed);
  const media = rec.frames.reduce((m, f) => Math.max(m, (f.media?.[0] ?? 0) + (f.media?.[1] ?? 0)), 0);
  const limits = [
    "Measured while PIVOT scrolled the page top to bottom with no pointer: hover, click and focus weren't exercised.",
    "Measured items were fitted from frames 33 ms apart: durations are within about one frame, and motion run by scripts reads slightly short.",
    ...(media ? ["Canvas, WebGL and video aren't read as elements: their motion isn't in this table."] : []),
    ...(rec.stopped ? [`The recording stopped before the bottom of the page (${rec.stopped}).`] : []),
    ...(changedPerFrame.some((n) => n > rec.cap)
      ? [`Some frames had more than ${rec.cap} moving elements; the smallest weren't measured.`]
      : []),
  ];
  return {
    version: 1,
    fps: MOTION_TRACK_FPS,
    viewport: rec.viewport,
    method: rec.method,
    frames: rec.frames.length,
    scrolledTo: Math.round(Math.max(0, ...rec.frames.map((f) => f.at))),
    libraries: rec.libraries,
    ...(rec.lenis ? { lenis: rec.lenis } : {}),
    items,
    itemsTotal: merged.length,
    limits,
    stats: {
      changedPerFrameMedian: median(changedPerFrame),
      changedPerFrameMax: Math.max(0, ...changedPerFrame),
      framesOverCap: changedPerFrame.filter((n) => n > rec.cap).length,
    },
  };
}
