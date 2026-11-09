#!/usr/bin/env node
// Motion QA: checks built (or previewed) motion against the approved Motion Brief, in a real browser.
//
//   node motion-qa.mjs <plan.json> --out <scratch folder> [--brief <brief.md>] [--video] [--allow-remote]
//   node motion-qa.mjs --self-test [--out <folder>]
//
// The plan lists the brief's motion items (M1, M2…) with their trigger, the element that moves and what the brief
// expects, with full motion and with reduced motion. For each item, viewport and motion mode the script opens the
// preview in PIVOT's Chromium, performs the trigger with real input (load, scroll wheel, mouse hover or click, Tab
// focus), watches the element until it settles, then does it again from a fresh page (Replay) to check it repeats.
// Reduced motion is the browser's own emulation (Playwright `reducedMotion`), never a rewrite of the page.
//
// Every item ends Pass, Fail or Not Verified. Pass needs an executed observation of every check; anything that couldn't
// run or be observed is Not Verified, never Pass. The overall status is Pass only when every essential item of the
// approved brief passed. Timing is the duration and easing the running animation declares, compared as written in the
// brief; nothing is measured on screen and no tolerance is applied.
//
// Writes report.json, report.md and screenshots (and videos with --video) to --out: a new, empty folder in the
// scratchpad, never in the target project. `--verify report.json` re-checks the evidence files against their sha256.
// Previews must be local: a loopback URL, a file, or a mockup folder shown through the pivot-design viewer (its sandbox
// and policy); never PIVOT's own app. Every connection goes through a local gate that lets the browser reach only the
// preview's exact origin (redirects, WebSockets and workers included; not other ports or names of this machine), plus
// local origins given with --allow-origin and public hosts with --allow-remote. WebRTC is turned off with Chromium
// switches (UDP only through the gate, which carries none) plus an init script that removes the WebRTC constructors;
// which switch takes effect, and which frames the init script reaches, depend on the Chromium binary (BROWSER_ARGS,
// noWebRtc). The browser is set to resolve no host name itself: the gate does, for what it allows. The report names the
// binary. Requests that could change data
// (anything but GET, HEAD, OPTIONS) are blocked unless --allow-writes. The agent asks the user before using any of these
// flags (motion.md §9): a flag only switches this script's behaviour, it isn't an authorization, and the script can't
// tell whether the user agreed. The plan can't set them: it holds selectors and expectations, no shell command or page
// script.
// Exit code: 0 Pass, 1 Fail, 2 Not Verified, 3 couldn't run (bad plan, no Playwright or Chromium, a used --out).
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const VERSION = "1.0.0";
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const TRIGGERS = ["load", "scroll", "hover", "click", "focus", "other"];
/** Properties always watched, besides the ones the plan names. */
const WATCHED = [
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "filter",
  "clip-path",
  "visibility",
  "display",
];
/** What makes an element seen or not: compared between reduced and full motion when the brief doesn't set them. */
const VISIBILITY = ["opacity", "visibility", "display"];
/** How long one observation may run before it stops waiting for the element to settle (a harness limit, not a tolerance). */
const WINDOW_MS = 4000;
const SETTLE_MS = 300;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const isLoopback = (host) => LOOPBACK.has(host) || host.endsWith(".localhost");
const portOf = (u) => u.port || (u.protocol === "https:" ? "443" : "80");
/**
 * PIVOT's own app is never driven: its pages are same-origin with its API, so a click there could approve a mockup or
 * change the library. Its address is PIVOT_URL, or the default http://127.0.0.1:4321.
 */
