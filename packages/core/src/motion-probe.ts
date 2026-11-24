/**
 * The scripts that measure a page's motion while "Record motion" films it (see `recordScroll` in capture.ts and
 * `buildMotionTrack` in motion-track.ts). They only read the page: nothing here changes how it looks or moves.
 *
 * - `MOTION_PROBE` runs in an isolated world (a separate JavaScript context on the same DOM), so the page's own
 *   scripts can't see it or answer for it. Every frame it lists the animations the page declared (CSS transitions
 *   and animations, Web Animations) the first time it sees them, and the elements whose box, transform, opacity,
 *   clip-path or blur changed since the last frame.
 * - `MOTION_LIBRARIES` runs in the page's own world, because GSAP, ScrollTrigger and Lenis live on its `window`,
 *   which an isolated world can't see. It is called at the start and at each rest, and every frame only while GSAP
 *   is on the page (a tween can only be read while it runs).
 */

/**
 * A readable name and a short selector for an element, shared by both worlds so their ids agree. Class names that
 * are hashed (CSS modules) or utilities (Tailwind) say nothing about the element, so they are left out; an element
 * with no telling id or class is placed under its parent instead.
 */
const DESCRIBE = `
  const UTILITY = /^-|^(flex|grid|inline|overflow|whitespace|transition|list|leading|tracking|font|text|bg|border|rounded|shadow)-|^(m|p)[trblxyse]?-|^(w|h|min-w|min-h|max-w|max-h|size|text|bg|border|rounded|gap|space|items|justify|self|place|content|inset|top|left|right|bottom|z|opacity|duration|ease|delay|font|leading|tracking|shadow|ring|col|row|order|object|aspect|pointer|select|cursor|origin|will|fill|stroke|divide|translate|scale|rotate|skew|blur|backdrop|from|via|to|grid-cols|grid-rows|basis|grow|shrink|line-clamp|decoration|outline)-|^(flex|grid|block|inline|inline-block|inline-flex|hidden|absolute|relative|fixed|sticky|static|transform|transition|truncate|uppercase|lowercase|capitalize|italic|underline|antialiased|container|group|peer|sr-only|overflow-hidden|isolate|contents|grow|shrink|visible|invisible)$/;
  const HASHED = /(^|[_-])(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{5,}$|^[a-zA-Z]{1,3}-[a-zA-Z0-9]{5,}$|^css-|^sc-|^jsx-/;
  // a CSS module's class, \`WS84WW_shade\`: the hash changes with every build, the name after it doesn't
  const MODULE = /^_?(?=[A-Za-z0-9]*(?:\\d|[a-z][A-Z]|[A-Z][a-z]))[A-Za-z0-9]{5,8}_([A-Za-z][A-Za-z0-9-]{1,24})$/;
  const goodClass = (c) => c.length > 1 && c.length <= 28 && !/[:\\[\\]\\/@!#%.]/.test(c) && !UTILITY.test(c) && !HASHED.test(c) && !MODULE.test(c);
  // ids made at run time (React's useId, Base UI, Radix, Headless UI) change between builds and say nothing
  const GENERATED = /^(base-ui|radix|headlessui|react-aria|mui|mantine|chakra)-|(^|[-_])_?[rR]_[0-9a-zA-Z]*_?|^:r|^_r/;
  const goodId = (id) => id && id.length <= 40 && !/\\d{3,}|[:]/.test(id) && !/^[a-z0-9]{8,}$/i.test(id) && !HASHED.test(id) && !GENERATED.test(id);
  const own = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (goodId(id)) return tag + "#" + id;
    const all = (el.getAttribute("class") || "").trim().split(/\\s+/);
    const cls = all.filter(goodClass).slice(0, 2);
    if (cls.length) return tag + "." + cls.join(".");
    const mod = all.map((c) => MODULE.exec(c)).find(Boolean);
    return mod ? tag + '[class*="_' + mod[1] + '"]' : null;
  };
  const selectorOf = (el) => {
    const mine = own(el);
    if (mine) return mine;
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent || parent === document.body) return tag;
    const n = [...parent.children].filter((c) => c.tagName === el.tagName).indexOf(el) + 1;
    const step = n > 1 ? tag + ":nth-of-type(" + n + ")" : tag;
    const up = own(parent) || (parent.parentElement && own(parent.parentElement) ? own(parent.parentElement) + " " + parent.tagName.toLowerCase() : parent.tagName.toLowerCase());
    return up + " > " + step;
  };
  const nameOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || (el.querySelector && el.querySelector("img[alt]") ? el.querySelector("img[alt]").getAttribute("alt") : "") || el.innerText || el.textContent || "";
    const text = label.trim().replace(/\\s+/g, " ").slice(0, 36);
    return text ? tag + ' "' + text + (label.trim().length > 36 ? "…" : "") + '"' : tag;
  };
`;

