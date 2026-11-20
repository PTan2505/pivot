#!/usr/bin/env node
// Interactive preview of a design session's mockups: node preview.mjs <sessionId> [--round <n>] [--url <PIVOT url>]
//   [--timeout-min 240]
//
// Opens a separate Chromium window where the user tries the versions of a round: interactive versions run their own
// scripts, static ones don't. The version fills the window like the real site; a floating quick bar steps through the
// versions and opens a controls drawer (the layout of PIVOT's full-screen mockup view): version tabs (keys 1–9, ←/→),
// Desktop / Tablet / Phone, Motion: Reduced (emulates prefers-reduced-motion), Replay, Compare (side by side), and the
// version's id and digest, the same digest PIVOT shows next to "Approve this version".
//
// How it stays contained (PIVOT never runs mockup scripts on its own origin):
// - Integrity: every version is fetched from PIVOT and its digest recomputed (sha256 of the stored HTML and its
//   interactive flag, as PIVOT computes it). One mismatch and nothing is shown: the preview is always the stored copy
//   an approval binds to.
// - Files: a local server on 127.0.0.1 serves only those checked versions from memory and the preview's own page. It
//   never reads a file path; mockups were inlined (contained to their folder) when they were saved.
// - Network: the browser's only way out is motion QA's gate (motion-qa.mjs): an HTTP proxy that lets through only
//   this preview's exact origin, with WebRTC and DNS switched off and the WebRTC constructors removed. PIVOT itself is
//   never reachable from this window, so nothing here can approve, edit or read the library.
// - Page: each version runs in a sandboxed frame with an opaque origin (no same-origin, no top navigation, popups or
//   forms) and a strict policy (no connections, frames or workers). The preview's controls live outside it; the one
//   privileged control (reduced motion) only answers the preview's own page, never a mockup frame.
//
// Approval stays where it is: the user approves the version in PIVOT ("Approve this version", bound to the digest) or
// says so in the chat (recorded with the version's id and digest). This window can't approve anything. Its
// "Choose this version" button sends the user's pick (and an optional note for the build) to the agent that opened it:
// the preview prints {"event":"chosen",…} with the version's id and digest, as checked here, and closes, which wakes
// the agent. A pick is not an approval: the agent then asks the user to approve that version in the chat or in PIVOT.
//
// Comment (live feedback): the window has two modes, Use (the version runs as it is) and Comment (⌥C, or the switch in
// the quick bar and the drawer). In Comment a transparent shield over the version takes every pointer event, so the
// mockup's own handlers never fire, and its keys, clicks and form submits are paused inside it; what it had open (a
// menu, a tab) stays as it is. The preview's page asks this process, through its main-frame-only binding, what is
// under the pointer; this process reads it in an isolated world of the version's frame (CDP: the mockup's scripts can
// neither see that world nor replace its DOM functions), scrolls the frame for forwarded wheel events, and takes the
// note's crop from the page itself when the note is made, with the preview's own chrome hidden for the shot. Crops stay
// in this process until the notes are sent; the page only ever gets text it shows with textContent.
//
// Prints one JSON line when ready ({"event":"ready",…}), one for a pick ({"event":"chosen",…}), one for each piece of
// feedback the user sent with "Send to Claude" ({"event":"feedback",…,"notes":N}: this process posts the text and the
// live notes to PIVOT as feedback from PIVOT's page, so the window stays open and an agent's watcher wakes on it) and
// one when the window closes ({"event":"closed"}).
// Exits 2 when a version doesn't match its digest, 1 on other errors.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { destinationPolicy, guardContext, launchOptions, loadPlaywright, originKey, startGate } from "./motion-qa.mjs";

export const PREVIEW_VERSION = "1.2.0";
/** The widths the preview offers, as PIVOT's session page does. */
export const WIDTHS = { desktop: 1440, tablet: 768, phone: 390 };
/**
 * Live notes, as PIVOT takes them (packages/core/src/design-feedback.ts FEEDBACK_LIMITS and RENDER_WIDTH): a crop is
 * kept under 200 kB (PIVOT allows 400 kB) so a full draft of 30 fits PIVOT's 6 MB a send, and 2,400 px a side.
 */
export const NOTE_LIMITS = {
  notes: 30,
  text: 1000,
  cropBytes: 200_000,
  cropEdge: 2400,
  width: { min: 320, max: 2560 },
  height: { min: 200, max: 4000 },
  pageHeight: 12_000,
};

export class PreviewError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** A version's content identity, exactly as PIVOT computes it (packages/core/src/design.ts, mockupDigest). */
export function mockupDigest(html, interactive = false) {
  return crypto
    .createHash("sha256")
    .update(`pivot-mockup:v1:${interactive ? "interactive" : "static"}:${html}`)
    .digest("hex");
}