export function isPivotApp(url) {
  try {
    const u = new URL(url);
    const pivot = new URL(process.env.PIVOT_URL || "http://127.0.0.1:4321");
    return /^(https?|wss?):$/.test(u.protocol) && isLoopback(u.hostname) && portOf(u) === portOf(pivot);
  } catch {
    return false;
  }
}
/** Methods that can't change anything on a server; anything else is blocked unless writes are allowed. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const bare = (host) =>
  String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
/** "host:port" as the gate compares it: lower case, IPv6 without brackets, the scheme's default port filled in. */
export function originKey(url) {
  const u = new URL(url);
  return `${bare(u.hostname)}:${portOf(u)}`;
}
const V4_LOCAL = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];
const v4num = (ip) => ip.split(".").reduce((n, x) => n * 256 + Number(x), 0);
/** True for this machine, private networks, link-local and unspecified addresses (IPv4, IPv6, IPv4-mapped IPv6). */
export function isLocalAddress(ip) {
  const a = bare(ip);
  if (net.isIPv4(a))
    return V4_LOCAL.some(
      ([base, bits]) => Math.floor(v4num(a) / 2 ** (32 - bits)) === Math.floor(v4num(base) / 2 ** (32 - bits)),
    );
  if (!net.isIPv6(a)) return false;
  const mapped = /^(?:0*:)*:?ffff:(.+)$/.exec(a)?.[1];
  if (mapped) {
    if (net.isIPv4(mapped)) return isLocalAddress(mapped);
    const [hi, lo] = mapped.split(":").map((h) => parseInt(h, 16));
    return isLocalAddress([hi >> 8, hi & 255, lo >> 8, lo & 255].join("."));
  }
  const first = parseInt(a.split(":")[0] || "0", 16);
  return a === "::" || a === "::1" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Decides where the QA browser may connect. Allowed: the preview's exact origin and origins the user allowed
 * (--allow-origin), never PIVOT. With --allow-remote, also public hosts: a name is resolved here and refused if any
 * address is local, so a name can't alias this machine or the private network; the connection goes to the address
 * that was checked. Everything else is refused, including other ports and other names of this machine.
 */
export function destinationPolicy({ allowed, allowRemote = false, lookup = (h) => dns.lookup(h, { all: true }) }) {
  const keys = new Set([...allowed].map((k) => k.toLowerCase()));
  return async (host, port) => {
    const h = bare(host);
    const key = `${h}:${port}`;
    const label = `${net.isIPv6(h) ? `[${h}]` : h}:${port}`;
    if (isPivotApp(`http://${label}/`)) return { ok: false, reason: `${label} (PIVOT)` };
    if (keys.has(key)) return { ok: true, host: h };
    if (!allowRemote) return { ok: false, reason: label };
    let addresses;
    try {
      addresses = net.isIP(h) ? [{ address: h }] : await lookup(h);
    } catch {
      return { ok: false, reason: `${label} (doesn't resolve)` };
    }
    if (!addresses.length || addresses.some((a) => isLocalAddress(a.address)))
      return { ok: false, reason: `${label} (a local or private address)` };
    return { ok: true, host: addresses[0].address };
  };
}

/**
 * The only way out of the QA browser: an HTTP proxy on loopback that applies `decide` to every connection, plain
 * requests, CONNECT tunnels (HTTPS, WebSockets) and upgrades alike, and refuses writes unless they are allowed. The
 * browser is told to send even loopback through it, so redirects, WebSockets and workers can't go around it.
 */
export async function startGate({ decide, allowWrites = false, blocked, blockedWrites }) {
  // Tunnels outlive their request, so closing the gate ends every socket it holds.
  const sockets = new Set();
  const hold = (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    return sock;
  };
  const server = http.createServer(async (req, res) => {
    let u;
    try {
      u = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = Number(portOf(u));
    const d = await decide(u.hostname, port);
    if (!d.ok) {
      blocked.add(d.reason);
      res.writeHead(403).end();
      return;
    }
    if (!allowWrites && !SAFE_METHODS.has(req.method)) {
      blockedWrites.add(`${req.method} ${u.protocol}//${u.host}${u.pathname}`);
      res.writeHead(403).end();
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const up = http.request({ host: d.host, port, method: req.method, path: u.pathname + u.search, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    req.pipe(up);
  });
  const tunnel = async (target, socket, head, firstBytes) => {
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target);
    const d = m ? await decide(m[1], Number(m[2])) : { ok: false, reason: String(target) };
    if (!d.ok) {
      blocked.add(d.reason);
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const up = hold(
      net.connect(Number(m[2]), d.host, () => {
        if (firstBytes) up.write(firstBytes);
        else socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      }),
    );
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  };
  server.on("connect", (req, socket, head) => tunnel(req.url, socket, head));
  // A WebSocket sent as a plain proxied request (ws:// by absolute URL): same rule, then the request goes through.
  server.on("upgrade", (req, socket, head) => {
    let u;
    try {
      u = new URL(req.url);
    } catch {
      socket.destroy();
      return;
    }
    const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (!/^proxy-/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    tunnel(`${u.hostname}:${portOf(u)}`, socket, head, `${lines.join("\r\n")}\r\n\r\n`);
  });
  server.on("connection", hold);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    server: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((r) => {
        server.close(() => r());
        for (const sock of sockets) sock.destroy();
      }),
  };
}

/**
 * Chromium switches for the QA browser, for what the gate (a proxy) can't see:
 * - WebRTC may send UDP only through the proxy, and an HTTP proxy carries no UDP, so it sends none. Which switch name
 *   takes effect depends on the binary. Measured on 156.0.8078.4 (Playwright 1.64.1, macOS), with a STUN recorder on
 *   another address of the machine: the headless shell (what `chromium.launch()` starts by default) obeys
 *   `--force-webrtc-ip-handling-policy` and ignores `--webrtc-ip-handling-policy`; full Chromium (`channel:
 *   "chromium"`) does the opposite. Each binary ignores the name it doesn't read, so both are passed, and with both
 *   neither binary sent a packet. Other builds or versions may differ; the regression test runs on each binary that is
 *   installed and fails when a packet arrives.
 * - Every host name the browser would resolve itself fails; the gate resolves only what it lets through.
 */
export const BROWSER_ARGS = [
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
];

/** The QA browser's launch options: everything through the gate, with the switches above. runPlan launches with this. */
export function launchOptions(gateServer) {
  // "<-loopback>" stops Chromium sending this machine's addresses around the proxy.
  return { proxy: { server: gateServer, bypass: "<-loopback>" }, args: BROWSER_ARGS };
}

/**
 * Backstop for the WebRTC switches, added as an init script: removes the WebRTC constructors before the page's own
 * scripts. Observed on 156.0.8078.4: in the headless shell it held in the page, same-origin and sandboxed frames (src,
 * srcdoc, data: URL, nested) and a constructor taken from a loaded same-origin frame; in full Chromium it did not reach
 * sandboxed srcdoc frames (the viewer's mockup frame is one), so there the switches are the only guard for those.
 */
export function noWebRtc() {
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) delete globalThis[name];
}

/** Adds the WebRTC backstop to a QA browser context. runPlan calls this for every context it opens. */
export async function guardContext(context) {
  await context.addInitScript(noWebRtc);
}

/**
 * Which Chromium binary is running, from the browser itself (CDP `Browser.getVersion`): the headless shell reports
 * `HeadlessChrome/<version>`, full Chromium `Chrome/<version>`. The WebRTC guards above depend on it.
 */
export async function browserBuild(browser) {
  try {
    const session = await browser.newBrowserCDPSession();
    const { product } = await session.send("Browser.getVersion");
    await session.detach().catch(() => {});
    if (/^HeadlessChrome\//.test(product)) return "headless shell";
    if (/^Chrome\//.test(product)) return "full Chromium";
    return `unknown (${product})`;
  } catch {
    return "unknown";
  }
}

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const kebab = (p) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
/** Computed values as compared: trimmed, and the identity matrix read as "none". */
export const norm = (v) => {
  const s = String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
  return s === "matrix(1, 0, 0, 1, 0, 0)" || s === "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"
    ? "none"
    : s;
};

// ---- plan and brief --------------------------------------------------------------------------------------------

/** Checks a plan and fills in defaults. Returns the errors that stop a run; nothing is guessed. */
export function validatePlan(input) {
  const errors = [];
  const plan = structuredClone(input ?? {});
  const t = plan.target ?? {};
  const kinds = ["url", "file", "viewer"].filter((k) => t[k]);
  if (kinds.length !== 1) errors.push("target needs exactly one of url, file or viewer");
  if (t.url) {
    try {
      const u = new URL(t.url);
      if (!/^https?:$/.test(u.protocol) || !isLoopback(u.hostname))
        errors.push(`target.url must be a local preview (127.0.0.1, localhost or [::1]): ${t.url}`);
      else if (isPivotApp(t.url))
        errors.push(`target.url is PIVOT itself (${u.host}): motion QA never drives PIVOT's own pages`);
    } catch {
      errors.push(`target.url isn't a URL: ${t.url}`);
    }
  }
  if (t.viewer && !(Number.isInteger(t.version) && t.version > 0))
    errors.push("target.viewer needs target.version (the mockup's number in the viewer)");
  plan.viewports = (plan.viewports ?? ["desktop", "phone"]).map((v) =>
    typeof v === "string" ? { name: v, ...VIEWPORTS[v] } : v,
  );
  for (const v of plan.viewports)
    if (!v.name || !(v.width > 0) || !(v.height > 0)) errors.push(`bad viewport ${JSON.stringify(v)}`);
  if (!Array.isArray(plan.items) || !plan.items.length) errors.push("items is empty");
  const seen = new Set();
  for (const item of plan.items ?? []) {
    const where = `item ${item.id ?? "(no id)"}`;
    if (!/^M\d+$/.test(item.id ?? "")) errors.push(`${where}: id must be the brief's M1, M2…`);
    else if (seen.has(item.id)) errors.push(`${where}: duplicate id`);
    seen.add(item.id);
    if (!item.name) errors.push(`${where}: name missing`);
    if (!["essential", "detail"].includes(item.tag)) errors.push(`${where}: tag must be essential or detail`);
    if (typeof item.trigger === "string") item.trigger = { type: item.trigger };
    if (!TRIGGERS.includes(item.trigger?.type)) errors.push(`${where}: trigger.type must be one of ${TRIGGERS}`);
    if (item.trigger?.type === "other") continue;
    if (!item.target) errors.push(`${where}: target (the element that moves) missing`);
    if (typeof item.expect?.animates !== "boolean") errors.push(`${where}: expect.animates must be true or false`);
    if (item.reduced && item.reduced.animates !== undefined && typeof item.reduced.animates !== "boolean")
      errors.push(`${where}: reduced.animates must be true or false`);
  }
  return { plan, errors };
}

/**
 * The motion items of a brief's Motion block: rows of the table whose header has "Item" and "Tag". The item cell
 * starts with its id ("M1 · Hero entrance"); the tag is essential or detail.
 */
export function parseBriefMotion(md) {
  const items = [];
  let inTable = false;
  for (const line of String(md ?? "").split("\n")) {
    if (!line.trim().startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (/^item$/i.test(cells[0]) && cells.some((c) => /^tag$/i.test(c))) {
      inTable = true;
      continue;
    }
    if (!inTable || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const id = /^(M\d+)\b/.exec(cells[0])?.[1] ?? null;
    const name = cells[0].replace(/^M\d+\s*[·:.\-–—]?\s*/, "").trim();
    const tag = /\b(essential|detail)\b/i.exec(cells.at(-1))?.[1]?.toLowerCase() ?? null;
    items.push({ id, name, tag });
  }
  return items;
}

/** Ties the plan to the approved brief: essential items without a check, checks the brief doesn't have, tags. */
export function traceItems(planItems, briefItems) {
  if (!briefItems) return { checked: false, missing: [], extra: [], unnamed: 0, tagMismatch: [] };
  const byId = new Map(briefItems.filter((b) => b.id).map((b) => [b.id, b]));
  return {
    checked: true,
    unnamed: briefItems.filter((b) => !b.id).length,
    missing: briefItems.filter((b) => b.id && !planItems.some((p) => p.id === b.id)),
    extra: planItems.filter((p) => !byId.has(p.id)).map((p) => p.id),
    tagMismatch: planItems
      .filter((p) => byId.get(p.id)?.tag && byId.get(p.id).tag !== p.tag)
      .map((p) => ({ id: p.id, plan: p.tag, brief: byId.get(p.id).tag })),
  };
}

// ---- judging ---------------------------------------------------------------------------------------------------

/** What must repeat on Replay: whether it moved, which properties, the declared timing and where it ended. */
export const signature = (o) =>
  JSON.stringify({
    motion: o.motion,
    properties: [...(o.properties ?? [])].sort(),
    declared: (o.declared ?? []).map((d) => `${d.name}:${d.durationMs}:${d.easing}`).sort(),
    end: Object.fromEntries(Object.entries(o.end ?? {}).sort()),
  });

const endDiff = (want, got) =>
  Object.entries(want ?? {})
    .filter(([p, v]) => norm(got?.[p]) !== norm(v))
    .map(([p, v]) => `${p} ${norm(got?.[p]) || "(unset)"} instead of ${norm(v)}`);

/**
 * Judges one item from its observations: `runs[viewport] = { full: [first, replay], reduced: [first, replay] }`.
 * Each check is pass, fail or not verified; the item fails on any failed check, is Not Verified on any check that
 * couldn't be made, and passes only when every check was observed and passed.
 */
export function judgeItem(item, runs, viewports) {
  const checks = [];
  const add = (viewport, mode, check, status, detail = "") => checks.push({ viewport, mode, check, status, detail });
  /** What can't be judged from an observation that didn't see the whole thing. */
  const incomplete = (vp, mode, o) => {
    if (o.unsettled) add(vp, mode, "settled", "not verified", "the page never stopped animating before the trigger");
    if (o.capped) add(vp, mode, "settled", "not verified", "the observation window ended before the element settled");
    if (o.lostTarget) add(vp, mode, "final state", "not verified", "the element disappeared while it was watched");
  };
  const moves = (vp, mode, o, expected) => {
    const what = `${expected ? "expected motion" : "expected no motion"}; ${o.motion ? "motion observed" : "no motion observed"}`;
    // A finished animation found on the element, never seen running: it may have run before anyone watched.
    if (!o.motion && o.finishedBeforeWatch)
      add(vp, mode, "moves", "not verified", `an animation on it had already finished when watching began; ${what}`);
    else add(vp, mode, "moves", o.motion === expected ? "pass" : "fail", what);
  };
  if (item.trigger.type === "other") {
    add(
      null,
      null,
      "trigger",
      "not verified",
      `no automatic trigger${item.trigger.note ? `: ${item.trigger.note}` : ""}`,
    );
  } else {
    for (const { name: vp } of viewports) {
      const [first, replay] = runs?.[vp]?.full ?? [];
      if (!first?.executed) add(vp, "full", "trigger", "not verified", first?.error ?? "not run");
      else {
        add(vp, "full", "trigger", "pass", `${item.trigger.type} performed`);
        incomplete(vp, "full", first);
        moves(vp, "full", first, item.expect.animates);
        const props = (item.expect.properties ?? []).map(kebab);
        if (props.length && !first.motion && first.finishedBeforeWatch)
          add(vp, "full", "properties", "not verified", "the motion wasn't seen, so its properties can't be read");
        else if (props.length) {
          const missing = props.filter((p) => !first.properties.includes(p));
          add(
            vp,
            "full",
            "properties",
            missing.length ? "fail" : "pass",
            missing.length ? `${missing.join(", ")} didn't change` : props.join(", "),
          );
        }
        if (item.expect.end && !first.lostTarget) {
          const diff = endDiff(item.expect.end, first.end);
          add(vp, "full", "final state", diff.length ? "fail" : "pass", diff.join("; ") || "as briefed");
        }
        if (item.expect.durationMs != null || item.expect.easing) {
          const want = `${item.expect.durationMs ?? "any"} ms, ${item.expect.easing ?? "any easing"}`;
          if (!first.declared.length)
            add(
              vp,
              "full",
              "declared timing",
              "not verified",
              `no declared timing to read (script-driven motion?); brief: ${want}`,
            );
          else {
            const ok = first.declared.some(
              (d) =>
                (item.expect.durationMs == null || d.durationMs === item.expect.durationMs) &&
                (!item.expect.easing || d.easing === item.expect.easing),
            );
            const got = first.declared.map((d) => `${d.name} ${d.durationMs} ms ${d.easing}`).join(", ");
            add(
              vp,
              "full",
              "declared timing",
              ok ? "pass" : "fail",
              `declared ${got}; brief: ${want} (declared values, not measured on screen)`,
            );
          }
        }
        for (const [key, label] of [
          ["cls", "layout shift"],
          ["longFrames", "long frames"],
        ]) {
          const budget = item.budgets?.[key];
          if (budget == null) continue;
          if (first[key] == null) add(vp, "full", label, "not verified", "not measured in this preview");
          else
            add(vp, "full", label, first[key] > budget ? "fail" : "pass", `${first[key]} (brief: at most ${budget})`);
        }
        if (!replay?.executed) add(vp, "full", "replay", "not verified", replay?.error ?? "replay not run");
        else
          add(
            vp,
            "full",
            "replay",
            signature(first) === signature(replay) ? "pass" : "fail",
            signature(first) === signature(replay) ? "same result" : `differs: ${describeDiff(first, replay)}`,
          );
      }

      if (!item.reduced) {
        add(
          vp,
          "reduced",
          "reduced motion",
          "not verified",
          "the brief gives no reduced-motion behaviour for this item",
        );
        continue;
      }
      const [r1, r2] = runs?.[vp]?.reduced ?? [];
      if (!r1?.executed) {
        add(vp, "reduced", "trigger", "not verified", r1?.error ?? "not run");
        continue;
      }
      incomplete(vp, "reduced", r1);
      if (typeof item.reduced.animates === "boolean") moves(vp, "reduced", r1, item.reduced.animates);
      const banned = (item.reduced.notProperties ?? []).map(kebab).filter((p) => r1.animated.includes(p));
      if (item.reduced.notProperties?.length)
        add(
          vp,
          "reduced",
          "no movement",
          banned.length ? "fail" : "pass",
          banned.length ? `${banned.join(", ")} animated` : "",
        );
      const rprops = (item.reduced.properties ?? []).map(kebab).filter((p) => !r1.properties.includes(p));
      if (item.reduced.properties?.length)
        add(
          vp,
          "reduced",
          "properties",
          rprops.length ? "fail" : "pass",
          rprops.length ? `${rprops.join(", ")} didn't change` : "",
        );
      const wantEnd = item.reduced.end ?? item.expect.end;
      if (wantEnd && !r1.lostTarget) {
        const diff = endDiff(wantEnd, r1.end);
        add(vp, "reduced", "final state", diff.length ? "fail" : "pass", diff.join("; ") || "same final state");
      }
      // Whatever the brief says about the end, reduced motion must leave the element as visible as full motion does.
      const fullEnd = first?.executed && !first.lostTarget ? first.end : null;
      const unbriefed = VISIBILITY.filter((p) => !(p in (wantEnd ?? {})));
      if (!r1.lostTarget && unbriefed.length) {
        if (!fullEnd) add(vp, "reduced", "visibility", "not verified", "no full-motion run to compare with");
        else {
          const diff = endDiff(Object.fromEntries(unbriefed.map((p) => [p, fullEnd[p]])), r1.end);
          add(
            vp,
            "reduced",
            "visibility",
            diff.length ? "fail" : "pass",
            diff.length ? `${diff.join("; ")} (as ended with full motion)` : "as visible as with full motion",
          );
        }
      }
      if (!r2?.executed) add(vp, "reduced", "replay", "not verified", r2?.error ?? "replay not run");
      else
        add(
          vp,
          "reduced",
          "replay",
          signature(r1) === signature(r2) ? "pass" : "fail",
          signature(r1) === signature(r2) ? "same result" : `differs: ${describeDiff(r1, r2)}`,
        );
    }
  }
  const result = checks.some((c) => c.status === "fail")
    ? "Fail"
    : checks.some((c) => c.status === "not verified") || !checks.length
      ? "Not Verified"
      : "Pass";
  return { result, checks };
}

function describeDiff(a, b) {
  const out = [];
  if (a.motion !== b.motion) out.push(`motion ${a.motion} then ${b.motion}`);
  const ea = endDiff(a.end, b.end);
  if (ea.length) out.push(`final state ${ea.join(", ")}`);
  if (JSON.stringify([...a.properties].sort()) !== JSON.stringify([...b.properties].sort()))
    out.push(`properties ${a.properties} then ${b.properties}`);
  return out.join("; ") || "declared timing";
}

/** The overall status: Pass only when every essential item of the approved brief passed. */
export function aggregate(items, trace) {
  const essential = items.filter((i) => i.tag === "essential");
  const reasons = [];
  const failed = essential.filter((i) => i.result === "Fail");
  const unverified = essential.filter((i) => i.result === "Not Verified");
  const missing = trace.missing.filter((m) => m.tag !== "detail");
  if (failed.length) reasons.push(`essential items failed: ${failed.map((i) => i.id).join(", ")}`);
  if (unverified.length) reasons.push(`essential items not verified: ${unverified.map((i) => i.id).join(", ")}`);
  if (!trace.checked)
    reasons.push("the approved brief wasn't given (--brief), so its essential items couldn't be listed");
  if (missing.length) reasons.push(`brief items with no check: ${missing.map((m) => m.id).join(", ")}`);
  if (trace.extra.length) reasons.push(`checks not in the approved brief: ${trace.extra.join(", ")}`);
  if (trace.unnamed) reasons.push(`${trace.unnamed} brief item(s) have no M-number, so they can't be traced`);
  if (trace.checked && !essential.length && !missing.length) reasons.push("no essential motion item to verify");
  const status = failed.length
    ? "Fail"
    : unverified.length || !trace.checked || missing.length || trace.extra.length || trace.unnamed || !essential.length
      ? "Not Verified"
      : "Pass";
  const details = items.filter((i) => i.tag === "detail");
  return {
    status,
    reasons,
    counts: Object.fromEntries(
      ["Pass", "Fail", "Not Verified"].map((r) => [
        r,
        {
          essential: essential.filter((i) => i.result === r).length,
          detail: details.filter((i) => i.result === r).length,
        },
      ]),
    ),
    detailFailures: details.filter((i) => i.result === "Fail").map((i) => i.id),
  };
}

/** A plain hint for each kind of failed check; the brief decides the fix. */
const HINTS = {
  moves: "Make the trigger start the briefed animation (or remove motion the brief doesn't have).",
  properties: "Animate the properties the brief names.",
  "reduced moves": "The reduced-motion branch doesn't do what the brief's Reduced motion cell says.",
  "reduced final state":
    "With reduced motion the element must still reach its final state: a rule that only removes the animation can leave it at its hidden start.",
  "final state": "The element doesn't end where the brief and the approved mockup put it.",
  "declared timing": "Use the duration and easing the brief states.",
  "reduced visibility":
    "With reduced motion the element ends less visible than with full motion: give the reduced branch the final state.",
  replay: "The second run differs from the first: state left over from the last run, or a one-time animation.",
  "no movement": "The reduced-motion branch still moves things: drop the movement, keep at most the briefed fade.",
  "layout shift": "The motion shifts layout: animate transform/opacity and reserve the element's space.",
  "long frames": "Frames over 50 ms during the motion: lighter properties, fewer elements, or off the main thread.",
};

export function renderMarkdown(r) {
  const out = [];
  out.push(`# Motion QA: ${r.project ?? "(project)"} — ${r.overall.status}`, "");
  out.push(`- Implementation: ${r.implementation}`);
  out.push(
    `- Approved brief: ${r.brief.label}${r.brief.sha256 ? ` (file sha256 ${r.brief.sha256.slice(0, 12)})` : ""}`,
  );
  out.push(`- Preview: ${r.target.label}`);
  out.push(
    `- Browser: ${r.environment.browser} (Playwright ${r.environment.playwright}, headless) on ${r.environment.os}, ${r.environment.node}`,
  );
  out.push(`- Reduced motion: ${r.environment.reducedMotion}`);
  out.push(`- Viewports: ${r.viewports.map((v) => `${v.name} ${v.width}×${v.height}`).join(", ")}`);
  out.push(
    `- Run: ${r.runId ?? "(no id)"}, ${r.startedAt}, motion-qa ${r.tool.version}, plan sha256 ${r.plan.sha256.slice(0, 12)}`,
  );
  if (r.network) out.push(`- Network: other hosts ${r.network.remote}; writes ${r.network.writes}`);
  out.push(
    "- Evidence: the files listed below, each with its sha256 in report.json; `motion-qa.mjs --verify report.json` re-checks them",
    "",
  );
  out.push(`**Overall: ${r.overall.status}.** ${r.overall.reasons.join("; ") || "every essential item passed"}.`, "");
  out.push("| ID | Item | Tag | Trigger | Result | Reduced motion |", "| --- | --- | --- | --- | --- | --- |");
  for (const i of r.items) {
    const red = i.checks.filter((c) => c.mode === "reduced");
    const redStatus = red.some((c) => c.status === "fail")
      ? "Fail"
      : red.some((c) => c.status === "not verified") || !red.length
        ? "Not Verified"
        : "Pass";
    out.push(`| ${i.id} | ${i.name} | ${i.tag} | ${i.trigger.type} | ${i.result} | ${redStatus} |`);
  }
  for (const m of r.trace.missing)
    out.push(`| ${m.id} | ${m.name} | ${m.tag ?? "?"} | – | Not Verified (no check) | – |`);
  out.push("");
  for (const i of r.items) {
    out.push(`## ${i.id} · ${i.name} — ${i.result}`, "");
    if (i.intent) out.push(`- Intent (brief): ${i.intent}`);
    if (i.reference) out.push(`- Reference: ${i.reference}`);
    out.push(
      `- Trigger: ${i.trigger.type}${i.trigger.on ? ` on \`${i.trigger.on}\`` : ""}; element \`${i.target ?? "–"}\``,
    );
    for (const o of i.observations ?? [])
      out.push(
        `- Observed (${o.viewport}, ${o.mode}, ${o.run}): ${
          o.executed
            ? `${o.motion ? `motion in ${o.properties.join(", ") || "(no watched property)"}` : "no motion"}; final ${Object.entries(
                o.end,
              )
                .map(([p, v]) => `${p} ${norm(v)}`)
                .join(
                  ", ",
                )}${o.declared.length ? `; declared ${o.declared.map((d) => `${d.name} ${d.durationMs} ms ${d.easing}`).join(", ")}` : ""}`
            : `not executed: ${o.error}`
        }`,
      );
    const bad = i.checks.filter((c) => c.status !== "pass");
    for (const c of bad)
      out.push(
        `- **${c.status === "fail" ? "Fail" : "Not verified"}** ${c.viewport ? `(${c.viewport}, ${c.mode}) ` : ""}${c.check}: ${c.detail}${c.status === "fail" && (HINTS[`${c.mode} ${c.check}`] ?? HINTS[c.check]) ? ` Fix: ${HINTS[`${c.mode} ${c.check}`] ?? HINTS[c.check]}` : ""}`,
      );
    const ev = (i.observations ?? []).flatMap((o) => o.evidence);
    if (ev.length) out.push(`- Evidence: ${ev.map((e) => `\`${e.file}\` (${e.what})`).join(", ")}`);
    out.push("");
  }
  out.push("## Not verified by this run", "");
  for (const l of r.limitations) out.push(`- ${l}`);
  if (r.specialists?.length) {
    out.push("", "## Specialists (declared by the agent, not checked here; trace-check verifies them)", "");
    for (const s of r.specialists) out.push(`- ${s.name} — ${s.phase ?? "qa"} — ${s.run}`);
  }
  return out.join("\n") + "\n";
}

// ---- browser ---------------------------------------------------------------------------------------------------

/** PIVOT's Playwright, found from this script's real location (the skill is linked from the PIVOT repo). */
export function loadPlaywright() {
  const roots = [];
  if (process.env.PIVOT_REPO) roots.push(process.env.PIVOT_REPO);
  let dir = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
  for (let i = 0; i < 8; i++, dir = path.dirname(dir)) roots.push(dir);
  const repo = roots.find((r) => fs.existsSync(path.join(r, "packages/core/package.json")));
  if (!repo)
    throw new Error(
      "Playwright not found: this script must run from the PIVOT repository (or set PIVOT_REPO). Motion stays Not Verified.",
    );
  const req = createRequire(path.join(repo, "packages/core/package.json"));
  let playwright;
  try {
    playwright = req("playwright");
  } catch {
    throw new Error(
      `Playwright isn't installed in ${repo}: run pnpm install there. Motion stays Not Verified until it runs.`,
    );
  }
  if (!fs.existsSync(playwright.chromium.executablePath()))
    throw new Error("Chromium isn't installed: run `pnpm setup:browser` in the PIVOT repo. Motion stays Not Verified.");
  return { chromium: playwright.chromium, version: req("playwright/package.json").version, repo };
}

/** Runs in the page (or the viewer's frame) at every poll: the element's watched values and its animations. */
function probe({ sel, props }) {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const values = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  const anims = el.getAnimations({ subtree: true }).map((a) => {
    const timing = a.effect?.getTiming?.() ?? {};
    const frames = a.effect?.getKeyframes?.() ?? [];
    const props = a.transitionProperty
      ? [a.transitionProperty]
      : [...new Set(frames.flatMap((k) => Object.keys(k)))].filter(
          (k) => !["offset", "computedOffset", "easing", "composite"].includes(k),
        );
    const ct = a.currentTime;
    return {
      key: `${a.constructor.name}|${a.animationName ?? a.transitionProperty ?? a.id ?? ""}|${a.startTime ?? ""}`,
      type: a.constructor.name,
      name: a.animationName ?? a.transitionProperty ?? (a.id || "animation"),
      props,
      playState: a.playState,
      scroll: !!a.timeline && a.timeline !== document.timeline && !(a.timeline instanceof DocumentTimeline),
      progress: typeof ct === "object" && ct !== null ? ct.value : ct,
      durationMs: typeof timing.duration === "number" ? timing.duration : null,
      easing: timing.easing && timing.easing !== "linear" ? timing.easing : (frames[0]?.easing ?? "linear"),
      infinite: timing.iterations === Infinity,
    };
  });
  const r = el.getBoundingClientRect();
  const m = window.__motionQa;
  return {
    found: true,
    values,
    anims,
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    viewportHeight: innerHeight,
    events: m ? m.events.filter((e) => e.el === el || el.contains(e.el)).map((e) => e.name) : null,
    cls: m ? Math.round(m.cls * 10000) / 10000 : null,
    longFrames: m ? m.longFrames : null,
  };
}

/** Installed before the page's own scripts (where scripts may run): animation events, layout shifts, long frames. */
function recorder() {
  const m = (window.__motionQa = { events: [], cls: 0, longFrames: 0 });
  for (const type of ["animationstart", "transitionrun"])
    document.addEventListener(type, (e) => m.events.push({ el: e.target, name: e.propertyName ?? e.animationName }), {
      capture: true,
      passive: true,
    });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) m.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => (m.longFrames += l.getEntries().length)).observe({
      type: "long-animation-frame",
      buffered: true,
    });
  } catch {}
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until nothing finite runs on the page and that has held for SETTLE_MS, so motion started by the load (an
 * entrance, an element already in view) can't be mistaken for the trigger's. Returns false if it never settled.
 */
async function settle(scopeOf, sel, props) {
  const t0 = Date.now();
  let quietSince = null;
  let last = null;
  while (Date.now() - t0 < WINDOW_MS) {
    const state = await (
      await scopeOf()
    )
      .evaluate(
        ({ sel, props }) => {
          const running = document
            .getAnimations()
            .some(
              (a) =>
                a.playState === "running" &&
                a.effect?.getTiming?.().iterations !== Infinity &&
                (!a.timeline || a.timeline === document.timeline),
            );
          const el = document.querySelector(sel);
          const cs = el ? getComputedStyle(el) : null;
          return { running, values: cs ? props.map((p) => cs.getPropertyValue(p)).join("|") : null };
        },
        { sel, props },
      )
      .catch(() => ({ running: true, values: null }));
    // Script-driven motion has no Animation object: the element's own values must also hold still.
    const busy = state.running || state.values !== last;
    last = state.values;
    if (busy) quietSince = null;
    else if ((quietSince ??= Date.now()) && Date.now() - quietSince >= SETTLE_MS) return true;
    await pause(16);
  }
  return false;
}

/** The computed properties watched on an item's element. */
const watchedProps = (item) => [
  ...new Set([
    ...WATCHED,
    ...(item.expect.properties ?? []).map(kebab),
    ...Object.keys(item.expect.end ?? {}).map(kebab),
    ...Object.keys(item.reduced?.end ?? {}).map(kebab),
    ...(item.reduced?.notProperties ?? []).map(kebab),
  ]),
];

async function observeOnce(page, scopeOf, item, ctx, label) {
  const sel = item.target;
  const props = watchedProps(item);
  // Owned by the caller, so screenshots taken before a failure stay in the report.
  const evidence = ctx.evidence ?? [];
  const shot = async (what) => {
    const file = `${item.id}-${label}-${what.replace(/\W+/g, "-")}.png`;
    const data = await page.screenshot({ path: path.join(ctx.out, file) });
    evidence.push({ file, what, sha256: sha256(data) });
  };
  const poll = async () => {
    try {
      return await (await scopeOf()).evaluate(probe, { sel, props });
    } catch (err) {
      return { found: false, error: String(err.message ?? err).split("\n")[0] };
    }
  };
  const waitFound = async (ms) => {
    const until = Date.now() + ms;
    for (;;) {
      const s = await poll();
      if (s.found || Date.now() > until) return s;
      await pause(16);
    }
  };

  const type = item.trigger.type;
  let before = await waitFound(3000);
  if (!before.found)
    return { executed: false, error: `element ${sel} not found${before.error ? ` (${before.error})` : ""}`, evidence };
  // Everything that was already there before the trigger doesn't count as its motion (except at load).
  const known = new Set(type === "load" ? [] : before.anims.map((a) => a.key));
  const eventsBefore = type === "load" ? 0 : (before.events?.length ?? 0);
  if (type !== "load") await shot("before");

  const scope = await scopeOf();
  const on = item.trigger.on ?? sel;
  const samples = [before];
  const box = async (s) =>
    (await scope
      .locator(s)
      .first()
      .boundingBox({ timeout: 2000 })
      .catch(() => null)) ?? null;
  try {
    if (type === "hover" || type === "click") {
      await page.mouse.move(1, 1);
      await scope.locator(on).first().scrollIntoViewIfNeeded({ timeout: 2000 });
      before = await poll();
      samples[0] = before;
      const b = await box(on);
      if (!b) return { executed: false, error: `trigger element ${on} not found or not visible`, evidence };
      // The pointer goes where the user's would: if something else covers that point, it's what gets the input.
      const covered = await scope
        .locator(on)
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !hit || hit === el || el.contains(hit)
            ? null
            : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ""}`;
        })
        .catch(() => "an unreadable element");
      if (covered)
        return {
          executed: false,
          error: `${on} is covered by ${covered} at its centre, so it can't get the ${type}`,
          evidence,
        };
      if (type === "hover") await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
      else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    } else if (type === "focus") {
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await scope
          .locator(on)
          .first()
          .evaluate((el) => el === document.activeElement || el.contains(document.activeElement))
          .catch(() => false);
      }
      if (!reached) return { executed: false, error: `Tab never reached ${on}`, evidence };
    } else if (type === "scroll") {
      const vp = page.viewportSize();
      await page.mouse.move(vp.width / 2, vp.height / 2);
      const stop = item.trigger.to ?? sel;
      let last = null;
      let reached = false;
      for (let i = 0; i < 60; i++) {
        const b = await box(stop);
        // In the upper half of the view, or wholly in view when the page can't scroll it that far.
        if (b && (b.y <= vp.height * 0.5 || (last !== null && b.y >= 0 && b.y + b.height <= vp.height))) {
          reached = true;
          break;
        }
        await page.mouse.wheel(0, 240);
        await pause(60);
        const s = await poll();
        samples.push(s);
        const y = JSON.stringify(s.rect);
        if (y === last) {
          const b2 = await box(stop);
          reached = !!b2 && b2.y >= 0 && b2.y < vp.height;
          break; // the page can't scroll further
        }
        last = y;
      }
      if (!reached) return { executed: false, error: `scrolling never brought ${stop} into view`, evidence };
    }
  } catch (err) {
    return { executed: false, error: `trigger failed: ${String(err.message ?? err).split("\n")[0]}`, evidence };
  }

  // Watch until nothing runs and the values hold, or the window ends.
  const t0 = Date.now();
  let lastChange = Date.now();
  let prev = JSON.stringify(samples.at(-1).values);
  let during = false;
  let capped = false;
  let lostTarget = false;
  for (;;) {
    const s = await poll();
    if (!s.found) {
      lostTarget = true;
      break;
    }
    samples.push(s);
    const now = JSON.stringify(s.values);
    if (now !== prev) {
      lastChange = Date.now();
      prev = now;
    }
    const running = s.anims.filter((a) => a.playState === "running" && !a.scroll);
    if (!during && running.some((a) => !known.has(a.key))) {
      during = true;
      await shot(`during, about ${Date.now() - t0} ms into watching`);
    }
    if (!running.some((a) => !a.infinite) && Date.now() - lastChange >= SETTLE_MS && Date.now() - t0 >= 100) break;
    if (Date.now() - t0 > (item.windowMs ?? WINDOW_MS)) {
      capped = true;
      break;
    }
    await pause(16);
  }
  const after = samples.at(-1);
  await shot("after");

  const fresh = samples
    .flatMap((s) => s.anims ?? [])
    .filter((a) => !known.has(a.key) && (a.scroll || (a.durationMs ?? 0) > 0));
  // An animation counts as motion only if it was seen running; one only ever seen finished ran before anyone watched,
  // and one only ever seen paused never ran.
  const seenRunning = new Set(fresh.filter((a) => a.playState === "running").map((a) => a.key));
  const ran = fresh.filter((a) => a.scroll || seenRunning.has(a.key));
  const finishedBeforeWatch = fresh.some((a) => !a.scroll && !seenRunning.has(a.key) && a.playState === "finished");
  const scrolled = samples
    .flatMap((s) => s.anims ?? [])
    .filter((a) => a.scroll)
    .reduce((m, a) => m.set(a.key, [...(m.get(a.key) ?? []), a.progress]), new Map());
  const scrollMoved = [...scrolled.values()].some((ps) => new Set(ps).size > 1);
  const newEvents = (after.events ?? []).slice(eventsBefore);
  const changed = props.filter((p) => samples.some((s) => s.values && norm(s.values[p]) !== norm(before.values[p])));
  const between = props.filter((p) =>
    samples.some(
      (s) => s.values && norm(s.values[p]) !== norm(before.values[p]) && norm(s.values[p]) !== norm(after.values[p]),
    ),
  );
  const animated = [
    ...new Set([
      ...ran.flatMap((a) => a.props.map(kebab)),
      ...newEvents.filter((n) => n.includes("-") || props.includes(n)),
    ]),
  ];
  const declared = [
    ...new Map(fresh.filter((a) => !a.scroll).map((a) => [`${a.name}|${a.durationMs}|${a.easing}`, a])).values(),
  ].map((a) => ({
    name: a.name,
    durationMs: a.durationMs,
    easing: a.easing,
  }));
  return {
    executed: true,
    motion: ran.some((a) => !a.scroll) || scrollMoved || between.length > 0,
    finishedBeforeWatch,
    lostTarget,
    properties: [...new Set([...animated, ...between, ...changed.filter((p) => ran.length || scrollMoved)])],
    animated: [...new Set([...animated, ...between])],
    declared,
    end: after.values,
    infinite: fresh.some((a) => a.infinite),
    capped,
    cls: after.cls == null ? null : Math.round((after.cls - (type === "load" ? 0 : before.cls)) * 10000) / 10000,
    longFrames: after.longFrames == null ? null : after.longFrames - (type === "load" ? 0 : before.longFrames),
    samples: samples.length,
    evidence,
  };
}

