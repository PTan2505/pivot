/**
 * Pure helpers for motion measured frame by frame (motion-track.ts): the standard easing curves, fitting samples to
 * them, and reading CSS transform, filter and easing values. No browser, no I/O.
 */

/** Frames per second of a motion recording; one frame is 33.3 ms. */
export const MOTION_TRACK_FPS = 30;
export const FRAME_MS = 1000 / MOTION_TRACK_FPS;

type Curve = (x: number) => number;

const TABLE = 1000;

/** A curve as a lookup table over x in [0, 1], read with linear interpolation (fitting calls it millions of times). */
function tabulate(f: Curve): Curve {
  const ys = new Float64Array(TABLE + 1);
  for (let i = 0; i <= TABLE; i++) ys[i] = f(i / TABLE);
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const p = x * TABLE;
    const i = Math.floor(p);
    return ys[i] + (p - i) * (ys[i + 1] - ys[i]);
  };
}

/** A CSS `cubic-bezier(x1, y1, x2, y2)`, solved for y at each x by sampling its parameter. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const n = 4000;
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const u = 1 - s;
    xs[i] = 3 * u * u * s * x1 + 3 * u * s * s * x2 + s ** 3;
    ys[i] = 3 * u * u * s * y1 + 3 * u * s * s * y2 + s ** 3;
  }
  return tabulate((x) => {
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < x) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    const k = span === 0 ? 0 : (x - xs[lo]) / span;
    return ys[lo] + k * (ys[hi] - ys[lo]);
  });
}

const BACK = 1.70158;

/**
 * The curves a measured motion is named after. GSAP's `power2.out` is the same curve as `easeOutCubic` (power1 is
 * quadratic, power2 cubic), so it is one name; the same goes for `power2.in` and `power2.inOut`.
 */
export const EASINGS: Record<string, Curve> = {
  linear: (x) => Math.min(1, Math.max(0, x)),
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  "ease-in": cubicBezier(0.42, 0, 1, 1),
  "ease-out": cubicBezier(0, 0, 0.58, 1),
  "ease-in-out": cubicBezier(0.42, 0, 0.58, 1),
  "power1.out": tabulate((x) => 1 - (1 - x) ** 2),
  "easeOutCubic / power2.out": tabulate((x) => 1 - (1 - x) ** 3),
  "easeInCubic / power2.in": tabulate((x) => x ** 3),
  "easeInOutCubic / power2.inOut": tabulate((x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)),
  "expo.out": tabulate((x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x))),
  "back.out": tabulate((x) => 1 + (BACK + 1) * (x - 1) ** 3 + BACK * (x - 1) ** 2),
  "cubic-bezier(.23,1,.32,1)": cubicBezier(0.23, 1, 0.32, 1),
};

export interface EasingFit {
  easing: string;
  /** Root mean square distance between the samples and the curve, in fractions of the whole change. */
  rms: number;
  /** When the motion started and how long it ran, in the recording's milliseconds. */
  startMs: number;
  durationMs: number;
}

/** Below this error a fit is named; above it the motion is "custom". */
export const FIT_NAMED_RMS = 0.03;

/**
 * Fits samples of a motion's progress (0 at its start value, 1 at its end) to each curve, searching its start
 * between the last frame before it moved (`prevMs`) and the first that moved (`firstMs`), and its duration from half
 * the observed span to one frame past it: an eased tail can stay flat for frames before it truly ends. A coarse 4 ms
 * grid, then 1 ms around the best. Returns every curve, best first.
 */
