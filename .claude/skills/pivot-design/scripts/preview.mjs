#!/usr/bin/env node
// Interactive preview of a design session's mockups: node preview.mjs <sessionId> [--round <n>] [--url <PIVOT url>]
//   [--timeout-min 240]
//
// Opens a separate Chromium window where the user tries the versions of a round: interactive versions run their own
// scripts, static ones don't. Tabs (keys 1–9, ←/→) switch versions, Desktop / Tablet / Phone set the width, Motion:
// Reduced emulates prefers-reduced-motion, Replay restarts a version, Compare shows them side by side. Each tab names
// the version's id and digest, the same digest PIVOT shows next to "Approve this version".
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
// says so in the chat (recorded with the version's id and digest). This window can't approve anything.
//
// Prints one JSON line when ready ({"event":"ready",…}) and one when the user closes the window ({"event":"closed"}).
// Exits 2 when a version doesn't match its digest, 1 on other errors.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { destinationPolicy, guardContext, launchOptions, loadPlaywright, originKey, startGate } from "./motion-qa.mjs";

export const PREVIEW_VERSION = "1.0.0";
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview · ${esc(session.title)}</title><link rel="stylesheet" href="/shell.css"></head><body>
<header><div class="title"><strong>Interactive preview</strong><span>${esc(session.title)} · round ${session.round} · from PIVOT at ${esc(new URL(pivotPage).origin)}</span></div>
<nav id="tabs" role="tablist" aria-label="Versions"></nav></header>
<div class="bar">
  <div class="group" role="group" aria-label="Width"><button data-width="desktop" aria-pressed="true">Desktop</button><button data-width="tablet" aria-pressed="false">Tablet</button><button data-width="phone" aria-pressed="false">Phone</button></div>
  <div class="group" role="group" aria-label="Motion"><button data-motion="no-preference" aria-pressed="true">Motion: full</button><button data-motion="reduce" aria-pressed="false">Motion: reduced</button></div>
  <button id="replay">Replay</button><button id="compare" aria-pressed="false">Compare</button>
  <span id="media" class="muted"></span>