/** Runs every item at every viewport, with full and reduced motion, each twice (the second time is the Replay). */
export async function runPlan(
  rawPlan,
  {
    out,
    briefText = null,
    briefFile = null,
    video = false,
    allowRemote = false,
    allowWrites = false,
    allowOrigins = [],
    // Tests only: a wrapped Playwright, to see what runPlan really launches. The CLI never sets it.
    playwright = null,
  } = {},
) {
  const { plan, errors } = validatePlan(rawPlan);
  if (errors.length) throw new Error(`Plan errors:\n- ${errors.join("\n- ")}`);
  // A fresh folder per run, so no file from another run can sit next to this report.
  if (fs.existsSync(out) && fs.readdirSync(out).length)
    throw new Error(
      `${out} isn't empty: give each run a new --out folder, so its evidence can't mix with another run's`,
    );
  fs.mkdirSync(out, { recursive: true });
  const runId = crypto.randomUUID();
  const { chromium, version } = playwright ?? loadPlaywright();
  const startedAt = new Date().toISOString();
  const blocked = new Set();
  const blockedWrites = new Set();

  // Where the preview comes from, and what identifies it.
  let url;
  let targetLabel;
  let targetHash = null;
  if (plan.target.url) {
    url = plan.target.url;
    targetLabel = url;
  } else if (plan.target.file) {
    const file = path.resolve(plan.target.file);
    targetHash = sha256(fs.readFileSync(file));
    url = pathToFileURL(file).href;
    targetLabel = `${file} (sha256 ${targetHash.slice(0, 12)})`;
  } else {
    const { buildViewer } = await import(new URL("../viewer/make-viewer.mjs", import.meta.url).href);
    const { page, versions } = buildViewer(path.resolve(plan.target.viewer), {
      title: "Motion QA",
      interactive: plan.target.interactive ? [plan.target.version] : [],
    });
    const v = versions.find((x) => x.n === plan.target.version);
    if (!v) throw new Error(`The mockup folder has no version ${plan.target.version}`);
    const viewerDir = path.join(out, "viewer");
    fs.mkdirSync(viewerDir, { recursive: true });
    fs.writeFileSync(path.join(viewerDir, "index.html"), page);
    url = `${pathToFileURL(path.join(viewerDir, "index.html")).href}#${v.n}`;
    targetHash = v.digest;
    targetLabel = `mockup ${v.n} "${v.title}" in the pivot-design viewer (${v.interactive ? "interactive" : "static"}, digest ${v.digest})`;
  }

  let implementation = plan.version ?? "(not given)";
  if (plan.projectPath) {
    try {
      const head = execFileSync("git", ["-C", plan.projectPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const dirty = execFileSync("git", ["-C", plan.projectPath, "status", "--porcelain"], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean).length;
      implementation = `${plan.version ? `${plan.version}, ` : ""}git ${head.slice(0, 12)}${dirty ? ` + ${dirty} uncommitted change(s)` : ""}`;
    } catch {
      implementation += " (git revision unreadable)";
    }
  }

  // Every connection, loopback included, goes through the gate: request routing alone misses redirects, WebSockets and
  // workers. The preview's own origin is allowed, plus what the user allowed on the command line; never the plan.
  const allowed = new Set(plan.target.url ? [originKey(plan.target.url)] : []);
  for (const o of allowOrigins) {
    const u = new URL(o);
    if (!isLoopback(u.hostname) || isPivotApp(u.href))
      throw new Error(`--allow-origin must be a local origin other than PIVOT: ${o}`);
    allowed.add(originKey(o));
  }
  const gate = await startGate({
    decide: destinationPolicy({ allowed, allowRemote }),
    allowWrites,
    blocked,
    blockedWrites,
  });
  const browser = await chromium.launch(launchOptions(gate.server)).catch(async (err) => {
    await gate.close();
    throw err;
  });
  const browserVersion = browser.version();
  const build = await browserBuild(browser);
  const viewer = !!plan.target.viewer;
  const results = [];
  try {
    for (const item of plan.items) {
      const runs = {};
      const observations = [];
      if (item.trigger.type !== "other") {
        for (const vp of plan.viewports) {
          runs[vp.name] = {};
          for (const mode of ["full", "reduced"]) {
            if (mode === "reduced" && !item.reduced) continue;
            const context = await browser.newContext({
              viewport: { width: vp.width, height: vp.height },
              reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
              serviceWorkers: "block",
              ...(video
                ? { recordVideo: { dir: path.join(out, "videos"), size: { width: vp.width, height: vp.height } } }
                : {}),
            });
            await guardContext(context);
            await context.addInitScript(recorder);
            await context.route("**/*", (route) => {
              const req = route.request();
              const u = new URL(req.url());
              const web = /^(https?|wss?):$/.test(u.protocol);
              if (web && isPivotApp(u.href)) {
                blocked.add(`${u.protocol}//${u.host} (PIVOT)`);
                return route.abort("blockedbyclient");
              }
              if (web && !allowWrites && !SAFE_METHODS.has(req.method())) {
                blockedWrites.add(`${req.method()} ${u.protocol}//${u.host}${u.pathname}`);
                return route.abort("blockedbyclient");
              }
              // Where it may go is the gate's decision, for every connection.
              return route.continue();
            });
            const page = await context.newPage();
            const scopeOf = viewer
              ? async () => (await page.waitForSelector("#frame", { timeout: 3000 })).contentFrame()
              : async () => page.mainFrame();
            const list = [];
            for (const run of ["first", "replay"]) {
              const label = `${vp.name}-${mode}-${run}`;
              let o;
              const evidence = [];
              try {
                const waitUntil = item.trigger.type === "load" ? "commit" : "load";
                if (run === "first") await page.goto(url, { waitUntil });
                else if (viewer)
                  await page.locator("#replay").click(); // the viewer's own Replay: a fresh frame
                else {
                  // A fresh navigation, not a reload: a reload restores the scroll position and other page state.
                  await page.goto("about:blank");
                  await page.goto(url, { waitUntil });
                }
                let settled = true;
                if (item.trigger.type !== "load") {
                  await page.waitForLoadState("load");
                  settled = await settle(scopeOf, item.target, watchedProps(item));
                }
                const at = new URL(page.url());
                if (!["file:", "about:"].includes(at.protocol) && !allowed.has(originKey(at.href)))
                  throw new Error(`the preview went to ${at.protocol}//${at.host}, which isn't the local preview`);
                o = await observeOnce(page, scopeOf, item, { out, evidence }, label);
                if (!settled && o.executed) o.unsettled = true;
              } catch (err) {
                o = { executed: false, error: String(err.message ?? err).split("\n")[0], evidence };
              }
              o.evidence ??= [];
              list.push(o);
              observations.push({
                viewport: vp.name,
                mode,
                run,
                ...o,
                properties: o.properties ?? [],
                declared: o.declared ?? [],
                end: o.end ?? {},
              });
            }
            runs[vp.name][mode] = list;
            const vid = page.video();
            await context.close();
            if (vid) {
              const file = `${item.id}-${vp.name}-${mode}.webm`;
              fs.renameSync(await vid.path(), path.join(out, file));
              observations
                .filter((o) => o.viewport === vp.name && o.mode === mode)
                .at(-1)
                .evidence.push({
                  file,
                  what: "video of both runs",
                  sha256: sha256(fs.readFileSync(path.join(out, file))),
                });
            }
          }
        }
      }
      const judged = judgeItem(item, runs, plan.viewports);
      results.push({
        id: item.id,
        name: item.name,
        tag: item.tag,
        trigger: item.trigger,
        target: item.target ?? null,
        intent: item.intent ?? null,
        reference: item.reference ?? null,
        result: judged.result,
        checks: judged.checks,
        observations,
      });
    }
  } finally {
    await browser.close();
    await gate.close();
  }

  const briefItems = briefText != null ? parseBriefMotion(briefText) : null;
  const trace = traceItems(plan.items, briefItems);
  for (const m of trace.tagMismatch) {
    const r = results.find((x) => x.id === m.id);
    r.tag = m.brief; // the approved brief decides what is essential
  }
  const limitations = [
    "Reduced motion was browser emulation in Chromium (Playwright). The OS setting and real devices weren't checked: they are verified only when the user checks them.",
    "Only Chromium ran; other browsers weren't checked.",
    "Timing is what the running animation declares; on-screen timing and smoothness weren't measured. Screenshots are taken around the named moments, not at exact times.",
    "The phone viewport is a narrow window, not touch emulation: hover results there are desktop hover.",
    "Cleanup after leaving the view (listeners, observers, timelines) isn't checked by this script.",
  ];
  if (viewer)
    limitations.push(
      "The preview ran in the viewer's sandboxed frame; layout shift and long frames aren't measured inside a frame that runs no script.",
    );
  if (blockedWrites.size)
    limitations.push(
      `Requests that could change data were blocked, so what they would have done wasn't observed: ${[...blockedWrites].join(", ")}.`,
    );
  limitations.push(
    `WebSockets to an allowed origin (a dev server's reload channel) are allowed and their messages aren't inspected. Requests to an allowed origin, GET included, reach that server as a user's browser would. WebRTC was turned off (Chromium switches for no UDP outside the gate, and an init script removing the WebRTC constructors), so a preview that needs it wasn't observed as it would run; how well that holds depends on the Chromium binary (${build}), and it was measured on a few builds only, not proven for this one. The browser was set to resolve no host name itself (the gate itself resolves names only with --allow-remote); that it made no DNS lookup at all, prefetching included, wasn't measured.`,
  );
  if (blocked.size)
    limitations.push(
      `Requests to other hosts were blocked, so the page may have rendered without them: ${[...blocked].join(", ")}.`,
    );
  const report = {
    runId,
    tool: { name: "motion-qa.mjs", version: VERSION },
    project: plan.project ?? null,
    implementation,
    brief: {
      label:
        [plan.brief?.session && `session ${plan.brief.session}`, plan.brief?.brief, plan.brief?.approval]
          .filter(Boolean)
          .join(", ") || "(not named in the plan)",
      file: briefFile,
      sha256: briefText != null ? sha256(briefText) : null,
    },
    target: { label: targetLabel, url, digest: targetHash },
    environment: {
      browser: `Chromium ${browserVersion}, ${build}`,
      browserBuild: build,
      playwright: version,
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      node: `Node ${process.version}`,
      reducedMotion: "browser emulation (Playwright reducedMotion: reduce / no-preference), Chromium only",
    },
    viewports: plan.viewports,
    plan: { sha256: sha256(JSON.stringify(rawPlan)) },
    startedAt,
    finishedAt: new Date().toISOString(),
    trace,
    items: results,
    specialists: plan.specialists ?? [],
    limitations,
    blocked: [...blocked],
    network: {
      allowedOrigins: [...allowed],
      remote: allowRemote
        ? "public hosts allowed (--allow-remote); this machine and private networks still refused"
        : "blocked: only the allowed origins, through the gate",
      writes: allowWrites ? "allowed (--allow-writes)" : "blocked: only GET, HEAD and OPTIONS requests leave the page",
      blockedWrites: [...blockedWrites],
    },
  };
  report.overall = aggregate(results, trace);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, "report.md"), renderMarkdown(report));
  return report;
}