export function fitEasing(points: [number, number][], prevMs: number, firstMs: number, lastMs: number): EasingFit[] {
  const sse = (f: Curve, t0: number, d: number) => {
    let e = 0;
    for (const [t, p] of points) {
      const r = f((t - t0) / d) - p;
      e += r * r;
    }
    return e;
  };
  const dmin = Math.max(1, 0.5 * (lastMs - prevMs));
  const dmax = lastMs - prevMs + 2 * FRAME_MS;
  const out: EasingFit[] = [];
  for (const [name, f] of Object.entries(EASINGS)) {
    let best = { e: Infinity, t0: prevMs, d: dmin };
    for (let t0 = prevMs; t0 < firstMs; t0 += 4)
      for (let d = dmin; d <= dmax; d += 4) {
        const e = sse(f, t0, d);
        if (e < best.e) best = { e, t0, d };
      }
    const coarse = best;
    for (let t0 = Math.max(prevMs, coarse.t0 - 4); t0 <= Math.min(firstMs, coarse.t0 + 4); t0++)
      for (let d = Math.max(dmin, coarse.d - 4); d <= coarse.d + 4; d++) {
        const e = sse(f, t0, d);
        if (e < best.e) best = { e, t0, d };
      }
    out.push({ easing: name, rms: Math.sqrt(best.e / points.length), startMs: best.t0, durationMs: best.d });
  }
  return out.sort((a, b) => a.rms - b.rms);
}

export interface TransformParts {
  translateX: number;
  translateY: number;
  scale: number;
  rotate: number;
}

/** A computed `transform` (`none`, `matrix(…)` or `matrix3d(…)`) as translation, uniform scale and rotation. */
export function parseTransform(tf: string | undefined | null): TransformParts {
  const none = { translateX: 0, translateY: 0, scale: 1, rotate: 0 };
  const m = tf && /^matrix(3d)?\((.*)\)$/.exec(tf.trim());
  if (!m) return none;
  const v = m[2].split(",").map(Number);
  if (v.some((n) => !Number.isFinite(n))) return none;
  const [a, b] = v;
  const [tx, ty] = m[1] ? [v[12], v[13]] : [v[4], v[5]];
  return { translateX: tx, translateY: ty, scale: Math.hypot(a, b), rotate: (Math.atan2(b, a) * 180) / Math.PI };
}

/** The blur radius in a computed `filter`, 0 without one. */
export function parseBlur(filter: string | undefined | null) {
  const m = filter && /blur\(([\d.]+)px\)/.exec(filter);
  return m ? Number(m[1]) : 0;
}

/** Short easing text: `cubic-bezier(.23,1,.32,1)`, and a `linear()` with many stops (a spring) as "spring". */
export function compactEasing(easing: string | null | undefined): string {
  if (!easing) return "linear";
  const e = easing.trim();
  if (/^linear\(/.test(e) && e.split(",").length > 4) return "spring";
  const m = /^cubic-bezier\((.*)\)$/.exec(e);
  if (!m) return e;
  return `cubic-bezier(${m[1]
    .split(",")
    .map((n) => n.trim().replace(/^(-?)0\./, "$1."))
    .join(",")})`;
}

/** A number for a table: whole when it is, else two decimals under 10 and none above. */
export function fmt(n: number, unit = "") {
  if (Math.abs(n) >= 10) return `${Math.round(n)}${unit}`;
  const r = Math.round(n * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, "")}${unit}`;
}

/** Identity steps in a CSS transform (`scale(1)`, `rotate(0deg)`, `translate(0px, 0px)`…) say nothing; drop them. */
const IDENTITY =
  /\b(?:translate(?:3d|X|Y|Z)?\((?:\s*0(?:px|%)?\s*,?)+\)|scale(?:3d|X|Y)?\((?:\s*1\s*,?)+\)|rotate[XYZ]?\(\s*0(?:deg|rad|turn)?\s*\)|skew[XY]?\((?:\s*0(?:deg)?\s*,?)+\))/g;

/** A CSS value as a table shows it: long decimals rounded, identity transform steps dropped. */
export function tidyValue(property: string, value: string) {
  let v = value.replace(/-?\d*\.\d{3,}/g, (n) => String(Math.round(Number(n) * 100) / 100));
  if (/transform|translate|scale|rotate/i.test(property)) {
    v = v.replace(IDENTITY, "").replace(/\s+/g, " ").trim();
    if (!v) v = "none";
  }
  return v.length > 48 ? `${v.slice(0, 47)}…` : v;
}

/** Least-squares line through the points: slope, intercept and r². */
export function linearFit(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0 };
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
