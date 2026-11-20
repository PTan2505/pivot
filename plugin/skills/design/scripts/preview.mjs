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
// Prints one JSON line when ready ({"event":"ready",…}), one for a pick ({"event":"chosen",…}), one for feedback the user
// sent from the window's "Feedback for Claude" ({"event":"feedback",…}: this process posts it to PIVOT as feedback from
// PIVOT's page, so the window stays open and an agent's watcher wakes on it) and one when the window closes
// ({"event":"closed"}).
// Exits 2 when a version doesn't match its digest, 1 on other errors.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { destinationPolicy, guardContext, launchOptions, loadPlaywright, originKey, startGate } from "./motion-qa.mjs";

export const PREVIEW_VERSION = "1.1.0";
/** The widths the preview offers, as PIVOT's session page does. */
export const WIDTHS = { desktop: 1440, tablet: 768, phone: 390 };

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
  const icon = (d) =>
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview · ${esc(session.title)}</title><link rel="stylesheet" href="/shell.css"></head><body class="open">
<main id="stage"></main>
<div id="bar-place" class="bar-place bottom"><div id="bar" class="bar glass" role="toolbar" aria-label="Versions">
  <button id="prev" class="icon" aria-label="Previous version">${icon('<path d="m15 18-6-6 6-6"/>')}</button>
  <span class="pos" aria-live="polite"><span id="pos-sr" class="sr"></span><span id="pos-num" class="mono muted" aria-hidden="true"></span><span id="pos-title" aria-hidden="true"></span></span>
  <button id="next" class="icon" aria-label="Next version">${icon('<path d="m9 18 6-6-6-6"/>')}</button>
  <span class="sep" aria-hidden="true"></span>
  <button id="toggle" class="icon" aria-label="Preview controls" aria-expanded="true" aria-controls="drawer">${icon('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>')}<span id="dot" class="dot" aria-hidden="true"></span></button>
</div></div>
<aside id="drawer" class="glass" data-state="open" aria-labelledby="drawer-title">
  <div class="head"><div class="grow"><span class="kicker">Interactive preview</span><h2 id="drawer-title">${esc(session.title)}</h2>
    <p class="muted">Round ${session.round} · from PIVOT at ${esc(new URL(pivotPage).origin)}</p></div>
    <button id="close" class="icon raised" aria-label="Close preview controls">${icon('<path d="M18 6 6 18M6 6l12 12"/>')}</button></div>
  <div class="body">
    <section><h3>Versions <span class="hint">· keys 1–9, ← →</span></h3><nav id="tabs" role="tablist" aria-orientation="vertical" aria-label="Versions"></nav>
      <p id="paused" class="muted small" role="status" hidden>Shortcuts paused while the mockup has focus. Press Tab to leave it.</p></section>
    <section><h3>View</h3>
      <div class="group" role="group" aria-label="Width"><button data-width="desktop" aria-pressed="true">Desktop</button><button data-width="tablet" aria-pressed="false">Tablet</button><button data-width="phone" aria-pressed="false">Phone</button></div>
      <p id="scaled" class="muted small" hidden></p>
      <div class="group" role="group" aria-label="Motion"><button data-motion="no-preference" aria-pressed="true">Motion: full</button><button data-motion="reduce" aria-pressed="false">Motion: reduced</button></div>
      <p id="media" class="muted small"></p></section>
    <section><h3>Tools</h3><div class="group"><button id="replay">Replay</button><button id="compare" aria-pressed="false">Compare</button></div>
      <div class="group places"><span class="muted small" id="bar-label">Quick bar</span><span role="radiogroup" aria-labelledby="bar-label" class="group"><button role="radio" data-place="bottom" aria-checked="true">Bottom</button><button role="radio" data-place="top" aria-checked="false">Top</button><button role="radio" data-place="dot" aria-checked="false">Dot</button></span></div></section>
  </div>
  <div class="foot"><div id="identity" class="mono small"></div>
    <div class="choose"><button id="choose" class="primary">Choose this version</button>
    <span id="confirm" hidden>Send <b id="chosen"></b> to Claude as your choice? This window closes, and Claude asks you to approve it.
    <input id="note" maxlength="2000" placeholder="Note for the build (optional)" aria-label="Note for the build (optional)">
    <span class="group"><button id="send" class="primary">Send to Claude</button><button id="cancel">Cancel</button></span></span></div>
    <div class="fb"><label for="fb-text" class="small muted">Feedback for Claude</label>
    <textarea id="fb-text" maxlength="5000" rows="3" placeholder="What should change? Claude answers with a new round."></textarea>
    <button id="fb-send" disabled>Send feedback</button><span id="fb-status" class="small muted" role="status"></span></div>
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
.fb{display:flex;flex-direction:column;gap:6px}#fb-text{font:inherit;font-size:14px;background:var(--surface);color:var(--ink);border:0;border-radius:14px;padding:8px 12px;resize:vertical;min-height:64px}
#fb-text:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px}.approve{line-height:1.5}.approve .group{margin-top:6px;flex-wrap:nowrap}#copy{flex:none;white-space:nowrap}#pivot{font:12px "Geist Mono",ui-monospace,monospace;height:32px}
@media (pointer:coarse){button{height:44px}button.icon{width:44px;height:44px}[role=tab]{min-height:44px}.bar{height:52px}}`;

/** The preview page's behaviour (served as /shell.js). It reads /versions.json, the checked versions' metadata. */
const SHELL_JS = `(() => {
const WIDTHS = ${JSON.stringify(WIDTHS)};
let versions = [], current = 0, width = "desktop", comparing = false, nonce = 0;
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
}
const show = (i) => { current = (i + versions.length) % versions.length; comparing = false; paused = false; $("confirm").hidden = true; render(); };
// drawer: open on a first visit, then as left; Esc or the toggle closes it and focus returns to the toggle
let open = stored("pivot.preview.drawer") !== "closed";
function setOpen(next, focus) {
  open = next; store("pivot.preview.drawer", next ? "open" : "closed");
  $("drawer").dataset.state = next ? "open" : "closed"; $("drawer").inert = !next;
  document.body.classList.toggle("open", next); $("toggle").setAttribute("aria-expanded", String(next));
  if (!focus) return;
  if (next) requestAnimationFrame(() => document.querySelector("[role=tab][aria-selected=true]")?.focus());
  else $("toggle").focus();
}
// the quick bar: bottom, top, or folded into a dot; dragged past a few pixels it moves to the nearer edge
let place = ["top", "dot"].includes(stored("pivot.preview.bar")) ? stored("pivot.preview.bar") : "bottom";
function setPlace(next) {
  place = next; store("pivot.preview.bar", next);
  $("bar-place").className = "bar-place " + next;
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
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) show(Number(b.dataset.tab));
  else if (b.dataset.width) { width = b.dataset.width; render(); }
  else if (b.dataset.place) setPlace(b.dataset.place);
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
  else if (b.id === "choose") {
    const v = versions[current];
    $("chosen").textContent = "version " + v.n + " · " + v.title + " (digest " + v.digest.slice(0, 12) + ")";
    $("confirm").hidden = false; $("note").focus();
  } else if (b.id === "cancel") { $("confirm").hidden = true; $("choose").focus(); }
  else if (b.id === "fb-send") {
    const text = $("fb-text").value.trim(); if (!text) return;
    b.disabled = true; $("fb-status").textContent = "Sending…";
    const ok = await window.pivotPreview({ feedback: text, n: versions[current].n });
    if (ok) { $("fb-text").value = ""; $("fb-status").textContent = "Sent · Claude answers with a new round"; }
    else { b.disabled = false; $("fb-status").textContent = "Not sent: PIVOT didn't take it. Try again, or write it in PIVOT."; }
  }
  else if (b.id === "send") {
    b.disabled = true;
    const ok = await window.pivotPreview({ choose: versions[current].n, note: $("note").value });
    if (!ok) { b.disabled = false; $("chosen").textContent += " — not sent, try again"; }
  }
});
$("fb-text").addEventListener("input", () => { $("fb-send").disabled = !$("fb-text").value.trim(); $("fb-status").textContent = ""; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open && !e.target.closest?.("input, textarea")) { e.preventDefault(); setOpen(false, true); return; }
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
 * carries one). Returns the stored feedback.
 */