/**
 * Re-checks a report's evidence: every file it lists exists in the report's folder with the same sha256, and nothing
 * else in the folder claims to be evidence. It proves the files are the ones this report was written with, not that
 * the report itself is genuine: report.json has no signature.
 */
export function verifyEvidence(reportFile) {
  const dir = path.dirname(path.resolve(reportFile));
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const problems = [];
  const listed = new Set();
  for (const item of report.items ?? [])
    for (const o of item.observations ?? [])
      for (const e of o.evidence ?? []) {
        listed.add(e.file);
        const file = path.join(dir, e.file);
        if (path.relative(dir, file).startsWith("..")) problems.push(`${e.file}: outside the report's folder`);
        else if (!fs.existsSync(file)) problems.push(`${e.file}: missing`);
        else if (sha256(fs.readFileSync(file)) !== e.sha256) problems.push(`${e.file}: changed since the run`);
      }
  const strays = fs.readdirSync(dir).filter((f) => /\.(png|webm)$/i.test(f) && !listed.has(f));
  for (const f of strays) problems.push(`${f}: in the folder but not in this report (another run?)`);
  return { runId: report.runId ?? null, files: listed.size, problems };
}

// ---- self-test -------------------------------------------------------------------------------------------------

const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>motion-qa fixture</title><style>
body{margin:0;font:16px system-ui;background:#fff;color:#111}
#hero{margin:24px;animation:rise .4s ease-out both}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.card{width:200px;height:100px;margin:24px;background:#ddd;transition:transform .2s ease-out}
.card:hover{transform:translateY(-4px)}
#broken{margin:24px;animation:fade .3s ease-out both}
@keyframes fade{from{opacity:0}to{opacity:1}}
#reveal{margin:24px;opacity:0;transform:translateY(24px);transition:opacity .3s ease-out,transform .3s ease-out}
#reveal.in{opacity:1;transform:none}
#veil-wrap{position:relative;margin:24px;width:200px}
#covered{width:200px;height:40px;transition:transform .2s ease-out}
#covered:hover{transform:translateY(-2px)}
#veil{position:absolute;inset:0}
#paused{margin:24px;animation:rise .4s ease-out both;animation-play-state:paused}
#early{margin:24px;animation:rise .5s ease-out both}
#ghost{margin:24px;animation:fade .3s ease-out both}
@media (prefers-reduced-motion: reduce){
  #hero{animation:none}
  .card{transition:none}
  #broken{animation:none;opacity:0}
  #reveal{transition:none}
  #ghost{animation:none;opacity:0}
}
</style></head><body>
<h1 id="hero">Hero</h1>
<div class="card" id="card">Card</div>
<p id="broken">Visible only with full motion (the defect)</p>
<p id="early">Already in view: its entrance plays at load, not on scroll</p>
<p id="ghost">Hidden with reduced motion, and the plan names no final state</p>
<div id="veil-wrap"><button id="covered">Covered</button><div id="veil"></div></div>
<p id="paused">Declared but paused: never runs</p>
<button id="open">Open</button><div id="panel" hidden>Panel</div>
<div style="height:1400px"></div>
<section id="reveal">Revealed on scroll</section>
<div style="height:900px"></div>
<script>
document.getElementById("open").addEventListener("click", () => (document.getElementById("panel").hidden = false));
new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.2 })
  .observe(document.getElementById("reveal"));