/** Installs `globalThis.__pivotMotion` in the isolated world. Calling it again keeps what it has seen. */
export const MOTION_PROBE = `(() => {
  if (globalThis.__pivotMotion) return true;
  ${DESCRIBE}
  const ids = new WeakMap();
  const elements = {};
  let nextId = 1;
  const idOf = (el) => {
    let id = ids.get(el);
    if (!id) {
      id = nextId++;
      ids.set(el, id);
      let fixed = 0;
      for (let a = el, k = 0; a && a !== document.body && k < 30; a = a.parentElement, k++) {
        if (getComputedStyle(a).position === "fixed") { fixed = a === el ? id : idOf(a); break; }
      }
      elements[id] = { name: nameOf(el), selector: selectorOf(el), parent: el.parentElement && el.parentElement !== document.body ? idOf(el.parentElement) : 0, fixedIn: fixed };
    }
    return id;
  };
  const seen = new WeakSet();
  const prev = new WeakMap();
  const emitted = new WeakSet();
  const timelineOf = (a) => !a.timeline ? "none" : a.timeline === document.timeline ? "document" : /View/.test(a.timeline.constructor && a.timeline.constructor.name) ? "view" : "scroll";
  const describeAnimation = (a, f, t, at) => {
    const e = a.effect;
    const d = { f, t, at, type: a.constructor ? a.constructor.name : "Animation", timeline: timelineOf(a) };
    try {
      const tm = e.getTiming();
      d.duration = typeof tm.duration === "number" ? tm.duration : 0;
      d.delay = tm.delay || 0;
      d.easing = tm.easing;
      d.iterations = tm.iterations === Infinity ? "infinite" : tm.iterations;
      d.direction = tm.direction;
    } catch {}
    try {
      const frames = e.getKeyframes();
      const skip = new Set(["offset", "computedOffset", "easing", "composite"]);
      const props = [];
      for (const k of frames) for (const p of Object.keys(k)) if (!skip.has(p) && !props.includes(p) && p !== "transitionBehavior") props.push(p);
      d.props = props.slice(0, 6).map((p) => ({ property: p, values: frames.map((k) => (k[p] === undefined ? null : String(k[p]).slice(0, 80))) }));
      d.keyframeEasing = frames.map((k) => k.easing).find((x) => x && x !== "linear") || null;
    } catch {}
    try { if (e.target) d.el = idOf(e.target); d.pseudo = e.pseudoElement || ""; } catch {}
    return d;
  };
  globalThis.__pivotMotion = {
    frame(f, t, at, cap) {
      const out = { f, t, at, ch: [], anims: [] };
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        seen.add(a);
        out.anims.push(describeAnimation(a, f, t, at));
      }
      // the elements whose look or place changed since the last frame, in view or within half a screen of it, so
      // motion that starts just off screen (a stagger running into view) is followed from its start
      const vh = innerHeight, vw = innerWidth, margin = vh / 2;
      const all = document.body ? document.body.getElementsByTagName("*") : [];
      const boxMoved = new Map();
      const changed = [];
      let visible = 0;
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const r = el.getBoundingClientRect();
        if ((r.width === 0 && r.height === 0) || r.bottom <= -margin || r.top >= vh + margin || r.right <= 0 || r.left >= vw) continue;
        visible++;
        const cs = getComputedStyle(el);
        const cur = { f, x: r.left, y: r.top, w: r.width, h: r.height, dy: r.top + at, tf: cs.transform, op: cs.opacity, clip: cs.clipPath, filt: cs.filter, pos: cs.position };
        const p = prev.get(el);
        prev.set(el, cur);
        if (!p || p.f !== f - 1) continue;
        const styled = p.tf !== cur.tf || p.op !== cur.op || p.clip !== cur.clip || p.filt !== cur.filt;
        const ddx = cur.x - p.x, ddy = cur.dy - p.dy;
        const boxed = Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5 || Math.abs(cur.w - p.w) > 0.5 || Math.abs(cur.h - p.h) > 0.5;
        if (!styled && !boxed) continue;
        if (boxed) boxMoved.set(el, [ddx, ddy]);
        if (!styled) {
          // a box that only moves with its parent is the parent's motion
          let inherited = false;
          for (let a = el.parentElement, k = 0; a && k < 12; a = a.parentElement, k++) {
            const d = boxMoved.get(a);
            if (d) { inherited = Math.abs(d[0] - ddx) < 0.75 && Math.abs(d[1] - ddy) < 0.75; break; }
          }
          if (inherited) continue;
        }
        const area = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
        changed.push({ el, area, cur, p });
      }
      changed.sort((a, b) => b.area - a.area);
      out.changed = changed.length;
      out.visible = visible;
      const r1 = (n) => Math.round(n * 10) / 10;
      for (const c of changed.slice(0, cap)) {
        const o = { id: idOf(c.el), a: Math.round(c.area), x: Math.round(c.cur.x), y: r1(c.cur.y), w: Math.round(c.cur.w), h: Math.round(c.cur.h), dy: r1(c.cur.dy), tf: c.cur.tf, op: c.cur.op, pos: c.cur.pos };
        if (c.cur.clip !== "none") o.clip = c.cur.clip;
        if (c.cur.filt !== "none") o.filt = c.cur.filt;
        if (!emitted.has(c.el)) {
          emitted.add(c.el);
          o.prev = { y: r1(c.p.y), dy: r1(c.p.dy), tf: c.p.tf, op: c.p.op, clip: c.p.clip === "none" ? undefined : c.p.clip, filt: c.p.filt === "none" ? undefined : c.p.filt };
        }
        out.ch.push(o);
      }
      // canvases and playing videos wholly on screen: their pixels can move without any DOM change, so the recording's
      // frames are compared there later (a "seen" item)
      let canvases = 0, videos = 0;
      out.boxes = [];
      const onScreen = (r) => r.width > 120 && r.height > 80 && r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw;
      for (const c of document.getElementsByTagName("canvas")) {
        const r = c.getBoundingClientRect();
        if (r.width > 50 && r.height > 50 && r.bottom > 0 && r.top < vh) canvases++;
        if (onScreen(r) && out.boxes.length < 6) out.boxes.push([idOf(c), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), "canvas"]);
      }
      for (const v of document.getElementsByTagName("video")) {
        if (v.paused || v.ended) continue;
        videos++;
        const r = v.getBoundingClientRect();
        if (onScreen(r) && out.boxes.length < 6) out.boxes.push([idOf(v), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), "video"]);
      }
      if (!out.boxes.length) delete out.boxes;
      out.media = [canvases, videos];
      return out;
    },
    elements() { return elements; },
    // hover and click: a small sample of what a visitor would point at or press, one per kind of element
    candidates(maxHover, maxClick) {
      const vw = innerWidth, vh = innerHeight;
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 24 || r.height < 16 || r.width > vw * 0.95 || r.height > vh * 0.9) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
      };
      // something on it or just inside it transitions: a hover rule is likely
      const transitions = (el) => [el, ...el.querySelectorAll(":scope > *, :scope > * > *")].slice(0, 16).some((n) => getComputedStyle(n).transitionDuration.split(",").some((d) => parseFloat(d) > 0));
      const family = (el) => selectorOf(el).replace(/:nth-of-type\\(\\d+\\)/g, "").replace(/\\d+/g, "#");
      // never pressed: anything that buys, signs in, sends, downloads, consents or closes
      const RISKY = /buy|pay|checkout|order|cart|delete|remove|sign|log ?in|log ?out|register|subscribe|download|install|accept|agree|consent|cookie|allow|reject|decline|book|send|submit|contact|share|copy|print|play|start|trial|upgrade|close|dismiss|search/i;
      const pick = [];
      const seenFamilies = new Set();
      const add = (el, kind) => {
        const fam = kind + "|" + family(el);
        if (seenFamilies.has(fam)) return false;
        seenFamilies.add(fam);
        pick.push({ el, kind });
        return true;
      };
      const rank = (el) => (el.closest("nav, header") ? 0 : el.matches("button, [role=button], [role=tab]") ? 1 : el.querySelector("img, picture, video, svg") ? 2 : 3);
      const hover = [...document.querySelectorAll("a[href], button, [role=button], [role=tab], [role=menuitem], [aria-haspopup], summary")]
        .filter((el) => shown(el) && transitions(el))
        .sort((a, b) => rank(a) - rank(b));
      let h = 0;
      for (const el of hover) if (h < maxHover && add(el, "hover")) h++;
      const click = [...document.querySelectorAll("[role=tab]:not([aria-selected=true]), button[aria-expanded], [role=button][aria-expanded], button[aria-controls], summary")].filter((el) => {
        if (!shown(el) || el.closest("a, form") || el.disabled || el.getAttribute("type") === "submit") return false;
        if (el.getAttribute("aria-selected") === "true") return false;
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim();
        return text.length <= 60 && !RISKY.test(text) && !RISKY.test(el.getAttribute("aria-label") || "");
      });
      let c = 0;
      for (const el of click) if (c < maxClick && add(el, "click")) c++;
      globalThis.__pivotTargets = pick.map((p) => p.el);
      return pick.map((p, i) => ({ i, kind: p.kind, el: idOf(p.el) }));
    },
    // scrolls a candidate to the middle of the screen; its box, the scroll position, and whether the point at its
    // centre is the element itself (nothing covers it)
    reveal(i) {
      const el = (globalThis.__pivotTargets || [])[i];
      if (!el || !el.isConnected) return null;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const sc = document.scrollingElement || document.documentElement;
      return { x: r.left, y: r.top, w: r.width, h: r.height, cx, cy, at: window.scrollY || sc.scrollTop, clear: !!hit && (hit === el || el.contains(hit)), expanded: el.getAttribute("aria-expanded") };
    },
    expanded(i) {
      const el = (globalThis.__pivotTargets || [])[i];
      return el ? el.getAttribute("aria-expanded") : null;
    },
  };
  return true;
})()`;