</div>
<main id="stage"></main>
<footer><div id="identity"></div>
<div class="approve">To approve exactly this version, open the session in PIVOT and press <b>Approve this version</b> on the same version: PIVOT shows the same digest.
<input id="pivot" readonly value="${esc(pivotPage)}" aria-label="PIVOT session page"><button id="copy">Copy link</button> Or tell Claude which version you choose, with its digest.</div></footer>
<script src="/shell.js"></script></body></html>`;
}

const SHELL_CSS = `:root{color-scheme:dark;--bg:#0d0b0a;--surface:#1a1614;--line:#2c2522;--ink:#f3eee9;--muted:#b3a89f;--accent:#ff6a1f}
*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
header,.bar,footer{padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}header{justify-content:space-between;border-bottom:1px solid var(--line)}
.title{display:flex;gap:10px;align-items:baseline}.title span,.muted{color:var(--muted)}
button{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer}
button[aria-pressed=true],button[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:#1a0d05}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.group{display:flex;gap:4px}
nav{display:flex;gap:6px;flex-wrap:wrap}.chip{font-size:11px;margin-left:6px;padding:1px 6px;border-radius:999px;background:#2c2522;color:var(--muted)}
button[aria-selected=true] .chip{background:#1a0d05;color:var(--accent)}
main{flex:1;overflow:auto;padding:12px;display:flex;gap:12px;justify-content:center;align-items:flex-start}
.cell{display:flex;flex-direction:column;gap:6px}.cell .label{color:var(--muted);font-size:12px}
.frame{background:#fff;border-radius:8px;overflow:hidden;transform-origin:top left}iframe{border:0;display:block;background:#fff}
footer{border-top:1px solid var(--line);font-size:13px;flex-direction:column;align-items:flex-start;gap:6px}
#identity{font-family:ui-monospace,monospace}.approve{color:var(--muted)}#pivot{width:28em;max-width:100%;font:12px ui-monospace,monospace;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:3px 6px}`;

/** The preview page's behaviour (served as /shell.js). It reads /versions.json, the checked versions' metadata. */
const SHELL_JS = `(() => {
const WIDTHS = ${JSON.stringify(WIDTHS)};
let versions = [], current = 0, width = "desktop", comparing = false, nonce = 0;
let paused = new URLSearchParams(location.search).has("crashed");
const $ = (id) => document.getElementById(id);
const frame = (v, w, scale) => {
  const box = document.createElement("div"); box.className = "frame";
  const f = document.createElement("iframe");
  f.title = "Version " + v.n + ": " + v.title;
  f.setAttribute("sandbox", v.interactive ? "allow-scripts" : "");
  f.setAttribute("referrerpolicy", "no-referrer");
  f.src = v.src + "&r=" + nonce;
  const h = Math.max(400, $("stage").clientHeight - 40);
  f.style.width = w + "px"; f.style.height = Math.round(h / scale) + "px";
  box.style.width = Math.round(w * scale) + "px"; box.style.height = h + "px";
  f.style.transform = "scale(" + scale + ")"; f.style.transformOrigin = "top left";
  box.appendChild(f); return box;
};
function render() {
  const stage = $("stage"); stage.replaceChildren();
  if (paused) {
    const p = document.createElement("p"); p.id = "crashed"; p.className = "muted";
    p.textContent = "The preview crashed while showing a version (it may use too much memory or CPU). Pick a version to continue.";
    stage.appendChild(p); return;
  }
  const list = comparing ? versions : [versions[current]];
  const avail = (stage.clientWidth - 24 - 12 * (list.length - 1)) / list.length;
  for (const v of list) {
    const w = WIDTHS[width], scale = Math.min(1, avail / w);
    const cell = document.createElement("div"); cell.className = "cell";
    if (comparing) { const l = document.createElement("div"); l.className = "label"; l.textContent = v.n + " · " + v.title + " · " + v.digest.slice(0, 12); cell.appendChild(l); }
    cell.appendChild(frame(v, w, scale)); stage.appendChild(cell);
  }
  for (const [i, b] of [...$("tabs").children].entries()) b.setAttribute("aria-selected", String(!comparing && i === current));
  for (const b of document.querySelectorAll("[data-width]")) b.setAttribute("aria-pressed", String(b.dataset.width === width));
  $("compare").setAttribute("aria-pressed", String(comparing));
  const v = versions[current];
  $("identity").textContent = comparing ? "Comparing " + versions.length + " versions" :
    "Version " + v.n + " · " + (v.interactive ? "interactive" : "static") + " · id " + v.id + " · digest " + v.digest.slice(0, 12) + " (checked against PIVOT's stored copy)";
}
const media = matchMedia("(prefers-reduced-motion: reduce)");
const showMedia = () => { $("media").textContent = "This window: " + (media.matches ? "reduced motion" : "full motion"); };
media.addEventListener("change", showMedia);
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { current = Number(b.dataset.tab); comparing = false; paused = false; render(); }
  else if (b.dataset.width) { width = b.dataset.width; render(); }
  else if (b.dataset.motion) {
    await window.pivotPreview({ reducedMotion: b.dataset.motion === "reduce" });
    for (const m of document.querySelectorAll("[data-motion]")) m.setAttribute("aria-pressed", String(m === b));
    nonce++; render(); showMedia();
  } else if (b.id === "replay") { nonce++; render(); }
  else if (b.id === "compare") { comparing = !comparing; render(); }
  else if (b.id === "copy") { $("pivot").select(); document.execCommand("copy"); b.textContent = "Copied"; }
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input")) return;
  const n = Number(e.key);
  if (n >= 1 && n <= versions.length) { current = n - 1; comparing = false; paused = false; render(); }
  else if (e.key === "ArrowRight") { current = (current + 1) % versions.length; comparing = false; render(); }
  else if (e.key === "ArrowLeft") { current = (current + versions.length - 1) % versions.length; comparing = false; render(); }
});
addEventListener("resize", () => render());
fetch("/versions.json").then((r) => r.json()).then((list) => {
  versions = list;
  for (const [i, v] of versions.entries()) {
    const b = document.createElement("button"); b.setAttribute("role", "tab"); b.dataset.tab = String(i);
    b.append(v.n + " · " + v.title);
    const c = document.createElement("span"); c.className = "chip"; c.textContent = v.interactive ? "interactive" : "static"; b.appendChild(c);
    $("tabs").appendChild(b);
  }
  render(); showMedia(); document.body.dataset.ready = "true";
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
  // The one privileged control: reduced motion, answered only for the preview's own page, never for a mockup frame.
  await context.exposeBinding("pivotPreview", async (source, cmd) => {
    if (source.frame !== source.page.mainFrame() || !source.frame.url().startsWith(`${site.origin}/`)) return false;
    if (typeof cmd?.reducedMotion === "boolean") {
      await source.page.emulateMedia({ reducedMotion: cmd.reducedMotion ? "reduce" : "no-preference" });
      onEvent({ event: "motion", reduced: cmd.reducedMotion });
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