</script></body></html>`;

const FIXTURE_BRIEF = `**Motion:** standard (set by you): fixture.

| Item | Trigger → behaviour | Timing / easing | Reduced motion | Tag |
| --- | --- | --- | --- | --- |
| M1 · Hero entrance | load → fades up 12px | 400 ms ease-out | shown at once | essential |
| M2 · Card lift | hover → lifts 4px | 200 ms ease-out | no movement | detail |
| M3 · Note entrance | load → fades in | 300 ms ease-out | shown at once | essential |
| M4 · Panel open | click → slides in | 200 ms | shown at once | essential |
| M5 · Footer wave | load → waves | – | static | detail |
| M6 · Cursor trail | pointer → trail | – | none | detail |
| M7 · Section reveal | scroll → fades up | 300 ms ease-out | shown at once | essential |
| M8 · Logo spin | load → spins once | 600 ms | static | essential |
| M9 · Covered button | hover → lifts 2px | 200 ms | none | detail |
| M10 · Paused entrance | load → fades up | 400 ms | shown at once | detail |
| M11 · Early reveal | scroll → fades up | 500 ms | shown at once | detail |
| M12 · Ghost note | load → fades in | 300 ms | shown at once | detail |
`;

const fixturePlan = (file) => ({
  project: "motion-qa self-test",
  version: "fixture",
  brief: { brief: "fixture brief" },
  target: { file },
  items: [
    {
      id: "M1",
      name: "Hero entrance",
      tag: "essential",
      trigger: "load",
      target: "#hero",
      expect: {
        animates: true,
        properties: ["opacity", "transform"],
        end: { opacity: "1", transform: "none" },
        durationMs: 400,
        easing: "ease-out",
      },
      reduced: { animates: false },
    },
    {
      id: "M2",
      name: "Card lift",
      tag: "detail",
      trigger: "hover",
      target: "#card",
      expect: {
        animates: true,
        properties: ["transform"],
        end: { transform: "matrix(1, 0, 0, 1, 0, -4)" },
        durationMs: 200,
        easing: "ease-out",
      },
      reduced: { animates: false, notProperties: ["transform"] },
    },
    {
      id: "M3",
      name: "Note entrance",
      tag: "essential",
      trigger: "load",
      target: "#broken",
      expect: { animates: true, properties: ["opacity"], end: { opacity: "1" } },
      reduced: { animates: false },
    },
    {
      id: "M4",
      name: "Panel open",
      tag: "essential",
      trigger: { type: "click", on: "#open" },
      target: "#panel",
      expect: { animates: true, properties: ["transform"] },
      reduced: { animates: false },
    },
    { id: "M5", name: "Footer wave", tag: "detail", trigger: "load", target: "#nope", expect: { animates: true } },
    { id: "M6", name: "Cursor trail", tag: "detail", trigger: { type: "other", note: "follows the pointer" } },
    {
      id: "M7",
      name: "Section reveal",
      tag: "essential",
      trigger: { type: "scroll", to: "#reveal" },
      target: "#reveal",
      expect: { animates: true, properties: ["opacity", "transform"], end: { opacity: "1", transform: "none" } },
      reduced: { animates: false },
    },
    // Each of these must not pass: covered from the pointer, declared but never running, playing at load instead of on
    // scroll, and hidden with reduced motion when the plan names no final state.
    {
      id: "M9",
      name: "Covered button",
      tag: "detail",
      trigger: "hover",
      target: "#covered",
      expect: { animates: true, properties: ["transform"] },
      reduced: { animates: false },
    },
    {
      id: "M10",
      name: "Paused entrance",
      tag: "detail",
      trigger: "load",
      target: "#paused",
      expect: { animates: true, properties: ["opacity"] },
      reduced: { animates: false },
    },
    {
      id: "M11",
      name: "Early reveal",
      tag: "detail",
      trigger: { type: "scroll", to: "#early" },
      target: "#early",
      expect: { animates: true, properties: ["opacity", "transform"] },
      reduced: { animates: false },
    },
    {
      id: "M12",
      name: "Ghost note",
      tag: "detail",
      trigger: "load",
      target: "#ghost",
      expect: { animates: true, properties: ["opacity"] },
      reduced: { animates: false },
    },
  ],
});

/** Runs the script on a fixture page whose results are known; returns what differed. */
export async function selfTest({ out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-self-")), viewports } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, "fixture.html");
  fs.writeFileSync(file, FIXTURE);
  const plan = { ...fixturePlan(file), ...(viewports ? { viewports } : {}) };
  const report = await runPlan(plan, { out: path.join(out, "run"), briefText: FIXTURE_BRIEF, briefFile: "fixture" });
  const want = {
    M1: "Pass",
    M2: "Pass",
    M3: "Fail",
    M4: "Fail",
    M5: "Not Verified",
    M6: "Not Verified",
    M7: "Pass",
    M9: "Not Verified",
    M10: "Fail",
    M11: "Fail",
    M12: "Fail",
  };
  const lines = [];
  const problems = [];
  for (const [id, expected] of Object.entries(want)) {
    const got = report.items.find((i) => i.id === id)?.result;
    lines.push(`${got === expected ? "PASS" : "FAIL"} ${id} ${got} (expected ${expected})`);
    if (got !== expected) problems.push(id);
  }
  const m3 = report.items.find((i) => i.id === "M3");
  const caught = m3.checks.some((c) => c.mode === "reduced" && c.check === "final state" && c.status === "fail");
  lines.push(`${caught ? "PASS" : "FAIL"} M3 is caught by its reduced-motion final state (content hidden)`);
  if (!caught) problems.push("M3 reduced");
  const why = (id, check, status, mode = "full") =>
    report.items
      .find((i) => i.id === id)
      .checks.some((c) => c.check === check && c.status === status && c.mode === mode);
  for (const [ok, text] of [
    [why("M9", "trigger", "not verified"), "M9 isn't hovered through the element covering it"],
    [why("M10", "moves", "fail"), "M10, declared but paused, doesn't count as motion"],
    [why("M11", "moves", "fail"), "M11's entrance at load doesn't pass for its scroll trigger"],
    [
      why("M12", "visibility", "fail", "reduced"),
      "M12 hidden with reduced motion is caught with no final state briefed",
    ],
  ]) {
    lines.push(`${ok ? "PASS" : "FAIL"} ${text}`);
    if (!ok) problems.push(text);
  }
  const traced = report.trace.missing.map((m) => m.id).join(",") === "M8";
  lines.push(`${traced ? "PASS" : "FAIL"} brief item M8 with no check is reported`);
  if (!traced) problems.push("trace");
  const overall = report.overall.status === "Fail";
  lines.push(`${overall ? "PASS" : "FAIL"} overall ${report.overall.status} (expected Fail)`);
  if (!overall) problems.push("overall");
  const files = report.items.flatMap((i) => i.observations.flatMap((o) => o.evidence));
  const verified = verifyEvidence(path.join(out, "run", "report.json"));
  const intact = files.length > 0 && !verified.problems.length;
  lines.push(`${intact ? "PASS" : "FAIL"} ${files.length} evidence files exist and match their sha256 (--verify)`);
  if (!intact) problems.push("evidence");
  return { ok: !problems.length, problems, lines, report, out };
}

// ---- CLI -------------------------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  try {
    if (args.includes("--verify")) {
      const r = verifyEvidence(opt("--verify"));
      for (const p of r.problems) console.log(`FAIL ${p}`);
      console.log(
        `${r.problems.length ? "Evidence doesn't match" : "Evidence matches"} report ${r.runId ?? "(no run id)"}: ${r.files} file(s), ${r.problems.length} problem(s)`,
      );
      process.exit(r.problems.length ? 1 : 0);
    }
    if (args.includes("--self-test")) {
      const r = await selfTest(opt("--out") ? { out: path.resolve(opt("--out")) } : {});
      for (const l of r.lines) console.log(l);
      console.log(`Self-test ${r.ok ? "passed" : "FAILED"}; evidence in ${r.out}`);
      process.exit(r.ok ? 0 : 1);
    }
    const planFile = args.find(
      (a, i) => !a.startsWith("--") && !/^--(out|brief|verify|allow-origin)$/.test(args[i - 1] ?? ""),
    );
    if (!planFile || !opt("--out")) {
      console.error(
        "Usage: node motion-qa.mjs <plan.json> --out <new scratch folder> [--brief <brief.md>] [--video] [--allow-origin <origin>]… [--allow-remote] [--allow-writes]\n       node motion-qa.mjs --verify <report.json>\n       node motion-qa.mjs --self-test [--out <folder>]",
      );
      process.exit(3);
    }
    const briefFile = opt("--brief") ? path.resolve(opt("--brief")) : null;
    const report = await runPlan(JSON.parse(fs.readFileSync(planFile, "utf8")), {
      out: path.resolve(opt("--out")),
      briefText: briefFile ? fs.readFileSync(briefFile, "utf8") : null,
      briefFile,
      video: args.includes("--video"),
      allowRemote: args.includes("--allow-remote"),
      allowWrites: args.includes("--allow-writes"),
      allowOrigins: args.flatMap((a, i) => (a === "--allow-origin" ? [args[i + 1]] : [])),
    });
    for (const i of report.items) console.log(`${i.id} ${i.result.padEnd(12)} ${i.tag.padEnd(9)} ${i.name}`);
    for (const m of report.trace.missing)
      console.log(`${m.id} ${"Not Verified".padEnd(12)} ${(m.tag ?? "?").padEnd(9)} ${m.name} (no check)`);
    console.log(
      `Overall: ${report.overall.status}${report.overall.reasons.length ? ` — ${report.overall.reasons.join("; ")}` : ""}`,
    );
    console.log(`Report: ${path.join(path.resolve(opt("--out")), "report.md")}`);
    process.exit({ Pass: 0, Fail: 1, "Not Verified": 2 }[report.overall.status]);
  } catch (err) {
    console.error(`motion-qa couldn't run: ${err.message}`);
    process.exit(3);
  }
}