/**
 * Reads GSAP, ScrollTrigger and Lenis from the page's own world, read-only. `full` also lists every ScrollTrigger;
 * otherwise only the tweens that started since the last call. Tweens already reported are remembered in a WeakSet
 * kept on a non-enumerable property, the one thing this leaves on the page.
 */
export const motionLibraries = (full: boolean) => `(() => {
  ${DESCRIBE}
  const round = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n * 1000) / 1000 : undefined);
  const targetOf = (el) => (el && el.tagName ? { name: nameOf(el), selector: selectorOf(el) } : null);
  const out = { libraries: [] };
  let seen = window.__pivotMotionSeen;
  if (!seen) {
    seen = new WeakSet();
    try { Object.defineProperty(window, "__pivotMotionSeen", { value: seen, enumerable: false }); } catch {}
  }
  const SKIP = new Set(["ease", "duration", "delay", "stagger", "scrollTrigger", "onComplete", "onUpdate", "onStart", "onRepeat", "onReverseComplete", "overwrite", "immediateRender", "id", "paused", "data", "lazy", "callbackScope", "repeat", "yoyo", "repeatDelay", "runBackwards", "startAt", "keyframes", "inherit", "parent", "reversed", "smoothChildTiming", "autoRemoveChildren", "defaults", "transformOrigin", "force3D"]);
  const valueOf = (v) => (typeof v === "number" ? round(v) : typeof v === "string" ? v.slice(0, 40) : undefined);
  try {
    const g = window.gsap;
    if (g && g.globalTimeline) {
      out.libraries.push("GSAP" + (g.version ? " " + g.version : ""));
      out.tweens = [];
      for (const t of g.globalTimeline.getChildren(true, true, false)) {
        if (seen.has(t) || !t.isActive || (!t.isActive() && !t.scrollTrigger)) continue;
        seen.add(t);
        const vars = t.vars || {};
        const targets = t.targets ? t.targets().filter((x) => x && x.tagName) : [];
        if (!targets.length) continue;
        const props = Object.keys(vars).filter((k) => !SKIP.has(k)).slice(0, 6).map((k) => ({ property: k, to: valueOf(vars[k]) })).filter((p) => p.to !== undefined);
        if (!props.length) continue;
        const st = t.scrollTrigger;
        out.tweens.push({
          duration: round(t.duration() * 1000),
          delay: round((t.delay ? t.delay() : 0) * 1000),
          ease: typeof vars.ease === "string" ? vars.ease : vars.ease ? "custom" : "power1.out",
          stagger: typeof vars.stagger === "number" ? round(vars.stagger * 1000) : vars.stagger && typeof vars.stagger.each === "number" ? round(vars.stagger.each * 1000) : undefined,
          props,
          from: !!vars.runBackwards,
          count: targets.length,
          target: targetOf(targets[0]),
          scrollTrigger: st ? { start: round(st.start), end: round(st.end), scrub: vars.scrollTrigger && vars.scrollTrigger.scrub !== undefined ? vars.scrollTrigger.scrub : undefined } : undefined,
        });
      }
    }
    const ST = window.ScrollTrigger;
    if (ST && ST.getAll) {
      out.libraries.push("ScrollTrigger");
      ${
        full
          ? `
      out.triggers = ST.getAll().slice(0, 60).map((s) => {
        const anim = s.animation;
        const vars = (anim && anim.vars) || {};
        const props = Object.keys(vars).filter((k) => !SKIP.has(k)).slice(0, 6).map((k) => ({ property: k, to: valueOf(vars[k]) })).filter((p) => p.to !== undefined);
        const targets = anim && anim.targets ? anim.targets().filter((x) => x && x.tagName) : [];
        return {
          start: round(s.start),
          end: round(s.end),
          scrub: s.vars ? (s.vars.scrub === undefined ? false : s.vars.scrub) : false,
          pin: s.pin ? targetOf(s.pin) : undefined,
          trigger: targetOf(s.trigger),
          target: targets.length ? targetOf(targets[0]) : undefined,
          count: targets.length,
          props,
          duration: anim ? round(anim.duration() * 1000) : undefined,
          ease: typeof vars.ease === "string" ? vars.ease : undefined,
          from: !!vars.runBackwards,
        };
      });
      `
          : ""
      }
    }
  } catch {}
  ${
    full
      ? `
  const lenis = window.lenis || window.__lenis;
  if (lenis || /(^|\\s)lenis(\\s|$)/.test(document.documentElement.className)) {
    out.libraries.push("Lenis");
    try { if (lenis && lenis.options) out.lenis = { lerp: round(lenis.options.lerp), duration: round(lenis.options.duration) }; } catch { out.lenis = {}; }
    if (!out.lenis) out.lenis = {};
  }
  if (window.locomotiveScroll || window.LocomotiveScroll) out.libraries.push("Locomotive Scroll");
  if (document.querySelector("[data-framer-appear-id], [data-projection-id]")) out.libraries.push("Framer Motion");
  if (window.THREE || window.__THREE__) out.libraries.push("three.js");
  `
      : ""
  }
  return out;
})()`;