export async function postFeedback({ pivotPage, sessionId, round, mockupId, text }) {
  const origin = new URL(pivotPage).origin;
  const res = await fetch(`${origin}/api/design/sessions/${encodeURIComponent(sessionId)}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
    body: JSON.stringify({ round, mockupId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `PIVOT answered ${res.status}`);
  return res.json();
}

/**
 * Opens the preview: its server, the gate (only the preview's origin), and a Chromium launched through it with motion
 * QA's switches and WebRTC guard. `headless`, `playwright` and `policy` are for tests (`policy` replaces the versions'
 * CSP, so a test can show the gate holds without it); the CLI never sets them. Returns handles and a `closed` promise.
 */
export async function startPreview({
  session,
  versions,
  pivotPage,
  headless = false,
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
    args: [...launch.args, ...(headless ? [] : ["--window-size=1500,1000"])],
  });
  const context = await browser.newContext({
    viewport: headless ? { width: 1500, height: 950 } : null,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  await guardContext(context);
  // The privileged controls, answered only for the preview's own page, never for a mockup frame: reduced motion, and
  // the user's pick. A pick names a version by its number; its id and digest come from the checked versions here,
  // never from the page.
  let chose = false;
  await context.exposeBinding("pivotPreview", async (source, cmd) => {
    if (source.frame !== source.page.mainFrame() || !source.frame.url().startsWith(`${site.origin}/`)) return false;
    if (typeof cmd?.reducedMotion === "boolean") {
      await source.page.emulateMedia({ reducedMotion: cmd.reducedMotion ? "reduce" : "no-preference" });
      onEvent({ event: "motion", reduced: cmd.reducedMotion });
      return true;
    }
    if (cmd && typeof cmd.feedback === "string") {
      // The user's feedback, typed in this window's own controls: this process (not the locked browser) sends it to
      // PIVOT as feedback from PIVOT's page, so a waiting agent's watcher wakes on it, whoever opened the window.
      const v = versions.find((x) => x.n === cmd.n);
      const text = cmd.feedback.trim().slice(0, 5000);
      if (!v || !text) return false;
      try {
        const fb = await sendFeedback({ pivotPage, sessionId: session.id, round: v.round, mockupId: v.id, text });
        onEvent({ event: "feedback", round: v.round, n: v.n, id: v.id, feedbackId: fb?.id ?? null });
        return true;
      } catch (err) {
        onEvent({ event: "feedback-failed", n: v.n, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
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
  return { origin: site.origin, browser, context, page: () => page, blocked, blockedWrites, close, closed };
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