/** The policy a version runs under: no connections, frames, workers or forms; scripts only when interactive. */
export const versionPolicy = (interactive) =>
  [
    "default-src 'none'",
    `script-src ${interactive ? "'unsafe-inline'" : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
  ].join("; ");
/** The sandbox of a version's frame: never allow-same-origin, top navigation, popups, forms or modals. */
export const versionSandbox = (interactive) => (interactive ? "allow-scripts" : "");

/** The isolated world this process reads and guards the version's frame in, and the binding only that world has. */
const WORLD = "pivot-preview";
const KEY_BINDING = "__pivotPreviewKey";
const KEYS = new Set(["mode", "escape", "select", "pin"]);

/**
 * Runs in the version frame's isolated world (installed when its document starts, again on each mode change): ⌥C
 * switches Use / Comment from inside the mockup too; while commenting, the page's keys, clicks and form submits stop
 * inside it (Esc, V and P are passed on to the preview, V and P never while a field of the page has focus). Only the
 * user's own input counts (`isTrusted`): an event a mockup's script makes is ignored. Idempotent: one world per name.
 */
const GUARD = String.raw`((paused) => {
  if (globalThis.__pivotGuard) { globalThis.__pivotGuard.paused = paused; return "updated"; }
  const st = (globalThis.__pivotGuard = { paused });
  const tell = (k) => { try { globalThis.${KEY_BINDING}(k); } catch {} };
  const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
  const typing = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""));
  const altC = (e) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyC";
  addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    if (altC(e)) { stop(e); if (!e.repeat) tell("mode"); return; }
    if (!st.paused) return;
    stop(e);
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === "Escape") tell("escape");
    else if (!typing(e.target) && e.code === "KeyV") tell("select");
    else if (!typing(e.target) && e.code === "KeyP") tell("pin");
  }, true);
  addEventListener("keyup", (e) => { if (e.isTrusted && (st.paused || altC(e))) stop(e); }, true);
  for (const t of ["keypress", "beforeinput", "click", "dblclick", "auxclick", "contextmenu", "pointerdown", "pointerup",
    "mousedown", "mouseup", "touchstart", "touchend", "submit"])
    addEventListener(t, (e) => { if (e.isTrusted && st.paused) stop(e); }, true);
  return "installed";
})`;

/**
 * Runs in the isolated world: the element under a point of the frame's viewport, named and placed as PIVOT's element
 * map does (packages/core/src/capture.ts MAP_PAGE: selector, own text, label; ELEMENTS_HTML: the trimmed HTML). It
 * takes its DOM functions from its own world, which the mockup's scripts can't replace.
 */
const PROBE = String.raw`((x, y, max) => {
  const esc = (v) => CSS.escape(v);
  const uniqueId = (e) => { if (!e.id) return false; try { return document.querySelectorAll("#" + esc(e.id)).length === 1; } catch { return false; } };
  const selector = (e) => {
    if (e === document.body) return "body";
    if (uniqueId(e)) return "#" + esc(e.id);
    let step = e.tagName.toLowerCase();
    const cls = [...e.classList].filter((c) => /^-?[A-Za-z_][\w-]*$/.test(c)).slice(0, 2);
    step += cls.map((c) => "." + esc(c)).join("");
    const parent = e.parentElement;
    if (parent) { const same = [...parent.children].filter((c) => c.tagName === e.tagName); if (same.length > 1) step += ":nth-of-type(" + (same.indexOf(e) + 1) + ")"; }
    return parent && parent !== document.documentElement ? selector(parent) + " > " + step : step;
  };
  const short = (v, n = 80) => { const t = (v || "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, n) : undefined; };
  const trimmed = (el) => {
    const copy = el.cloneNode(true);
    for (const e of [copy, ...copy.querySelectorAll("*")]) {
      if (e.tagName.toLowerCase() === "svg") e.innerHTML = "…";
      for (const a of [...e.attributes]) {
        if (/^data:/i.test(a.value)) e.setAttribute(a.name, a.value.slice(0, (a.value.indexOf(",") + 1) || 30) + "…");
        else if (a.value.length > 120) e.setAttribute(a.name, a.value.slice(0, 120) + "…");
      }
    }
    const out = copy.outerHTML.replace(/\s{2,}/g, " ");
    return out.length > max ? out.slice(0, max) + "…" : out;
  };
  const sc = { x: scrollX, y: scrollY }, vp = { w: innerWidth, h: innerHeight };
  const doc = { x: Math.round(x + sc.x), y: Math.round(y + sc.y) };
  const el = document.elementFromPoint(x, y);
  if (!el || el === document.documentElement || el === document.body) return { scroll: sc, viewport: vp, doc };
  const r = el.getBoundingClientRect();
  return {
    scroll: sc, viewport: vp, doc,
    selector: selector(el), tag: el.tagName.toLowerCase(), id: el.id ? el.id.slice(0, 80) : undefined,
    classes: [...el.classList].slice(0, 3).map((k) => k.slice(0, 60)),
    text: short([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ")),
    label: short(el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || el.getAttribute("title")),
    box: { x: r.left + sc.x, y: r.top + sc.y, w: r.width, h: r.height },
    client: { x: r.left, y: r.top, w: r.width, h: r.height },
    html: trimmed(el),
  };
})`;

/** Runs in the isolated world: scrolls the nearest scrollable box under a point (else the page) by a wheel's delta. */
const SCROLL = String.raw`((x, y, dx, dy) => {
  const can = (el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth); };
  let e = document.elementFromPoint(x, y);
  while (e && e !== document.body && e !== document.documentElement && !can(e)) e = e.parentElement;
  const target = e && e !== document.body && e !== document.documentElement ? e : document.scrollingElement;
  if (target) target.scrollBy({ left: dx, top: dy, behavior: "instant" });
  return true;
})`;

const LOOK = "({ scroll: { x: scrollX, y: scrollY }, viewport: { w: innerWidth, h: innerHeight } })";

/** A JPEG's pixel size, read from its frame header (no image library needed). */
export function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const words = (v, max) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t ? t.slice(0, max) : undefined;
};

/** The element a live note names, from the isolated world's answer, cut to PIVOT's limits; null when unusable. */
function noteElement(hit, width) {
  const tag = words(hit?.tag, 40)?.toLowerCase();
  const selector = words(hit?.selector, 1000);
  if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag) || !selector || !hit.box) return null;
  let [x, y, w, h] = [hit.box.x, hit.box.y, hit.box.w, hit.box.h].map((v) => Math.round(num(v)));
  // an element partly left of or above the page keeps its visible part
  if (x < 0) [w, x] = [w + x, 0];
  if (y < 0) [h, y] = [h + y, 0];
  if (x > width || y > NOTE_LIMITS.pageHeight) return null;
  const classes = (Array.isArray(hit.classes) ? hit.classes : []).map((c) => words(c, 60)).filter(Boolean);
  const id = words(hit.id, 80);
  const text = words(hit.text, 80);
  const label = words(hit.label, 80);
  const html = typeof hit.html === "string" && hit.html.trim() ? hit.html.trim().slice(0, 2000) : undefined;
  return {
    selector,
    tag,
    ...(id ? { id } : {}),
    ...(classes.length ? { classes: classes.slice(0, 3) } : {}),
    ...(text ? { text } : {}),
    ...(label ? { label } : {}),
    box: { x, y, w: Math.max(0, w), h: Math.max(0, h) },
    ...(html ? { html } : {}),
  };
}
/** What the preview's page may see of an element: what it names and places it with. Never its HTML. */
const shown = (e) => e && { tag: e.tag, id: e.id, classes: e.classes, text: e.text, label: e.label, box: e.box };

/**
 * Comment mode's reading side, in this process: an isolated world in the version's frame (in the page's own CDP
 * session when the frame runs in the page's process, as in the headless shell; in the frame's own session when it is
 * out of process, as in full Chromium), the guard installed in it, element reads, forwarded scrolling, and crops.
 */
function liveLayer({ context, onKey }) {
  let page = null;
  let pageSession = null;
  let cur = null;
  let paused = false;
  // device pixels per CSS pixel in screenshots: 2 on a Retina screen in the window, 1 where the page is emulated
  let pxRatio = 1;
  const ours = new Set();
  const wired = new WeakSet();
  /** The notes' crops and elements, until they are sent or dropped: key -> note. */
  const notes = new Map();

  async function wire(session) {
    if (wired.has(session)) return;
    wired.add(session);
    session.on("Runtime.executionContextCreated", ({ context: c }) => {
      if (c.name === WORLD) ours.add(c.id);
    });
    session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => ours.delete(executionContextId));
    // only this process's own world has the binding; the mockup's main world can't call it
    session.on("Runtime.bindingCalled", (e) => {
      if (e.name === KEY_BINDING && ours.has(e.executionContextId) && KEYS.has(e.payload)) onKey(e.payload);
    });
    await session.send("Runtime.enable");
    await session.send("Runtime.addBinding", { name: KEY_BINDING, executionContextName: WORLD });
  }
  const versionFrame = () => page?.frames().find((f) => f.parentFrame() === page.mainFrame());
  // one CDP session per frame, kept: a second session on the same frame would add the key binding twice
  const sessions = new WeakMap();
  async function frameSession(frame) {
    for (let i = 0; i < 2; i++) {
      let session = sessions.get(frame);
      if (!session) {
        session = await context.newCDPSession(frame).catch(() => pageSession); // out of process, or the page's own
        sessions.set(frame, session);
      }
      try {
        if (session !== pageSession)
          return { session, frameId: (await session.send("Page.getFrameTree")).frameTree.frame.id };
        // in the page's process: the page's own session, the child frame's id
        const kids = (await session.send("Page.getFrameTree")).frameTree.childFrames ?? [];
        const frameId = (kids.find((k) => k.frame.url === frame.url()) ?? kids[0])?.frame.id;
        if (frameId) return { session, frameId };
      } catch {}
      sessions.delete(frame); // the frame moved to another process: a new session for it
      if (session !== pageSession) await session.detach().catch(() => {});
    }
    throw new Error("no session for the version's frame");
  }
  let building = null;
  async function world() {
    const frame = versionFrame();
    if (!frame) throw new Error("no version frame");
    if (cur?.frame === frame && !frame.isDetached()) return cur;
    if (building) return building;
    building = (async () => {
      const { session, frameId } = await frameSession(frame);
      await wire(session);
      const { executionContextId } = await session.send("Page.createIsolatedWorld", {
        frameId,
        worldName: WORLD,
        grantUniveralAccess: false,
      });
      ours.add(executionContextId);
      await session.send("Runtime.evaluate", { expression: `${GUARD}(${paused})`, contextId: executionContextId });
      cur = { frame, session, ctx: executionContextId };
      return cur;
    })().finally(() => (building = null));
    return building;
  }
  async function run(expression) {
    for (let i = 0; i < 2; i++) {
      try {
        const w = await world();
        const r = await w.session.send("Runtime.evaluate", { expression, contextId: w.ctx, returnByValue: true });
        if (!r.exceptionDetails) return r.result.value;
      } catch {}
      cur = null; // the frame's document changed: a new world, once more
    }
    throw new Error("Couldn't read the version's page.");
  }

  // The crop: the element's box (or a 160 px square around a spot) as the user saw it, cut to the frame's visible part
  // and the window, taken from the page with the preview's own chrome hidden.
  async function capture(hit, tool, { pad = 16 } = {}) {
    const g = await page.evaluate(() => {
      const f = document.querySelector("#stage iframe");
      if (!f) return null;
      const r = f.getBoundingClientRect();
      const b = f.parentElement.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        l: b.left,
        t: b.top,
        r: b.right,
        b: b.bottom,
        vw: innerWidth,
        vh: innerHeight,
      };
    });
    if (!g || !hit.viewport?.w) throw new Error("no version frame");
    const s = g.w / hit.viewport.w; // the frame's scale in the page (Tablet and Phone in a narrow window)
    const vis = { l: Math.max(g.l, 0), t: Math.max(g.t, 0), r: Math.min(g.r, g.vw), b: Math.min(g.b, g.vh) };
    const at = { x: hit.doc.x - hit.scroll.x, y: hit.doc.y - hit.scroll.y };
    const src = tool === "select" && hit.client ? hit.client : { x: at.x - 80, y: at.y - 80, w: 160, h: 160 };
    const cut = (b) => ({
      l: Math.max(vis.l, g.x + b.x * s - pad),
      t: Math.max(vis.t, g.y + b.y * s - pad),
      r: Math.min(vis.r, g.x + (b.x + b.w) * s + pad),
      b: Math.min(vis.b, g.y + (b.y + b.h) * s + pad),
    });
    let c = cut(src);
    if (c.r - c.l < 8 || c.b - c.t < 8) c = cut({ x: at.x - 80, y: at.y - 80, w: 160, h: 160 });
    const clip = {
      x: Math.floor(c.l),
      y: Math.floor(c.t),
      width: Math.max(1, Math.ceil(c.r) - Math.floor(c.l)),
      height: Math.max(1, Math.ceil(c.b) - Math.floor(c.t)),
    };
    const edge = NOTE_LIMITS.cropEdge;
    let base = Math.min(1, edge / clip.width, edge / clip.height) / pxRatio;
    await page.evaluate(
      () =>
        new Promise((r) => {
          document.body.classList.add("capturing");
          requestAnimationFrame(() => requestAnimationFrame(r));
        }),
    );
    let shot = null;
    try {
      const steps = [
        [80, 1],
        [65, 1],
        [50, 1],
        [50, 0.7],
        [45, 0.5],
        [40, 0.35],
        [40, 0.25],
      ];
      for (let i = 0, fixed = false; i < steps.length; i++) {
        const [quality, k] = steps[i];
        const r = await pageSession.send("Page.captureScreenshot", {
          format: "jpeg",
          quality,
          clip: { ...clip, scale: base * k },
          captureBeyondViewport: false,
        });
        const image = Buffer.from(r.data, "base64");
        const d = jpegSize(image);
        // a screen with more device pixels than CSS pixels: take it again at the CSS size, once
        const want = clip.width * base * k * pxRatio;
        const ratio = d && want >= 50 ? d.w / want : 1;
        if (!fixed && ratio > 1.05) {
          fixed = true;
          pxRatio *= ratio;
          base /= ratio;
          i--;
          continue;
        }
        if (d && d.w <= edge && d.h <= edge && image.length <= NOTE_LIMITS.cropBytes) {
          shot = { image, quality, w: d.w, h: d.h };
          break;
        }
      }
    } finally {
      await page.evaluate(() => document.body.classList.remove("capturing")).catch(() => {});
    }
    if (!shot) throw new Error("The crop stays too large.");
    const region = {
      left: Math.max(0, Math.round((clip.x - g.x) / s + hit.scroll.x)),
      top: Math.max(0, Math.round((clip.y - g.y) / s + hit.scroll.y)),
      width: Math.round(clip.width / s),
      height: Math.round(clip.height / s),
    };
    return { ...shot, region };
  }

  return {
    notes,
    /** A new page (the first one, or after a crash): nothing of the last one's frames or notes is kept. */
    async attach(p) {
      page = p;
      cur = null;
      paused = false;
      notes.clear();
      pageSession = await context.newCDPSession(p);
      await wire(pageSession);
    },
    /** The version's frame has a new document: put the guard in it. */
    async install(frame) {
      if (frame !== versionFrame()) return;
      cur = null;
      await run(`${GUARD}(${paused})`).catch(() => {});
    },
    get commenting() {
      return paused;
    },
    async setMode(comment) {
      paused = comment;
      await run(`${GUARD}(${comment})`).catch(() => {});
      return comment ? run(LOOK).catch(() => null) : true;
    },
    hover: ({ x, y }) => run(`${PROBE}(${num(x)}, ${num(y)}, 2000)`),
    async wheel({ x, y, dx, dy }) {
      await run(`${SCROLL}(${num(x)}, ${num(y)}, ${num(dx)}, ${num(dy)})`);
      return run(`${PROBE}(${num(x)}, ${num(y)}, 2000)`);
    },
    /** A note on the element or spot at a point: read, cropped and kept here; the page gets its key and place. */
    async pick({ x, y, tool }, v) {
      const hit = await run(`${PROBE}(${num(x)}, ${num(y)}, 2000)`);
      const width = Math.round(num(hit?.viewport?.w));
      const height = Math.round(num(hit?.viewport?.h));
      if (width < NOTE_LIMITS.width.min || width > NOTE_LIMITS.width.max)
        return { error: `Notes need a page ${NOTE_LIMITS.width.min} to ${NOTE_LIMITS.width.max} px wide.` };
      if ([...notes.values()].filter((n) => n.v === v.n).length >= NOTE_LIMITS.notes)
        return { error: `At most ${NOTE_LIMITS.notes} notes at a time: send these first.` };
      const element = tool === "select" ? noteElement(hit, width) : null;
      const crop = await capture(hit, element ? "select" : "pin");
      const key = crypto.randomBytes(12).toString("hex");
      const note = {
        v: v.n,
        width,
        height,
        x: Math.min(width, Math.max(0, hit.doc.x)),
        y: Math.min(NOTE_LIMITS.pageHeight, Math.max(0, hit.doc.y)),
        element,
        image: crop.image.toString("base64"),
        region: crop.region,
      };
      notes.set(key, note);
      return { key, x: note.x, y: note.y, width, element: shown(element), scroll: hit.scroll };
    },
  };
}

/**
 * Reads a round of a session from PIVOT and checks every version against its digest. Fails closed: a version whose
 * HTML doesn't hash to its stored digest stops the preview (PreviewError, code 2) before anything is shown.
 */
export async function loadVersions({ base, sessionId, round, fetchImpl = fetch }) {
  const get = async (p) => {
    const res = await fetchImpl(`${base}${p}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new PreviewError(`PIVOT has no ${p}.`);
    if (!res.ok) throw new PreviewError(`PIVOT answered ${res.status} for ${p}.`);
    return res;
  };
  const session = await (await get(`/api/design/sessions/${encodeURIComponent(sessionId)}`)).json();
  if (session.id !== sessionId) throw new PreviewError(`PIVOT answered with another session (${session.id}).`);
  const mockups = session.mockups ?? [];
  if (!mockups.length) throw new PreviewError("This session has no mockups yet: save a round first.");
  const want = round ?? Math.max(...mockups.map((m) => m.round));
  const chosen = mockups.filter((m) => m.round === want).sort((a, b) => a.n - b.n);
  if (!chosen.length) throw new PreviewError(`This session has no round ${want}.`);
  const versions = [];
  for (const m of chosen) {
    const html = await (await get(`/api/design/mockups/${encodeURIComponent(m.id)}`)).text();
    const digest = mockupDigest(html, m.interactive === true);
    if (digest !== m.digest)
      throw new PreviewError(
        `Version ${m.n} doesn't match its stored digest (${String(m.digest).slice(0, 12)}, got ${digest.slice(0, 12)}): nothing is shown.`,
        2,
      );
    versions.push({
      id: m.id,
      n: m.n,
      round: m.round,
      title: m.title,
      interactive: m.interactive === true,
      digest,
      html,
    });
  }
  return { session: { id: session.id, title: session.title, status: session.status, round: want }, versions };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The preview's own page. Its script is served from /shell.js, so the page's policy allows no inline script. */
function shellHtml({ session, pivotPage }) {
  const icon = (d, s = 16) =>
    `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v1"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
    comment:
      '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 8v6"/><path d="M9 11h6"/>',
    cursor:
      '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
    pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  };
  // the mode switch, in the quick bar and in the drawer's Comment section
  const modes = (id) =>
    `<span id="${id}" class="seg" role="radiogroup" aria-label="Mode"><button role="radio" data-mode="use" aria-checked="true">${icon(I.hand, 14)}Use</button><button role="radio" data-mode="comment" aria-checked="false" aria-keyshortcuts="Alt+C">${icon(I.comment, 14)}Comment</button></span>`;
  const tools = (id) =>
    `<span id="${id}" class="seg" role="radiogroup" aria-label="Tool"><button role="radio" data-tool="select" aria-checked="true" aria-keyshortcuts="V">${icon(I.cursor, 14)}Select <kbd>V</kbd></button><button role="radio" data-tool="pin" aria-checked="false" aria-keyshortcuts="P">${icon(I.pin, 14)}Pin <kbd>P</kbd></button></span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview · ${esc(session.title)}</title><link rel="stylesheet" href="/shell.css"></head><body class="open">
<main id="stage"></main>
<div id="cshield" hidden></div>
<div id="ov"><div id="hl" hidden><span id="chip"></span></div></div>
<div id="ctool" class="ctool glass" role="toolbar" aria-label="Comment on the page" hidden>${tools("ctools")}
  <span id="chint" role="status">Commenting · page paused · Esc to use it</span>
  <button id="centre" class="sec">${icon(I.plus, 14)}<span id="centre-label">Comment at centre</span></button><button id="done" class="inv">Done</button></div>
<div id="pop" class="pop glass" role="dialog" aria-labelledby="pop-label" hidden><p id="pop-label"></p>
  <textarea id="pop-text" maxlength="${NOTE_LIMITS.text}" rows="3" placeholder="What should change here?" aria-labelledby="pop-label"></textarea>
  <div class="pfoot"><span>Captured as you see it</span><button id="pop-del">${icon(I.trash, 13)}Delete</button></div></div>
<div id="bar-place" class="bar-place bottom"><div id="bar" class="bar glass" role="toolbar" aria-label="Versions">
  <button id="prev" class="icon" aria-label="Previous version">${icon('<path d="m15 18-6-6 6-6"/>')}</button>
  <span class="pos" aria-live="polite"><span id="pos-sr" class="sr"></span><span id="pos-num" class="mono muted" aria-hidden="true"></span><span id="pos-title" aria-hidden="true"></span></span>
  <button id="next" class="icon" aria-label="Next version">${icon('<path d="m9 18 6-6-6-6"/>')}</button>
  <span class="sep" aria-hidden="true"></span>${modes("qmode")}<span id="qcount" class="mono muted small" hidden></span>
  <button id="toggle" class="icon" aria-label="Preview controls" aria-expanded="true" aria-controls="drawer">${icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>')}<span id="dot" class="dot" aria-hidden="true"></span></button>
</div></div>
<aside id="drawer" class="glass" data-state="open" aria-labelledby="drawer-title">
  <div class="head"><div class="grow"><span class="kicker">Interactive preview</span><h2 id="drawer-title">${esc(session.title)}</h2>
    <p class="muted">Round ${session.round} · from PIVOT at ${esc(new URL(pivotPage).origin)}</p></div>
    <button id="close" class="icon raised" aria-label="Close preview controls">${icon('<path d="M18 6 6 18M6 6l12 12"/>')}</button></div>
  <div class="body">
    <section><h3>Versions <span class="hint">· keys 1–9, ← →</span></h3><nav id="tabs" role="tablist" aria-orientation="vertical" aria-label="Versions"></nav>
      <p id="paused" class="muted small" role="status" hidden>Shortcuts paused while the mockup has focus (⌥C still switches to Comment). Press Tab to leave it.</p></section>
    <section><h3>View</h3>
      <div class="group" role="group" aria-label="Width"><button data-width="desktop" aria-pressed="true">Desktop</button><button data-width="tablet" aria-pressed="false">Tablet</button><button data-width="phone" aria-pressed="false">Phone</button></div>
      <p id="scaled" class="muted small" hidden></p>
      <div class="group" role="group" aria-label="Motion"><button data-motion="no-preference" aria-pressed="true">Motion: full</button><button data-motion="reduce" aria-pressed="false">Motion: reduced</button></div>
      <p id="media" class="muted small"></p></section>
    <section id="comment"><h3>Comment <span class="hint">· ⌥C</span></h3>${modes("dmode")}
      <div id="dtools-row" hidden>${tools("dtools")}</div>
      <p id="comment-off" class="muted small" hidden>Comment works on one version: leave Compare first.</p>
      <p id="notes-empty" class="muted small">Use the page first: open the menu or tab you want, then switch to Comment.</p>
      <ol id="notes" aria-label="Notes"></ol>
      <textarea id="fb-text" maxlength="5000" rows="2" placeholder="Feedback for Claude (optional text)" aria-label="Feedback for Claude"></textarea>
      <button id="fb-send" class="inv wide" disabled>${icon(I.send, 15)}Send to Claude</button><p id="fb-status" class="small muted" role="status"></p></section>
    <section><h3>Tools</h3><div class="group"><button id="replay">Replay</button><button id="compare" aria-pressed="false">Compare</button></div>
      <div class="group places"><span class="muted small" id="bar-label">Quick bar</span><span role="radiogroup" aria-labelledby="bar-label" class="group"><button role="radio" data-place="bottom" aria-checked="true">Bottom</button><button role="radio" data-place="top" aria-checked="false">Top</button><button role="radio" data-place="dot" aria-checked="false">Dot</button></span></div></section>
  </div>
  <div class="foot"><div id="identity" class="mono small"></div>
    <div class="choose"><button id="choose" class="primary">Choose this version</button>
    <span id="confirm" hidden>Send <b id="chosen"></b> to Claude as your choice? This window closes, and Claude asks you to approve it.
    <input id="note" maxlength="2000" placeholder="Note for the build (optional)" aria-label="Note for the build (optional)">
    <span class="group"><button id="send" class="primary">Send to Claude</button><button id="cancel">Cancel</button></span></span></div>
    <div class="approve muted small">Or approve it yourself: open the session in PIVOT and press <b>Approve this version</b> on the same version (PIVOT shows the same digest).
    <span class="group"><input id="pivot" readonly value="${esc(pivotPage)}" aria-label="PIVOT session page"><button id="copy">Copy link</button></span></div></div>
</aside>
<div id="shield" class="shield" hidden></div>
<script src="/shell.js"></script></body></html>`;
}

// PIVOT's tokens (apps/web/src/app/globals.css), repeated here: the preview is its own page on its own origin.
const SHELL_CSS = `:root{color-scheme:dark;--canvas:#0c0806;--surface:#18110d;--raised:#221812;--divider:#33251c;--ink:#fbf3ea;--ink2:#e0d3c7;--muted:#b8a596;--subtle:#94806f;
--accent-fill:#ff6a13;--accent-text:#ff8c42;--glass:rgb(34 24 18/.86);--edge:rgb(255 238 222/.1);--drawer:cubic-bezier(.32,.72,0,1);--out:cubic-bezier(.23,1,.32,1)}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;overflow:hidden;background:var(--canvas);color:var(--ink);font:14px/1.45 Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}.small{font-size:13px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.glass{background:var(--glass);border:1px solid var(--edge);-webkit-backdrop-filter:blur(24px) saturate(1.5);backdrop-filter:blur(24px) saturate(1.5);box-shadow:inset 0 1px 0 rgb(255 248 240/.07),0 24px 64px rgb(0 0 0/.6),0 2px 8px rgb(0 0 0/.35)}
button{font:inherit;font-size:13px;font-weight:500;color:var(--ink2);background:var(--surface);border:0;border-radius:999px;height:32px;padding:0 12px;cursor:pointer;transition:background-color 150ms ease-out}
button:hover{background:var(--raised);color:var(--ink)}
button[aria-pressed=true],button[aria-checked=true],button[aria-selected=true]{background:var(--ink);color:var(--canvas)}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px}
button.primary{background:var(--accent-fill);color:var(--canvas);height:40px;width:100%}button.primary:hover{background:color-mix(in srgb,var(--accent-fill) 90%,transparent)}
button:disabled{opacity:.4;cursor:default}
button.icon{width:36px;height:36px;padding:0;display:grid;place-items:center;background:transparent}button.icon.raised{background:var(--raised);width:32px;height:32px}
.group{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
input{font:inherit;font-size:13px;background:var(--surface);color:var(--ink);border:0;border-radius:999px;height:36px;padding:0 14px;width:100%}
#stage{position:fixed;inset:0;overflow:auto;display:flex;gap:12px;justify-content:center;align-items:flex-start}
#stage.compare{padding:16px 16px 76px}
.cell{display:flex;flex-direction:column;gap:6px;flex:none}.cell .label{color:var(--muted);font-size:12px}
.frame{background:#fff;overflow:hidden;flex:none}#stage.compare .frame{border-radius:8px}
iframe{border:0;display:block;background:#fff;transform-origin:top left}
#crashed{margin:auto;max-width:28em;text-align:center}
/* quick bar: centred at the bottom (or top), beside the drawer while it is open */
.bar-place{position:fixed;z-index:40;left:50%;transform:translateX(-50%)}
.bar-place.bottom{bottom:calc(16px + env(safe-area-inset-bottom))}.bar-place.top{top:calc(16px + env(safe-area-inset-top))}
.bar-place.dot{left:auto;right:calc(16px + env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));transform:none}
body.ready .bar-place{transition:transform 250ms var(--drawer)}
@media (min-width:640px){body.open .bar-place:not(.dot){transform:translateX(calc(-50% - 192px))}}
.bar{display:flex;align-items:center;gap:2px;height:44px;padding:0 4px;border-radius:999px;cursor:grab;touch-action:none}
.bar.dragging{cursor:grabbing}
.bar .pos{display:flex;align-items:center;gap:8px;padding:0 8px;user-select:none;font-size:13px}
#pos-title{font-weight:500;max-width:18rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .sep{width:1px;height:20px;background:var(--divider);margin:0 4px}
.bar-place.dot .bar{padding:0;height:44px;cursor:default}.bar-place.dot #prev,.bar-place.dot #next,.bar-place.dot .pos,.bar-place.dot .sep{display:none}
.bar-place.dot #toggle{width:44px;height:44px;position:relative}.bar-place.dot #toggle svg{display:none}
.dot{display:none}.bar-place.dot .dot{display:block;font:13px "Geist Mono",ui-monospace,monospace;color:var(--ink)}
#toggle[aria-expanded=true]:not(:hover){background:var(--raised)}.bar-place.dot #toggle[aria-expanded=true]:not(:hover){background:transparent}
.shield{position:fixed;inset:0;z-index:30;cursor:grabbing}
/* drawer: glass on the right; a bottom sheet on a narrow window */
#drawer{position:fixed;z-index:50;top:12px;right:12px;bottom:12px;width:360px;border-radius:14px;display:flex;flex-direction:column}
#drawer[data-state=closed]{transform:translateX(calc(100% + 12px));visibility:hidden}
body.ready #drawer{transition:transform 250ms var(--drawer),visibility 0s}body.ready #drawer[data-state=closed]{transition:transform 200ms var(--drawer),visibility 0s 200ms}
@media (max-width:639px){#drawer{top:auto;left:0;right:0;bottom:0;width:auto;max-height:75dvh;border-radius:24px 24px 0 0;padding-bottom:env(safe-area-inset-bottom)}
#drawer[data-state=closed]{transform:translateY(calc(100% + 12px))}body.open .bar-place{display:none}#pos-title{display:none}}
@media (prefers-reduced-motion:reduce){body.ready #drawer,body.ready .bar-place,.bar{transition:none!important}}
.head{display:flex;gap:8px;align-items:flex-start;padding:14px 14px 8px 16px}.grow{flex:1;min-width:0}
.kicker{font-size:13px;color:var(--muted)}.head h2{font-size:15px;font-weight:500;line-height:1.35;margin:2px 0 0}.head p{margin:0;font-size:13px}
.body{flex:1;min-height:0;overflow-y:auto;padding:4px 16px 16px}
section{margin-top:14px}section:first-child{margin-top:6px}
h3{font-size:12px;font-weight:500;color:var(--muted);letter-spacing:.02em;text-transform:uppercase;margin:0 0 8px}.hint{text-transform:none;letter-spacing:0;font-weight:400;color:var(--muted)}
nav[role=tablist]{display:flex;flex-direction:column;gap:2px}
[role=tab]{display:flex;align-items:center;gap:10px;height:auto;min-height:36px;padding:6px 10px;border-radius:12px;text-align:left;font-size:14px;font-weight:400;background:transparent;width:100%}
[role=tab] .n{width:16px;font-size:12px;color:var(--subtle)}[role=tab][aria-selected=true]{font-weight:500}[role=tab][aria-selected=true] .n{color:rgb(12 8 6/.6)}
[role=tab] .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip{font-size:12px;font-weight:400;padding:1px 7px;border-radius:999px;background:var(--raised);color:var(--ink2)}[role=tab][aria-selected=true] .chip{background:rgb(12 8 6/.1);color:var(--canvas)}
section .group+.group,section .group+p,section p+.group{margin-top:8px}section p{margin:8px 0 0}
.places{margin-top:12px}
.foot{border-top:1px solid var(--divider);padding:12px 16px 16px;display:flex;flex-direction:column;gap:10px}
#identity{color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.choose{display:flex;flex-direction:column;gap:8px}#confirm{display:flex;flex-direction:column;gap:8px;font-size:13px}#confirm[hidden]{display:none}
#send{width:auto;flex:1}
.approve{line-height:1.5}.approve .group{margin-top:6px;flex-wrap:nowrap}#copy{flex:none;white-space:nowrap}#pivot{font:12px "Geist Mono",ui-monospace,monospace;height:32px}
textarea{font:inherit;font-size:14px;background:var(--surface);color:var(--ink);border:0;border-radius:14px;padding:8px 12px;resize:vertical;width:100%;display:block}
textarea:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px}textarea::placeholder,input::placeholder{color:var(--muted)}
/* comment: the mode switch, the tools, the notes and one Send to Claude */
.seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:var(--surface);flex:none}
.seg button{height:30px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;background:transparent}
.seg button[aria-checked=true]{background:var(--ink);color:var(--canvas)}
kbd{font:500 11px/1 "Geist Mono",ui-monospace,monospace;border:1px solid currentColor;border-radius:5px;padding:2px 4px;opacity:.7}
button.inv{background:var(--ink);color:var(--canvas)}button.inv:hover{background:color-mix(in srgb,var(--ink) 88%,transparent);color:var(--canvas)}
button.sec{background:var(--raised);color:var(--ink);display:inline-flex;align-items:center;gap:6px}
button.wide{width:100%;height:36px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px}
#qmode{margin:0 2px}#qcount{padding:0 6px}.bar-place.dot #qmode,.bar-place.dot #qcount{display:none}
#comment .seg+div,#comment .seg+p,#comment p+ol,#comment ol+textarea,#comment p+textarea{margin-top:8px}
#dtools-row[hidden],#comment-off[hidden],#notes-empty[hidden]{display:none}
#notes{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}#notes:empty{display:none}
.row{display:flex;gap:10px;align-items:flex-start;background:var(--surface);border-radius:12px;padding:8px}
.num{width:24px;height:24px;flex:none;border-radius:999px;background:var(--ink);color:var(--canvas);display:grid;place-items:center;font:500 12px "Geist Mono",ui-monospace,monospace}
.num.spot{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink)}
.row .open{flex:1;min-width:0;height:auto;min-height:24px;padding:0;background:transparent;text-align:left;font-size:13px;font-weight:400;color:var(--ink);border-radius:6px;display:block}
.row .open:hover{background:transparent;text-decoration:underline;text-decoration-color:var(--subtle)}
.row .open .empty{color:var(--muted)}.row .open small{display:block;color:var(--muted);font:12px/1.5 "Geist Mono",ui-monospace,monospace;overflow-wrap:anywhere}
.row .del{width:28px;height:28px;padding:0;flex:none;display:grid;place-items:center;background:transparent;color:var(--muted)}
#fb-text{margin-top:8px;min-height:56px}#fb-send{margin-top:8px}#fb-status{margin:6px 0 0}#fb-status:empty{display:none}
/* comment mode over the version: the shield, the outline and chip, the numbered markers, the toolbar and the note */
#cshield{position:fixed;z-index:30;cursor:default;touch-action:none}body.tool-pin #cshield{cursor:crosshair}#cshield[hidden]{display:none}
#ov{position:fixed;inset:0;z-index:35;pointer-events:none;overflow:hidden}
#hl{position:fixed;outline:2px solid var(--ink);box-shadow:0 0 0 3px var(--canvas);border-radius:2px}#hl[hidden]{display:none}
#chip{position:absolute;left:-2px;top:0;transform:translateY(calc(-100% - 6px));background:var(--ink);color:var(--canvas);border-radius:6px;padding:2px 7px;font:500 12px/18px "Geist Mono",ui-monospace,monospace;white-space:nowrap;box-shadow:0 0 0 1px var(--canvas)}
#chip i{font-style:normal;opacity:.65}#hl.below #chip{top:100%;transform:translateY(6px)}
.done{position:fixed;outline:1.5px solid rgb(251 243 234/.75);border-radius:2px}
.mk{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;padding:0;border-radius:999px;display:grid;place-items:center;background:var(--ink);color:var(--canvas);font:500 13px "Geist Mono",ui-monospace,monospace;box-shadow:0 0 0 2px var(--canvas),0 24px 64px rgb(0 0 0/.6),0 2px 8px rgb(0 0 0/.35);pointer-events:auto}
.mk:hover{background:var(--ink);color:var(--canvas)}.mk.on{outline:2px solid var(--accent-text);outline-offset:2px}
.ctool{position:fixed;z-index:42;top:calc(12px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);height:44px;border-radius:999px;display:flex;align-items:center;gap:8px;padding:0 4px;white-space:nowrap;font-size:13px}
.ctool[hidden]{display:none}body.bar-top .ctool{top:calc(68px + env(safe-area-inset-top))}
body.ready .ctool{transition:transform 250ms var(--drawer)}@media (min-width:640px){body.open .ctool{transform:translateX(calc(-50% - 192px))}}
#chint{color:var(--muted);padding:0 4px}
@media (max-width:900px){#chint{display:none}}
.pop{position:fixed;z-index:45;width:300px;border-radius:14px;padding:12px;font-size:13px}.pop[hidden]{display:none}
#pop-label{margin:0 0 6px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}#pop-text{min-height:72px}
.pfoot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px;color:var(--muted)}
#pop-del{height:28px;background:transparent;display:inline-flex;align-items:center;gap:6px;padding:0 8px}
/* a note's crop is taken from the page itself: nothing of the preview's own is in it */
body.capturing #drawer,body.capturing #bar-place,body.capturing #ov,body.capturing #ctool,body.capturing #pop{visibility:hidden!important;transition:none!important}
@media (pointer:coarse){button{height:44px}button.icon{width:44px;height:44px}[role=tab]{min-height:44px}.bar{height:52px}}
@media (prefers-reduced-motion:reduce){body.ready .ctool{transition:none!important}}`;

/** The preview page's behaviour (served as /shell.js). It reads /versions.json, the checked versions' metadata. */
const SHELL_JS = `(() => {
const WIDTHS = ${JSON.stringify(WIDTHS)};
const MAX_NOTES = ${NOTE_LIMITS.notes};
const HINT = "Commenting · page paused · Esc to use it";
const WIDTH_NAMES = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };
let versions = [], current = 0, width = "desktop", comparing = false, nonce = 0, frameW = 0;
let paused = new URLSearchParams(location.search).has("crashed");
const $ = (id) => document.getElementById(id);
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const frame = (v, w, h, scale) => {
  const box = document.createElement("div"); box.className = "frame";
  const f = document.createElement("iframe");
  f.title = "Version " + v.n + ": " + v.title;
  f.setAttribute("sandbox", v.interactive ? "allow-scripts" : "");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.src = v.src + "&r=" + nonce;
  f.style.width = w + "px"; f.style.height = Math.round(h / scale) + "px";
  box.style.width = Math.round(w * scale) + "px"; box.style.height = h + "px";
  if (scale < 1) f.style.transform = "scale(" + scale + ")";
  box.appendChild(f); return box;
};
function render() {
  const stage = $("stage"); stage.replaceChildren();
  stage.classList.toggle("compare", comparing);
  // comment mode needs one version on screen
  if ((comparing || paused) && mode === "comment") setMode("use", false);
  if (paused) {
    const p = document.createElement("p"); p.id = "crashed"; p.className = "muted";
    p.textContent = "The preview crashed while showing a version (it may use too much memory or CPU). Pick a version to continue.";
    stage.appendChild(p);
  } else if (comparing) {
    const avail = (stage.clientWidth - 32 - 12 * (versions.length - 1)) / versions.length;
    const h = Math.max(400, stage.clientHeight - 120);
    for (const v of versions) {
      const w = WIDTHS[width], scale = Math.min(1, avail / w);
      const cell = document.createElement("div"); cell.className = "cell";
      const l = document.createElement("div"); l.className = "label"; l.textContent = v.n + " · " + v.title + " · " + v.digest.slice(0, 12); cell.appendChild(l);
      cell.appendChild(frame(v, w, h, scale)); stage.appendChild(cell);
    }
  } else {
    // the version fills the window like the real site; Tablet and Phone keep their width, centred
    const full = stage.clientWidth, w = width === "desktop" ? full : WIDTHS[width], scale = Math.min(1, full / w);
    frameW = w;
    stage.appendChild(frame(versions[current], w, stage.clientHeight, scale));
    $("scaled").hidden = scale >= 1;
    $("scaled").textContent = scale < 1 ? width[0].toUpperCase() + width.slice(1) + " is " + w + "px wide: scaled to " + Math.round(scale * 100) + "% to fit this window." : "";
  }
  for (const [i, b] of [...$("tabs").children].entries()) {
    const on = !comparing && i === current;
    b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
  }
  for (const b of document.querySelectorAll("[data-width]")) b.setAttribute("aria-pressed", String(b.dataset.width === width));
  $("compare").setAttribute("aria-pressed", String(comparing));
  // a pick names one version: none while comparing, or while the crashed page waits for one
  $("choose").disabled = comparing || paused; if (comparing || paused) $("confirm").hidden = true;
  const v = versions[current];
  $("identity").textContent = comparing ? "Comparing " + versions.length + " versions" :
    "Version " + v.n + " · " + (v.interactive ? "interactive" : "static") + " · id " + v.id + " · digest " + v.digest.slice(0, 12) + " (checked against PIVOT's stored copy)";
  $("pos-sr").textContent = comparing ? "Comparing " + versions.length + " versions" : "Version " + v.n + " of " + versions.length + ": " + v.title;
  $("pos-num").textContent = comparing ? "all " + versions.length : v.n + "/" + versions.length;
  $("pos-title").textContent = comparing ? "Compare" : v.title;
  $("dot").textContent = v.n + "/" + versions.length;
  $("prev").disabled = $("next").disabled = versions.length < 2;
  // a new frame starts at the top, with nothing of the last one drawn over it
  scroll = { x: 0, y: 0 }; hideOutline(); closePop(); placeShield(); showMode(); drawNotes(); renderNotes();
}
const show = (i) => { current = (i + versions.length) % versions.length; comparing = false; paused = false; $("confirm").hidden = true; render(); };
// drawer: open on a first visit, then as left; Esc or the toggle closes it and focus returns to the toggle
let open = stored("pivot.preview.drawer") !== "closed";
function setOpen(next, focus) {
  open = next; store("pivot.preview.drawer", next ? "open" : "closed");
  $("drawer").dataset.state = next ? "open" : "closed"; $("drawer").inert = !next;
  document.body.classList.toggle("open", next); $("toggle").setAttribute("aria-expanded", String(next));
  if (openKey) placePop();
  if (!focus) return;
  if (next) requestAnimationFrame(() => document.querySelector("[role=tab][aria-selected=true]")?.focus());
  else $("toggle").focus();
}
// the quick bar: bottom, top, or folded into a dot; dragged past a few pixels it moves to the nearer edge
let place = ["top", "dot"].includes(stored("pivot.preview.bar")) ? stored("pivot.preview.bar") : "bottom";
function setPlace(next) {
  place = next; store("pivot.preview.bar", next);
  $("bar-place").className = "bar-place " + next;
  document.body.classList.toggle("bar-top", next === "top");
  for (const b of document.querySelectorAll("[data-place]")) b.setAttribute("aria-checked", String(b.dataset.place === next));
  $("toggle").setAttribute("aria-label", next === "dot" ? "Preview controls, " + $("pos-sr").textContent : "Preview controls");
}
let drag = null;
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
$("bar").addEventListener("pointerdown", (e) => {
  if (place === "dot" || e.button !== 0 || e.target.closest("button")) return;
  drag = { y: e.clientY, moved: false }; $("bar").setPointerCapture(e.pointerId);
});
$("bar").addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true; $("bar").classList.add("dragging"); $("shield").hidden = false;
  $("bar").style.transition = "none"; $("bar").style.transform = "translateY(" + dy + "px)";
});
const drop = (e) => {
  const d = drag; drag = null; $("bar").classList.remove("dragging"); $("shield").hidden = true;
  if (!d || !d.moved) return;
  const from = $("bar").getBoundingClientRect().top;
  $("bar").style.transform = "";
  setPlace(e.clientY < innerHeight / 2 ? "top" : "bottom");
  const delta = from - $("bar").getBoundingClientRect().top;
  if (!delta || reduce()) { $("bar").style.transition = ""; return; }
  $("bar").style.transform = "translateY(" + delta + "px)";
  requestAnimationFrame(() => { $("bar").style.transition = "transform 240ms var(--out)"; $("bar").style.transform = ""; });
};
$("bar").addEventListener("pointerup", drop); $("bar").addEventListener("pointercancel", drop);
const media = matchMedia("(prefers-reduced-motion: reduce)");
const showMedia = () => { $("media").textContent = "This window: " + (media.matches ? "reduced motion" : "full motion"); };
media.addEventListener("change", showMedia);

// ---- Comment: Use runs the version as it is; Comment covers it with a shield and asks this window's process what is
// under the pointer (the process reads it in its own isolated world of the version's frame, takes the note's crop
// and keeps it until Send to Claude). Everything the process returns is shown with textContent only.
let mode = "use", tool = stored("pivot.preview.tool") === "pin" ? "pin" : "select";
let scroll = { x: 0, y: 0 }, openKey = null, picking = false, sending = false;
const drafts = new Map(); // version number -> { notes, next }: the notes stay with their version until sent
const draft = () => {
  const n = versions[current]?.n;
  if (!drafts.has(n)) drafts.set(n, { notes: [], next: 1 });
  return drafts.get(n);
};
const clip24 = (t) => (t.length > 24 ? t.slice(0, 23) + "…" : t);
const tagName = (e) => e.tag + (e.id ? "#" + e.id : e.classes && e.classes[0] ? "." + e.classes[0] : "");
const words = (e) => (e.text || e.label || "").trim();
const size = (e) => Math.round(e.box.w) + "×" + Math.round(e.box.h);
// an element's name, as PIVOT gives it: tag with id or first class, then its own text or label, or else its size
const elName = (e) => (words(e) ? tagName(e) + " “" + clip24(words(e)) + "”" : tagName(e) + " · " + size(e));
const iframe = () => (comparing || paused ? null : document.querySelector("#stage iframe"));
function geo() {
  const f = iframe(); if (!f) return null;
  const r = f.getBoundingClientRect(), box = f.parentElement.getBoundingClientRect();
  return { r, box, s: r.width / (parseFloat(f.style.width) || r.width) };
}
const toFrame = (x, y, g) => ({ x: (x - g.r.left) / g.s, y: (y - g.r.top) / g.s });
const toPage = (x, y, g) => ({ x: g.r.left + x * g.s, y: g.r.top + y * g.s });
function say(text, ms) {
  $("chint").textContent = text;
  clearTimeout(say.t); if (ms) say.t = setTimeout(() => ($("chint").textContent = HINT), ms);
}
function showMode() {
  const can = !comparing && !paused && versions.length > 0;
  for (const b of document.querySelectorAll("[data-mode]")) { b.setAttribute("aria-checked", String(b.dataset.mode === mode)); b.disabled = !can && b.dataset.mode === "comment"; }
  for (const b of document.querySelectorAll("[data-tool]")) b.setAttribute("aria-checked", String(b.dataset.tool === tool));
  const on = mode === "comment";
  document.body.classList.toggle("commenting", on); document.body.classList.toggle("tool-pin", tool === "pin");
  $("ctool").hidden = !on; $("dtools-row").hidden = !on; $("comment-off").hidden = can;
  $("centre-label").textContent = tool === "pin" ? "Add pin at centre" : "Comment at centre";
  placeShield();
}
function placeShield() {
  const s = $("cshield"), g = mode === "comment" ? geo() : null;
  s.hidden = !g; if (!g) return;
  Object.assign(s.style, { left: g.box.left + "px", top: g.box.top + "px", width: g.box.width + "px", height: g.box.height + "px" });
}
async function setMode(next, focus = true) {
  if (next === "comment" && (comparing || paused || !versions.length)) return;
  if (next === mode) return;
  mode = next;
  if (mode === "use") { closePop(); hideOutline(); say(HINT); }
  showMode(); drawNotes(); renderNotes();
  // the shield is up first; then the process pauses the page's own keys and clicks (and lets them go again)
  if (mode === "comment" && focus) document.querySelector("#ctools [aria-checked=true]")?.focus();
  const look = await window.pivotPreview({ mode }).catch(() => null);
  if (mode === "comment" && look && look.scroll) setScroll(look.scroll);
}
const toggleMode = () => setMode(mode === "comment" ? "use" : "comment");
function setTool(next) {
  tool = next; store("pivot.preview.tool", next);
  if (tool === "pin") hideOutline();
  showMode();
}
function setScroll(s) {
  if (!s || (s.x === scroll.x && s.y === scroll.y)) return;
  scroll = { x: s.x, y: s.y }; drawNotes(); if (openKey) placePop();
}
function hideOutline() { $("hl").hidden = true; }
function outline(hit) {
  const g = geo();
  if (!g || !hit || !hit.client || !hit.tag) return hideOutline();
  const p = toPage(hit.client.x, hit.client.y, g), hl = $("hl");
  Object.assign(hl.style, { left: p.x + "px", top: p.y + "px", width: hit.client.w * g.s + "px", height: hit.client.h * g.s + "px" });
  hl.classList.toggle("below", p.y < 34);
  const chip = $("chip"), i = document.createElement("i");
  i.textContent = " · " + size(hit);
  chip.textContent = tagName(hit) + (words(hit) ? " “" + clip24(words(hit)) + "”" : "");
  chip.appendChild(i);
  hl.hidden = false;
}
// hover: one question in flight, at most one per frame; the latest point wins
let at = null, asking = false;
$("cshield").addEventListener("pointermove", (e) => {
  if (mode !== "comment" || tool !== "select" || picking) return;
  const g = geo(); if (!g) return;
  at = toFrame(e.clientX, e.clientY, g);
  if (!asking) ask();
});
function ask() {
  asking = true;
  requestAnimationFrame(async () => {
    const p = at; let hit = null;
    try { hit = await window.pivotPreview({ hover: p }); } catch {}
    asking = false;
    if (mode !== "comment" || tool !== "select" || picking || !at) return hideOutline();
    if (hit && hit.scroll) setScroll(hit.scroll);
    outline(hit);
    if (at !== p) ask();
  });
}
$("cshield").addEventListener("pointerleave", () => { at = null; hideOutline(); });
// the wheel scrolls the version (the process scrolls its nearest scrollable box)
let wheelQ = null, wheeling = false;
$("cshield").addEventListener("wheel", (e) => {
  e.preventDefault();
  const g = geo(); if (!g) return;
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1, p = toFrame(e.clientX, e.clientY, g);
  wheelQ = { x: p.x, y: p.y, dx: (wheelQ ? wheelQ.dx : 0) + (e.deltaX * k) / g.s, dy: (wheelQ ? wheelQ.dy : 0) + (e.deltaY * k) / g.s };
  if (!wheeling) pump();
}, { passive: false });
async function pump() {
  wheeling = true;
  while (wheelQ) {
    const w = wheelQ; wheelQ = null; let hit = null;
    try { hit = await window.pivotPreview({ wheel: w }); } catch {}
    if (hit && hit.scroll) setScroll(hit.scroll);
    if (tool === "select" && at) outline(hit);
  }
  wheeling = false;
}
$("cshield").addEventListener("click", (e) => {
  if (e.button !== 0 || mode !== "comment") return;
  if (openKey) { closePop(); return; }
  const g = geo(); if (g) addNote(toFrame(e.clientX, e.clientY, g));
});
// a note: the process reads the element (or the spot), takes the crop before anything is drawn, and keeps it
async function addNote(p) {
  if (picking) return;
  const v = versions[current], d = draft(), f = iframe();
  if (d.notes.length >= MAX_NOTES) return say("At most " + MAX_NOTES + " notes at a time: send these first.", 4000);
  picking = true; hideOutline(); say("Capturing…");
  let r = null;
  try { r = await window.pivotPreview({ pick: { x: p.x, y: p.y, tool, n: v.n } }); } catch {}
  picking = false;
  if (!r || r.error) return say(r && r.error ? r.error : "Couldn’t read the page there. Try again.", 4000);
  say(HINT);
  // the version or its frame changed meanwhile: the note isn't on what is shown
  if (versions[current] !== v || iframe() !== f || mode !== "comment") { window.pivotPreview({ drop: r.key }); return; }
  const note = { key: r.key, n: d.next++, text: "", element: r.element || null, x: r.x, y: r.y, width: r.width, label: WIDTH_NAMES[width] + " " + r.width };
  d.notes.push(note);
  if (r.scroll) scroll = r.scroll;
  drawNotes(); renderNotes(); openPop(note.key);
}
function removeNote(key, tell = true) {
  for (const d of drafts.values()) d.notes = d.notes.filter((n) => n.key !== key);
  if (tell) window.pivotPreview({ drop: key });
  if (openKey === key) { openKey = null; $("pop").hidden = true; }
  drawNotes(); renderNotes();
}
const noteOf = (key) => draft().notes.find((n) => n.key === key);
// where a note sits on the page now, or null when it was made at another width
function anchor(n, g) {
  if (!g || n.width !== frameW) return null;
  if (n.element) {
    const p = toPage(n.element.box.x - scroll.x, n.element.box.y - scroll.y, g);
    return { x: p.x, y: p.y, w: n.element.box.w * g.s, h: n.element.box.h * g.s, mx: p.x - 14, my: p.y - 14 };
  }
  const p = toPage(n.x - scroll.x, n.y - scroll.y, g);
  return { x: p.x, y: p.y, w: 0, h: 0, mx: p.x, my: p.y };
}
function drawNotes() {
  for (const m of [...$("ov").querySelectorAll(".mk, .done")]) m.remove();
  const g = mode === "comment" ? geo() : null; if (!g) return;
  for (const n of versions.length ? draft().notes : []) {
    const a = anchor(n, g); if (!a) continue;
    if (a.mx < g.box.left - 14 || a.mx > g.box.right + 14 || a.my < g.box.top - 14 || a.my > g.box.bottom + 14) continue;
    // a marker at the frame's edge stays whole inside it
    a.mx = Math.min(Math.max(a.mx, Math.max(g.box.left, 0) + 14), Math.min(g.box.right, innerWidth) - 14);
    a.my = Math.min(Math.max(a.my, Math.max(g.box.top, 0) + 14), Math.min(g.box.bottom, innerHeight) - 14);
    if (n.element) {
      const o = document.createElement("div"); o.className = "done";
      Object.assign(o.style, { left: a.x + "px", top: a.y + "px", width: a.w + "px", height: a.h + "px" });
      $("ov").appendChild(o);
    }
    const b = document.createElement("button"); b.className = "mk" + (openKey === n.key ? " on" : ""); b.dataset.note = n.key;
    b.textContent = String(n.n); b.style.left = a.mx + "px"; b.style.top = a.my + "px";
    b.setAttribute("aria-label", "Note " + n.n + (n.element ? " on " + elName(n.element) : ", spot") + (n.text.trim() ? ": " + n.text.trim().slice(0, 60) : ", no text yet"));
    $("ov").appendChild(b);
  }
}
function openPop(key) {
  const n = noteOf(key); if (!n) return;
  if (openKey && openKey !== key) closePop();
  openKey = key;
  $("pop-label").textContent = n.element ? "Note on " + elName(n.element) : "Note for spot " + n.n;
  $("pop-text").value = n.text;
  $("pop").hidden = false; placePop(); drawNotes();
  $("pop-text").focus();
}
// below the note (above when there is no room), on the side away from the drawer
function placePop() {
  const n = openKey && noteOf(openKey); if (!n) return;
  const pop = $("pop"), a = anchor(n, geo()), w = 300, h = pop.offsetHeight || 160;
  const right = innerWidth - 12 - (open && innerWidth >= 640 ? 372 : 0);
  let x = a ? a.x - 6 : right - w, y = a ? a.y + a.h + 14 : 72;
  if (a && y + h > innerHeight - 12) y = a.y - 14 - h - (n.element ? 0 : 14);
  x = Math.max(12, Math.min(x, right - w)); y = Math.max(12, Math.min(y, innerHeight - 12 - h));
  pop.style.left = x + "px"; pop.style.top = y + "px";
}
// closing a note without text drops it, as in PIVOT
function closePop() {
  if (!openKey) return;
  const key = openKey, n = noteOf(key);
  openKey = null; $("pop").hidden = true;
  if (n && !n.text.trim()) removeNote(key); else { drawNotes(); renderNotes(); }
}
$("pop-text").addEventListener("input", () => {
  const n = openKey && noteOf(openKey); if (!n) return;
  n.text = $("pop-text").value; renderNotes();
  const m = document.querySelector('.mk[data-note="' + n.key + '"]');
  if (m) m.setAttribute("aria-label", "Note " + n.n + (n.element ? " on " + elName(n.element) : ", spot") + (n.text.trim() ? ": " + n.text.trim().slice(0, 60) : ", no text yet"));
});
function renderNotes() {
  const notes = versions.length ? draft().notes : [];
  const ol = $("notes"); ol.replaceChildren();
  for (const n of notes) {
    const li = document.createElement("li"); li.className = "row";
    const num = document.createElement("span"); num.className = "num" + (n.element ? "" : " spot"); num.textContent = String(n.n); num.setAttribute("aria-hidden", "true");
    const b = document.createElement("button"); b.className = "open"; b.dataset.open = n.key;
    const t = document.createElement("span"); t.textContent = n.text.trim() || "No text yet"; if (!n.text.trim()) t.className = "empty";
    const meta = document.createElement("small");
    meta.textContent = [n.element ? elName(n.element) : "Spot", (n.width === frameW ? "" : "made at ") + n.label, "live"].join(" · ");
    const sr = document.createElement("span"); sr.className = "sr"; sr.textContent = "Note " + n.n + ": ";
    b.append(sr, t, meta);
    const del = document.createElement("button"); del.className = "del"; del.dataset.del = n.key; del.setAttribute("aria-label", "Delete note " + n.n);
    del.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    li.append(num, b, del); ol.appendChild(li);
  }
  $("notes-empty").hidden = notes.length > 0;
  $("qcount").hidden = !notes.length; $("qcount").textContent = notes.length + (notes.length === 1 ? " note" : " notes");
  canSend();
}
function canSend() {
  const any = $("fb-text").value.trim() || (versions.length && draft().notes.some((n) => n.text.trim()));
  $("fb-send").disabled = sending || !any;
}
function atCentre() {
  const g = geo(); if (!g) return;
  const right = Math.min(g.box.right, innerWidth - (open && innerWidth >= 640 ? 372 : 0));
  const x = (Math.max(g.box.left, 0) + right) / 2, y = (Math.max(g.box.top, 0) + Math.min(g.box.bottom, innerHeight)) / 2;
  addNote(toFrame(x, y, g));
}
// the process passes on ⌥C (and Esc, V, P while commenting) pressed inside the version's frame
window.pivotPreviewKey = (k) => {
  if (k === "mode") toggleMode();
  else if (mode !== "comment") return;
  else if (k === "escape") escape();
  else if (k === "select" || k === "pin") setTool(k);
};
function escape() {
  if (openKey) { const k = openKey; closePop(); document.querySelector('.mk[data-note="' + k + '"]')?.focus(); }
  else setMode("use");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) show(Number(b.dataset.tab));
  else if (b.dataset.width) { width = b.dataset.width; render(); }
  else if (b.dataset.place) setPlace(b.dataset.place);
  else if (b.dataset.mode) setMode(b.dataset.mode);
  else if (b.dataset.tool) setTool(b.dataset.tool);
  else if (b.dataset.note) { if (openKey === b.dataset.note) closePop(); else openPop(b.dataset.note); }
  else if (b.dataset.open) { await setMode("comment", false); openPop(b.dataset.open); }
  else if (b.dataset.del) removeNote(b.dataset.del);
  else if (b.dataset.motion) {
    await window.pivotPreview({ reducedMotion: b.dataset.motion === "reduce" });
    for (const m of document.querySelectorAll("[data-motion]")) m.setAttribute("aria-pressed", String(m === b));
    nonce++; render(); showMedia();
  } else if (b.id === "prev") show(current - 1);
  else if (b.id === "next") show(current + 1);
  else if (b.id === "toggle") setOpen(!open, true);
  else if (b.id === "close") setOpen(false, true);
  else if (b.id === "replay") { nonce++; render(); }
  else if (b.id === "compare") { comparing = !comparing; render(); }
  else if (b.id === "copy") { $("pivot").select(); document.execCommand("copy"); b.textContent = "Copied"; }
  else if (b.id === "done") setMode("use");
  else if (b.id === "centre") atCentre();
  else if (b.id === "pop-del") { if (openKey) removeNote(openKey); }
  else if (b.id === "choose") {
    const v = versions[current];
    $("chosen").textContent = "version " + v.n + " · " + v.title + " (digest " + v.digest.slice(0, 12) + ")";
    $("confirm").hidden = false; $("note").focus();
  } else if (b.id === "cancel") { $("confirm").hidden = true; $("choose").focus(); }
  else if (b.id === "fb-send") {
    // one Send to Claude: the text and this version's notes together
    const v = versions[current], text = $("fb-text").value.trim();
    const notes = draft().notes.filter((n) => n.text.trim()).map((n) => ({ key: n.key, n: n.n, text: n.text.trim() }));
    if (!text && !notes.length) return;
    sending = true; canSend(); $("fb-status").textContent = "Sending…";
    let r = null;
    try { r = await window.pivotPreview({ feedback: text, n: v.n, notes }); } catch {}
    sending = false;
    if (r && r.sent) for (const key of r.sent) removeNote(key, false);
    if (r && r.text) $("fb-text").value = "";
    $("fb-status").textContent = r && !r.error ? "Sent · waiting for Claude" : r && r.sent && r.sent.length ? "Some notes were sent; the rest weren’t: try again." : "Not sent: PIVOT didn't take it. Try again, or write it in PIVOT.";
    canSend();
  }
  else if (b.id === "send") {
    b.disabled = true;
    const ok = await window.pivotPreview({ choose: versions[current].n, note: $("note").value });
    if (!ok) { b.disabled = false; $("chosen").textContent += " — not sent, try again"; }
  }
});
$("fb-text").addEventListener("input", () => { canSend(); $("fb-status").textContent = ""; });
document.addEventListener("keydown", (e) => {
  const typing = !!(e.target.closest && e.target.closest("input, textarea"));
  // ⌥C switches Use / Comment (never while typing in this window's own fields)
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyC" && !typing) { e.preventDefault(); toggleMode(); return; }
  if (mode === "comment") {
    if (e.key === "Escape" && (!typing || e.target.id === "pop-text")) { e.preventDefault(); escape(); return; }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === "KeyV" || e.code === "KeyP")) { e.preventDefault(); setTool(e.code === "KeyV" ? "select" : "pin"); return; }
  }
  if (e.key === "Escape" && open && !typing && mode === "use") { e.preventDefault(); setOpen(false, true); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, textarea, [role=radiogroup], [role=group]"))) return;
  const n = Number(e.key);
  if (n >= 1 && n <= versions.length) show(n - 1);
  else if (e.key === "ArrowRight" || (e.key === "ArrowDown" && e.target.getAttribute?.("role") === "tab")) show(current + 1);
  else if (e.key === "ArrowLeft" || (e.key === "ArrowUp" && e.target.getAttribute?.("role") === "tab")) show(current - 1);
  else return;
  e.preventDefault();
  if (e.target.getAttribute?.("role") === "tab") requestAnimationFrame(() => document.querySelector("[role=tab][aria-selected=true]")?.focus());
});
// keys typed in a mockup belong to it: say so while it has focus instead of forwarding them
const focusCheck = () => setTimeout(() => { $("paused").hidden = document.activeElement?.tagName !== "IFRAME"; }, 0);
addEventListener("blur", focusCheck); addEventListener("focus", focusCheck); document.addEventListener("focusin", focusCheck);
addEventListener("resize", () => render());
fetch("/versions.json").then((r) => r.json()).then((list) => {
  versions = list;
  for (const [i, v] of versions.entries()) {
    const b = document.createElement("button"); b.setAttribute("role", "tab"); b.dataset.tab = String(i);
    if (v.n <= 9) b.setAttribute("aria-keyshortcuts", String(v.n));
    const t = document.createElement("span"); t.className = "t"; t.textContent = v.n + " · " + v.title;
    const c = document.createElement("span"); c.className = "chip"; c.textContent = v.interactive ? "interactive" : "static";
    b.append(t, c); $("tabs").appendChild(b);
  }
  setOpen(open, false); setPlace(place);
  render(); showMedia(); document.body.dataset.ready = "true";
  requestAnimationFrame(() => document.body.classList.add("ready"));
});
})();`;

const SHELL_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The preview's local server: the page, its script and style, the checked versions' metadata, and the versions. */
export async function startServer({ session, versions, pivotPage, policy = versionPolicy }) {
  // Each version is served only with its own unguessable token. Only the preview's page learns the tokens (from
  // /versions.json, which an opaque mockup frame can't read), so a version can't load another one in its frame and be
  // shown under the wrong label.
  const tokens = new Map(versions.map((v) => [v.n, crypto.randomBytes(16).toString("hex")]));
  const meta = versions.map(({ id, n, round, title, interactive, digest }) => ({
    id,
    n,
    round,
    title,
    interactive,
    digest,
    src: `/v/${n}?t=${tokens.get(n)}`,
  }));
  let host = "";
  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extra,
    });
    res.end(body);
  };
  const server = http.createServer((req, res) => {
    // only this address: a name that resolves here (DNS rebinding) gets nothing
    if (req.headers.host !== host) return send(res, 421, "text/plain", "");
    const u = new URL(req.url, "http://preview");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "");
    if (u.pathname === "/")
      return send(res, 200, "text/html; charset=utf-8", shellHtml({ session, pivotPage }), {
        "Content-Security-Policy": SHELL_POLICY,
      });
    if (u.pathname === "/shell.js") return send(res, 200, "text/javascript; charset=utf-8", SHELL_JS);
    if (u.pathname === "/shell.css") return send(res, 200, "text/css; charset=utf-8", SHELL_CSS);
    if (u.pathname === "/versions.json") return send(res, 200, "application/json", JSON.stringify(meta));
    const m = /^\/v\/(\d+)$/.exec(u.pathname);
    const v = m && versions.find((x) => x.n === Number(m[1]));
    if (v && u.searchParams.get("t") === tokens.get(v.n))
      return send(res, 200, "text/html; charset=utf-8", v.html, {
        ...(policy(v.interactive) ? { "Content-Security-Policy": policy(v.interactive) } : {}),
      });
    send(res, 404, "text/plain", "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  host = `127.0.0.1:${server.address().port}`;
  const origin = `http://${host}`;
  return { origin, close: () => new Promise((r) => server.close(() => r())) };
}

/**
 * Sends the user's feedback to PIVOT as its own page would (same origin, no API token: PIVOT refuses feedback that
 * carries one): text, and live notes (`pins` with `live: true`, the element and the crop) made at one `width` (and
 * `height`) of the version. Returns the stored feedback.
 */
export async function postFeedback({ pivotPage, sessionId, round, mockupId, text, width, height, pins }) {
  const origin = new URL(pivotPage).origin;
  const res = await fetch(`${origin}/api/design/sessions/${encodeURIComponent(sessionId)}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
    body: JSON.stringify({
      round,
      mockupId,
      text,
      ...(pins?.length ? { width, ...(height ? { height } : {}), pins } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `PIVOT answered ${res.status}`);
  return res.json();
}

/**
 * Opens the preview: its server, the gate (only the preview's origin), and a Chromium launched through it with motion
 * QA's switches and WebRTC guard. `headless`, `channel`, `playwright`, `policy` and `sendFeedback` are for tests
 * (`policy` replaces the versions' CSP, so a test can show the gate holds without it; `channel: "chromium"` runs full
 * Chromium headless, where a version's frame is out of process as in the window); the CLI never sets them. Returns
 * handles and a `closed` promise.
 */
export async function startPreview({
  session,
  versions,
  pivotPage,
  headless = false,
  channel = undefined,
  playwright = null,
  policy = versionPolicy,
  onEvent = () => {},
  sendFeedback = postFeedback,
}) {
  const { chromium } = playwright ?? loadPlaywright();
  const site = await startServer({ session, versions, pivotPage, policy });
  const blocked = new Set();
  const blockedWrites = new Set();
  const gate = await startGate({
    decide: destinationPolicy({ allowed: [originKey(site.origin)] }),
    blocked,
    blockedWrites,
  });
  const launch = launchOptions(gate.server);
  const browser = await chromium.launch({
    ...launch,
    headless,
    ...(channel ? { channel } : {}),
    args: [...launch.args, ...(headless ? [] : ["--window-size=1500,1000"])],
  });
  const context = await browser.newContext({
    viewport: headless ? { width: 1500, height: 950 } : null,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  await guardContext(context);
  // Comment mode's reading side. ⌥C pressed inside the mockup (and Esc, V, P while commenting) reach the preview's page
  // from the frame's isolated world through this process, never from the mockup's own scripts.
  const live = liveLayer({
    context,
    onKey: (k) => void page?.evaluate((key) => window.pivotPreviewKey?.(key), k).catch(() => {}),
  });
  // The privileged controls, answered only for the preview's own page, never for a mockup frame: reduced motion, the
  // user's pick, comment mode and the feedback. A pick names a version by its number; its id and digest come from the
  // checked versions here, never from the page.
  let chose = false;
  await context.exposeBinding("pivotPreview", async (source, cmd) => {
    if (source.frame !== source.page.mainFrame() || !source.frame.url().startsWith(`${site.origin}/`)) return false;
    if (source.page !== page) return false;
    if (typeof cmd?.reducedMotion === "boolean") {
      await source.page.emulateMedia({ reducedMotion: cmd.reducedMotion ? "reduce" : "no-preference" });
      onEvent({ event: "motion", reduced: cmd.reducedMotion });
      return true;
    }
    if (cmd?.mode === "comment" || cmd?.mode === "use") return live.setMode(cmd.mode === "comment");
    // reading the page, only while commenting: what is under the pointer, a forwarded wheel, a note
    if (cmd?.hover || cmd?.wheel || cmd?.pick) {
      if (!live.commenting) return null;
      try {
        if (cmd.hover) return await live.hover(cmd.hover);
        if (cmd.wheel) return await live.wheel(cmd.wheel);
        const v = versions.find((x) => x.n === cmd.pick.n);
        if (!v) return null;
        return await live.pick({ x: cmd.pick.x, y: cmd.pick.y, tool: cmd.pick.tool === "pin" ? "pin" : "select" }, v);
      } catch {
        return null;
      }
    }
    if (typeof cmd?.drop === "string") return live.notes.delete(cmd.drop);
    if (cmd && typeof cmd.feedback === "string") {
      // The user's feedback, typed and pointed at in this window's own controls: this process (not the locked browser)
      // sends it to PIVOT as feedback from PIVOT's page, so a waiting agent's watcher wakes on it, whoever opened the
      // window. Notes are this process's own (their crops never left it); the page names them by key with their text.
      const v = versions.find((x) => x.n === cmd.n);
      if (!v) return false;
      const text = cmd.feedback.trim().slice(0, 5000);
      const seen = new Set();
      const notes = (Array.isArray(cmd.notes) ? cmd.notes : []).flatMap((note) => {
        const kept = live.notes.get(note?.key);
        const t = typeof note?.text === "string" ? note.text.trim().slice(0, NOTE_LIMITS.text) : "";
        const n = note?.n;
        if (!kept || kept.v !== v.n || !t || !Number.isInteger(n) || n < 1 || n > 999 || seen.has(n)) return [];
        seen.add(n);
        return [{ key: note.key, n, text: t, kept }];
      });
      if (!text && !notes.length) return false;
      // one piece of feedback for each width the notes were made at (PIVOT keeps one width a piece); the text goes
      // with the first
      const groups = [];
      for (const note of notes.slice(0, NOTE_LIMITS.notes)) {
        const g = groups.find((x) => x.width === note.kept.width);
        if (g) g.notes.push(note);
        else groups.push({ width: note.kept.width, height: note.kept.height, notes: [note] });
      }
      if (!groups.length) groups.push({ notes: [] });
      const out = { sent: [], text: false };
      for (const [i, g] of groups.entries()) {
        const body = { pivotPage, sessionId: session.id, round: v.round, mockupId: v.id, text: i === 0 ? text : "" };
        if (g.notes.length) {
          const tall = g.height >= NOTE_LIMITS.height.min && g.height <= NOTE_LIMITS.height.max;
          Object.assign(body, {
            width: g.width,
            ...(tall ? { height: g.height } : {}),
            pins: g.notes.map(({ n, text: t, kept }) => ({
              x: kept.x,
              y: kept.y,
              text: t,
              n,
              live: true,
              ...(kept.element ? { element: kept.element } : {}),
              capture: { image: kept.image, region: kept.region },
            })),
          });
        }
        try {
          const fb = await sendFeedback(body);
          for (const note of g.notes) live.notes.delete(note.key);
          out.sent.push(...g.notes.map((note) => note.key));
          if (i === 0) out.text = !!text;
          onEvent({
            event: "feedback",
            round: v.round,
            n: v.n,
            id: v.id,
            feedbackId: fb?.id ?? null,
            notes: g.notes.length,
            ...(g.notes.length ? { width: g.width } : {}),
          });
        } catch (err) {
          out.error = err instanceof Error ? err.message : String(err);
          onEvent({ event: "feedback-failed", n: v.n, error: out.error });
          break;
        }
      }
      return out;
    }
    if (cmd && "choose" in cmd) {
      const v = versions.find((x) => x.n === cmd.choose);
      if (!v || chose) return false;
      chose = true;
      const note = typeof cmd.note === "string" ? cmd.note.trim().slice(0, 2000) : "";
      onEvent({ event: "chosen", round: v.round, n: v.n, title: v.title, id: v.id, digest: v.digest, note });
      // close after answering, so the page's call resolves first
      setTimeout(() => close(), 50);
      return true;
    }
    return false;
  });
  // nothing else may open: a mockup can't open popups (sandbox), and any page with an opener is closed at once
  context.on("page", async (p) => {
    if (await p.opener().catch(() => null)) await p.close().catch(() => {});
  });
  let finish;
  const closed = new Promise((r) => (finish = r));
  let closing = false;
  let recovering = false;
  let page;
  const crashes = [];
  // A crashed page is replaced by a fresh one on the same checked versions, which waits for the user to pick a version
  // (not the one that crashed); three crashes in a minute end the preview. Closing the window ends it too.
  const open = async (path = "/") => {
    if (closing) return;
    page = await context.newPage();
    await live.attach(page);
    // each new document in the version's frame gets the guard (⌥C, and the pause while commenting)
    page.on("framenavigated", (f) => {
      if (f.parentFrame() === f.page().mainFrame()) live.install(f).catch(() => {});
    });
    page.on("crash", async () => {
      if (closing) return;
      recovering = true;
      crashes.push(Date.now());
      onEvent({ event: "crashed" });
      await page.close().catch(() => {});
      if (crashes.filter((t) => Date.now() - t < 60_000).length >= 3) {
        onEvent({ event: "stopped", reason: "the preview crashed three times in a minute" });
        await close();
        return;
      }
      try {
        await open("/?crashed=1");
        onEvent({ event: "reloaded" });
      } catch {
        await close();
      } finally {
        recovering = false;
      }
    });
    page.on("close", () => {
      if (!recovering) close();
    });
    await page.goto(`${site.origin}${path}`);
  };
  const close = async () => {
    if (closing) return closed;
    closing = true;
    await browser.close().catch(() => {});
    await gate.close();
    await site.close();
    finish();
    return closed;
  };
  browser.on("disconnected", () => close());
  await open();
  return {
    origin: site.origin,
    browser,
    context,
    page: () => page,
    notes: live.notes,
    blocked,
    blockedWrites,
    close,
    closed,
  };
}

async function main(argv) {
  const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const sessionId = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    console.error("Usage: node preview.mjs <sessionId> [--round <n>] [--url <PIVOT url>] [--timeout-min 240]");
    process.exit(1);
  }
  const base = opt("--url", process.env.PIVOT_URL ?? "http://127.0.0.1:4321").replace(/\/+$/, "");
  const where = URL.canParse(base) ? new URL(base) : null;
  if (!where || where.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(where.hostname)) {
    console.error(`--url must be PIVOT on this machine (http://127.0.0.1:<port>), not ${base}`);
    process.exit(1);
  }
  const round = argv.includes("--round") ? Number(opt("--round")) : undefined;
  const timeoutMs = Number(opt("--timeout-min", 240)) * 60_000;
  const say = (o) => console.log(JSON.stringify({ sessionId, ...o }));
  const { session, versions } = await loadVersions({ base, sessionId, round });
  const pivotPage = `${base}/design/${sessionId}?round=${session.round}`;
  const preview = await startPreview({ session, versions, pivotPage, onEvent: say });
  say({
    event: "ready",
    round: session.round,
    origin: preview.origin,
    pivotPage,
    versions: versions.map((v) => ({ n: v.n, title: v.title, interactive: v.interactive, id: v.id, digest: v.digest })),
  });
  const timer = setTimeout(() => preview.close(), timeoutMs);
  await preview.closed;
  clearTimeout(timer);
  say({ event: "closed", blocked: [...preview.blocked].slice(0, 20) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(e instanceof PreviewError ? e.code : 1);
  });
}

export const SCRIPT = fileURLToPath(import.meta.url);
