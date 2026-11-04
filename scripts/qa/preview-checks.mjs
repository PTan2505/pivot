#!/usr/bin/env node
// Browser checks for mockup previews, with PIVOT's own Playwright and Chromium (pnpm setup:browser).
//
//   node scripts/qa/preview-checks.mjs viewer          hostile mockups in the local viewer (make-viewer.mjs) must be
//                                                     contained: no network, no file access, no navigating the page,
//                                                     no popups or storage; static versions run no script; CSS motion
//                                                     plays in both kinds
//   node scripts/qa/preview-checks.mjs pivot <url>    on a running scratch PIVOT (it writes one session): mockup
//                                                     motion, Replay, reduced motion, and the API boundary against a
//                                                     hostile page, a mockup, the app, the extension and the MCP server
//   node scripts/qa/preview-checks.mjs boundary <url> <data folder>
//                                                     on a fresh scratch PIVOT with no token yet: missing, invalid and
//                                                     forged credentials, path tricks and bypass headers
//
// Prints one line per check and exits 1 if any fails. Dev-only; nothing here ships.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(repo, "packages/core/package.json"))("playwright");
const { buildViewer } = await import(
  pathToFileURL(path.join(repo, ".claude/skills/pivot-design/viewer/make-viewer.mjs")).href
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** CSS that moves a box forever, so a running animation can be detected. */
const MOVING = `<style>@keyframes slide{from{transform:translateX(0)}to{transform:translateX(200px)}}
#box{width:40px;height:40px;background:#f60;animation:slide 1s linear infinite}
@media (prefers-reduced-motion: reduce){#box{animation:none}}</style><div id="box"></div>`;
const REDUCE = "(prefers-reduced-motion: reduce)";
/** How many animations run in a frame, and how far the first one is (ms). */
const animState = (frame) =>
  frame.locator("body").evaluate(() => {
    const all = document.getAnimations();
    return { count: all.length, t: Number(all[0]?.currentTime ?? 0) };
  });
/** A GET with exactly these headers (raw HTTP: fetch would rewrite Sec-Fetch-Mode). */
const rawGet = (base, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const u = new URL(base + path);
    http
      .get(
        { host: u.hostname, port: u.port, path: path.startsWith("/") ? path : u.pathname + u.search, headers },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      )
      .on("error", reject);
  });
const rawBody = async (base, path) => (await rawGet(base, path)).body;

/** Calls one tool on the built MCP server (apps/mcp/dist) pointed at `base`, with or without a token. */
async function mcpCall(base, token, name, args) {
  const req = createRequire(path.join(repo, "apps/mcp/package.json"));
  const { Client } = await import(pathToFileURL(req.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StdioClientTransport } = await import(
    pathToFileURL(req.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href
  );
  const emptyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-mcp-"));
  const env = { ...process.env, PIVOT_URL: base, PIVOT_DATA_DIR: emptyDataDir };
  delete env.PIVOT_TOKEN;
  if (token) env.PIVOT_TOKEN = token;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repo, "apps/mcp/dist/server.js")],
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "preview-checks", version: "1" });
  try {
    await client.connect(transport);
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: (r.content ?? []).map((c) => c.text ?? "").join(" ") };
  } catch (err) {
    return { ok: false, text: String(err?.message ?? err) };
  } finally {
    await client.close().catch(() => {});
    fs.rmSync(emptyDataDir, { recursive: true, force: true });
  }
}

/** True when #box in this frame locator moves over 300 ms. */
const moves = async (box) => {
  const a = await box.evaluate((el) => getComputedStyle(el).transform);
  await pause(300);
  return a !== (await box.evaluate((el) => getComputedStyle(el).transform));
};

async function viewer() {
  // A local server that only counts what reaches it: any hit is a leak.
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.end("ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const beacon = `http://127.0.0.1:${server.address().port}`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-viewer-"));
  const secret = path.join(os.tmpdir(), `pivot-viewer-secret-${process.pid}.txt`);
  fs.writeFileSync(secret, "SECRET-OUTSIDE-FOLDER");
  fs.writeFileSync(path.join(dir, "local.css"), "#box{border:2px solid #000}");
  fs.writeFileSync(
    path.join(dir, "mockup-1-static.html"),
    `<!doctype html><html><head><title>Static</title><link rel="stylesheet" href="local.css">
<link rel="stylesheet" href="${beacon}/remote.css"><link rel="stylesheet" href="${secret}">
<meta http-equiv="refresh" content="0;url=${beacon}/refresh"></head><body>${MOVING}
<img src="${beacon}/img.png"><a id="out" href="${beacon}/link">out</a>
<button id="b" onclick="document.body.dataset.ran='yes'">b</button>
<script>document.body.dataset.ran='yes';fetch('${beacon}/static-script')</script></body></html>`,
  );
  fs.writeFileSync(
    path.join(dir, "mockup-2-interactive.html"),
    `<!doctype html><html><head><title>Interactive</title></head><body>${MOVING}
<script>document.body.dataset.ran='yes'</script></body></html>`,
  );
  const { page, versions } = buildViewer(dir, { title: "Probe", interactive: [2] });
  const index = path.join(dir, "index.html");
  fs.writeFileSync(index, page);

  check(
    "inliner kept the local stylesheet",
    versions[0].removed.every((r) => !r.startsWith("local.css")),
  );
  check(
    "inliner removed remote, outside-folder, refresh and script references",
    ["remote.css", "outside the mockup folder", "<meta http-equiv>", "inline script", "img.png", "href removed"].every(
      (s) => versions[0].removed.some((r) => r.includes(s)),
    ),
    versions[0].removed.join("; "),
  );

  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage();
    const opened = [];
    tab.context().on("page", (p) => opened.push(p.url()));
    await tab.goto(pathToFileURL(index).href + "#1");
    await pause(800);
    const frameOf = () => tab.frames().find((f) => f !== tab.mainFrame());

    // Static version: no script ran, inline handlers do nothing, CSS motion plays.
    let f = frameOf();
    check(
      "static version: inline script didn't run",
      (await tab.locator("#frame").count()) === 1 && !hits.some((h) => h.includes("static-script")),
    );
    await tab.frameLocator("#frame").locator("#b").click();
    const ranAttr = await tab.frameLocator("#frame").locator("body").getAttribute("data-ran");
    check("static version: inline handler didn't run", ranAttr === null);
    const x1 = await tab
      .frameLocator("#frame")
      .locator("#box")
      .evaluate((el) => getComputedStyle(el).transform);
    await pause(300);
    const x2 = await tab
      .frameLocator("#frame")
      .locator("#box")
      .evaluate((el) => getComputedStyle(el).transform);
    check("static version: CSS animation plays", x1 !== x2, `${x1} → ${x2}`);
    const border = await tab
      .frameLocator("#frame")
      .locator("#box")
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    check("static version: local stylesheet applied", border === "2px");

    // Interactive version: its script runs, everything else stays contained.
    await tab.locator("#tab-2").click();
    await pause(800);
    f = frameOf();
    check(
      "interactive version is showing",
      (await tab.locator("#kind").textContent()) === "Interactive" &&
        (await tab.locator("#frame").getAttribute("sandbox")) === "allow-scripts",
    );
    const box = tab.frameLocator("#frame").locator("body");
    check("interactive version: its inline script ran", (await box.getAttribute("data-ran")) === "yes");
    const probe = (fn) =>
      f.evaluate(fn, { beacon, file: pathToFileURL(secret).href }).catch((e) => `threw: ${e.message}`);
    const fetched = await probe(async ({ beacon }) => {
      try {
        await fetch(beacon + "/fetch");
        return "fetched";
      } catch (e) {
        return "blocked";
      }
    });
    check("interactive: fetch to the network blocked", fetched === "blocked");
    const fileRead = await probe(async ({ file }) => {
      try {
        const r = await fetch(file);
        return (await r.text()).includes("SECRET") ? "read" : "empty";
      } catch {
        return "blocked";
      }
    });
    check("interactive: reading another local file blocked", fileRead !== "read", fileRead);
    await probe(({ beacon }) => {
      const i = new Image();
      i.src = beacon + "/runtime-img";
      document.body.append(i);
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = beacon + "/runtime.css";
      document.head.append(l);
      try {
        new WebSocket(beacon.replace("http", "ws") + "/ws");
      } catch {}
      try {
        navigator.sendBeacon(beacon + "/sendbeacon", "x");
      } catch {}
    });
    const popup = await probe(({ beacon }) => {
      try {
        return window.open(beacon + "/popup") ? "opened" : "blocked";
      } catch {
        return "blocked";
      }
    });
    check("interactive: popup blocked", popup === "blocked" && opened.length === 0);
    const topNav = await probe(({ beacon }) => {
      try {
        top.location.href = beacon + "/top";
        return "tried";
      } catch {
        return "blocked";
      }
    });
    await pause(300);
    check(
      "interactive: can't navigate the viewer page",
      tab.url().startsWith("file:"),
      `${topNav}; page ${tab.url().slice(0, 7)}`,
    );
    const parentRead = await probe(() => {
      try {
        return parent.document.title;
      } catch {
        return "blocked";
      }
    });
    check("interactive: can't read the viewer page", parentRead === "blocked");
    const storage = await probe(() => {
      try {
        localStorage.setItem("x", "1");
        return "stored";
      } catch {
        return "blocked";
      }
    });
    check("interactive: no storage", storage === "blocked");
    const form = await probe(({ beacon }) => {
      const fm = document.createElement("form");
      fm.action = beacon + "/form";
      fm.method = "post";
      document.body.append(fm);
      try {
        fm.submit();
        return "submitted";
      } catch {
        return "blocked";
      }
    });
    await pause(500);
    // A frame nested inside the version, and plugin elements, inherit the same limits.
    await probe(({ beacon }) => {
      const nested = document.createElement("iframe");
      nested.srcdoc = `<script>fetch("${beacon}/nested-fetch").catch(()=>{});new Image().src="${beacon}/nested-img"</script><img src="${beacon}/nested-tag">`;
      document.body.append(nested);
      const ext = document.createElement("iframe");
      ext.src = beacon + "/nested-src";
      document.body.append(ext);
      const obj = document.createElement("object");
      obj.data = beacon + "/object";
      document.body.append(obj);
      const emb = document.createElement("embed");
      emb.src = beacon + "/embed";
      document.body.append(emb);
    });
    await pause(800);
    const leaked = hits.filter((h) => !h.startsWith("/self-nav"));
    check("no request from any version reached the network", leaked.length === 0, leaked.join(", ") || `form: ${form}`);

    // Self-navigation can't be prevented by policy; the viewer must stop the version.
    await probe(({ beacon }) => {
      location.href = beacon + "/self-nav";
    });
    await pause(800);
    const stopped = (await tab.locator("#frame").count()) === 0;
    check("a version that navigates itself is stopped", stopped);
    console.log(
      `note: self-navigation request ${hits.includes("/self-nav") ? "reached" : "did not reach"} the server (residual, see motion.md)`,
    );

    // Replay brings it back with a fresh frame.
    await tab.getByRole("button", { name: "Replay" }).click();
    await pause(500);
    check("Replay restores the version", (await tab.locator("#frame").count()) === 1);

    // Replay: one fresh frame, one animation, restarted; nothing left over from the previous run.
    await tab.locator("#tab-1").click();
    await pause(1500);
    const before = await animState(tab.frameLocator("#frame"));
    for (let i = 0; i < 3; i++) await tab.getByRole("button", { name: "Replay" }).click();
    await pause(150);
    const after = await animState(tab.frameLocator("#frame"));
    check(
      "viewer Replay: one frame, one animation, restarted from the start",
      (await tab.locator("iframe").count()) === 1 && after.count === 1 && after.t < before.t,
      `frames ${await tab.locator("iframe").count()}, animations ${after.count}, time ${Math.round(before.t)} → ${Math.round(after.t)} ms`,
    );

    // Reduced motion, through the browser's own emulation (what DevTools and Playwright use), not the OS setting.
    // Both states, static and interactive, live (without Replay) and after Replay.
    const frame = () => tab.frameLocator("#frame");
    const reports = async () =>
      (await tab.locator("#motion").textContent()).startsWith("Your browser reports reduced motion");
    for (const state of ["no-preference", "reduce", "no-preference"]) {
      await tab.emulateMedia({ reducedMotion: state });
      await pause(200);
      const reduce = state === "reduce";
      await tab.locator("#tab-1").click();
      await pause(400);
      check(
        `viewer, ${state}: static version ${reduce ? "stops" : "plays"} its animation`,
        (await moves(frame().locator("#box"))) === !reduce,
      );
      check(`viewer, ${state}: the indicator reports it`, (await reports()) === reduce);
      await tab.getByRole("button", { name: "Replay" }).click();
      await pause(400);
      check(
        `viewer, ${state}: still ${reduce ? "stopped" : "playing"} after Replay`,
        (await moves(frame().locator("#box"))) === !reduce,
      );
      await tab.locator("#tab-2").click();
      await pause(400);
      check(
        `viewer, ${state}: the interactive version's matchMedia reports it`,
        (await frame()
          .locator("body")
          .evaluate((_, q) => matchMedia(q).matches, REDUCE)) === reduce,
      );
    }
    // A change while a version is showing reaches it at once.
    await tab.emulateMedia({ reducedMotion: "reduce" });
    await pause(200);
    const live = await frame()
      .locator("body")
      .evaluate((_, q) => matchMedia(q).matches, REDUCE);
    await tab.emulateMedia({ reducedMotion: "no-preference" });
    await pause(200);
    const back = await frame()
      .locator("body")
      .evaluate((_, q) => matchMedia(q).matches, REDUCE);
    check("viewer: a live change reaches the showing version both ways", live === true && back === false);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(secret, { force: true });
  }
}

async function pivot(base) {
  const post = (p, body, headers = { origin: base }) =>
    fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const { sessionId } = await (
    await post("/api/design/briefs", {
      title: "Preview checks",
      targetProject: "preview-checks",
      surface: "Box",
      milestone: "initial",
      markdown: "## Brief: Box\n\n**Goal:** check previews and the API boundary.",
    })
  ).json();

  // A counting server, also playing a hostile site on another port (same host, so "same-site" to PIVOT).
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("content-type", "text/html");
    res.end(req.url === "/attack" ? attackPage : "ok");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const beacon = `http://127.0.0.1:${server.address().port}`;

  // Browser pages reach PIVOT through a recording proxy, so each request's real status is known even when the browser
  // hides it (ORB, no-cors). Headers pass through unchanged; the Host is the proxy's, still a local host.
  const served = [];
  const target = new URL(base);
  const relay = http.createServer((req, res) => {
    // Uncompressed answers, so the relay can read them; nothing the access rules look at changes.
    const { "accept-encoding": _, ...headers } = req.headers;
    const out = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (answer) => {
        // Keep the start of each body: a refusal written by the proxy (the route never ran) reads differently from
        // whatever the route answers itself.
        const chunks = [];
        answer.on("data", (c) => chunks.length < 4 && chunks.push(c));
        answer.on("end", () =>
          served.push([
            new URL(req.url, base).pathname,
            answer.statusCode,
            Buffer.concat(chunks).toString().slice(0, 200),
          ]),
        );
        res.writeHead(answer.statusCode, answer.headers);
        answer.pipe(res);
      },
    );
    out.on("error", () => res.destroy());
    req.pipe(out);
  });
  await new Promise((r) => relay.listen(0, "127.0.0.1", r));
  const seen = `http://127.0.0.1:${relay.address().port}`;
  const statusesOf = (path) =>
    served.filter(([p]) => p === path || (path instanceof RegExp && path.test(p))).map(([, s]) => s);
  const PROXY_REFUSAL = "Only PIVOT's own pages can do this";
  /** Each request to `path` the relay saw: "proxy" when the proxy refused it before the route ran, else the status. */
  const handledBy = (path) =>
    served
      .filter(([p]) => p === path)
      .map(([, st, body]) => (st === 403 && body.includes(PROXY_REFUSAL) ? "proxy" : st));
  const SIDE = ["/api/favicon", "/api/metadata", "/api/search/external", "/api/visibility"];

  const mockupHtml = `<!doctype html><html><head><title>Moving box</title></head><body>${MOVING}
<img src="${beacon}/mockup-img"><a id="token" href="${seen}/api/settings/token">token</a>
<a id="popup" href="${beacon}/popup" target="_blank">popup</a><img src="/api/settings/token">
<img src="/api/favicon?host=example.com"><img src="/api/metadata?url=https%3A%2F%2Fexample.com%2F">
<img src="/api/search/external?q=button"><img src="/api/visibility?url=https%3A%2F%2Fexample.com%2F"></body></html>`;
  const saved = await (
    await post(`/api/design/sessions/${sessionId}/mockups`, { mockups: [{ title: "Moving box", html: mockupHtml }] })
  ).json();
  const mockupId = saved.ids?.[0];
  const approve = `${seen}/api/design/mockups/${mockupId}/approve`;
  const attackPage = `<!doctype html><body>
<iframe id="tok" src="${seen}/api/settings/token"></iframe>
<img src="${seen}/api/settings/token">
<form id="f" method="post" action="${approve}"><input name="note" value="x"></form>
<img src="${seen}/api/favicon?host=example.com">
<img src="${seen}/api/metadata?url=https%3A%2F%2Fexample.com%2F">
<script>
  fetch("${seen}/api/settings/token", { mode: "no-cors" }).catch(() => {});
  fetch("${seen}/api/search/external?q=button", { mode: "no-cors" }).catch(() => {});
  fetch("${seen}/api/visibility?url=https%3A%2F%2Fexample.com%2F").catch(() => {});
  fetch("${approve}", { method: "POST", mode: "no-cors", body: "{}" }).catch(() => {});
  document.getElementById("f").submit();
</script></body>`;

  // 1. The API boundary, from a non-browser caller with forged headers.
  // Raw HTTP, so the headers go exactly as written (fetch rewrites Sec-Fetch-Mode, for example).
  const status = (p, init = {}) =>
    new Promise((resolve, reject) => {
      const u = new URL(base + p);
      http
        .get({ host: u.hostname, port: u.port, path: u.pathname, headers: init.headers ?? {} }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject);
    });
  check(
    "Origin: null on approve → 403 (not a server error)",
    (await post(`/api/design/mockups/${mockupId}/approve`, {}, { origin: "null" })).status === 403,
  );
  check(
    "an unreadable Origin on approve → 403",
    (await post(`/api/design/mockups/${mockupId}/approve`, {}, { origin: "%%%" })).status === 403,
  );
  check(
    "another origin on approve → 403",
    (await post(`/api/design/mockups/${mockupId}/approve`, {}, { origin: beacon })).status === 403,
  );
  check(
    "token: cross-site fetch → 403",
    (await status("/api/settings/token", {
      headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" },
    })) === 403,
  );
  check(
    "token: same-site navigation → 403",
    (await status("/api/settings/token", {
      headers: { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" },
    })) === 403,
  );
  check(
    "token: the app's own page → 200",
    (await status("/api/settings/token", {
      headers: { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" },
    })) === 200,
  );
  check("token: a non-browser caller (no Sec-Fetch headers) → 200", (await status("/api/settings/token")) === 200);
  check(
    "cross-site navigation to an API page → 403",
    (await status("/api/resources", { headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } })) ===
      403,
  );
  check(
    "cross-site navigation to the mockup itself still works",
    (await status(`/api/design/mockups/${mockupId}`, {
      headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" },
    })) === 200,
  );

  const browser = await chromium.launch();
  try {
    // 2. A hostile page on another port: it can't read or fetch the token, open it in a frame, or approve.
    const evil = await browser.newPage();
    await evil.goto(`${beacon}/attack`);
    await pause(3500);
    const tokenAnswers = statusesOf("/api/settings/token");
    check(
      "hostile page: the server refused every request for the token (iframe, img, fetch)",
      tokenAnswers.length >= 3 && tokenAnswers.every((s) => s === 403),
      tokenAnswers.join(", "),
    );
    const approveAnswers = statusesOf(/\/approve$/);
    check(
      "hostile page: the server refused every approve attempt (form, fetch)",
      approveAnswers.length >= 2 && approveAnswers.every((s) => s === 403),
      approveAnswers.join(", "),
    );
    const sessionState = await (await fetch(`${base}/api/design/sessions/${sessionId}`)).json();
    check(
      "hostile page: the session is still exploring, with no approval",
      sessionState.status === "exploring" && sessionState.decisions.length === 0,
    );
    for (const path of SIDE) {
      const how = handledBy(path);
      check(
        `hostile page: ${path} refused by the proxy, the route never ran`,
        how.length > 0 && how.every((h) => h === "proxy"),
        how.join(", "),
      );
    }
    await evil.close();

    // 3. The session page: motion plays, Replay restarts it cleanly, reduced motion follows the browser both ways.
    const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    served.length = 0;
    const popups = [];
    tab.context().on("page", (p) => popups.push(p));
    await tab.goto(`${seen}/design/${sessionId}`);
    const frame = tab.frameLocator('iframe[sandbox=""]');
    const box = frame.locator("#box");
    await box.waitFor({ timeout: 15000 });
    check("PIVOT: the mockup's CSS animation plays", await moves(box));
    // The mockup's <img src="/api/settings/token">: refused by the browser (policy) or by the server (403), never 200.
    const imgAnswers = statusesOf("/api/settings/token");
    check(
      "PIVOT: the mockup's image pointing at the token route was refused",
      imgAnswers.every((x) => x === 403),
      imgAnswers.length ? `server answered ${imgAnswers.join(", ")}` : "never sent",
    );
    check("PIVOT: the mockup's remote image never left (policy)", !hits.includes("/mockup-img"));
    for (const path of SIDE) {
      const how = handledBy(path);
      check(
        `PIVOT mockup: ${path} refused by the proxy, the route never ran`,
        how.length > 0 && how.every((h) => h === "proxy"),
        how.join(", "),
      );
    }

    // The app's own page still reaches them: the route itself answers (whatever it decides about the URL).
    served.length = 0;
    await tab.evaluate(async () => {
      await fetch("/api/metadata?url=" + encodeURIComponent("http://127.0.0.1:1/")).catch(() => {});
      await fetch("/api/visibility?url=" + encodeURIComponent("http://127.0.0.1:1/")).catch(() => {});
      await fetch("/api/search/external?q=button").catch(() => {});
      await fetch("/api/favicon?host=localhost").catch(() => {});
    });
    for (const path of SIDE) {
      const how = handledBy(path);
      check(`app page: ${path} reaches the route`, how.length > 0 && !how.includes("proxy"), how.join(", "));
    }

    await pause(1500);
    const before = await animState(frame);
    const replay = tab.getByRole("button", { name: "Replay" });
    for (let i = 0; i < 3; i++) await replay.click();
    await box.waitFor();
    await pause(150);
    const after = await animState(frame);
    check(
      "PIVOT Replay: one frame, one animation, restarted from the start",
      (await tab.locator('iframe[sandbox=""]').count()) === 1 && after.count === 1 && after.t < before.t,
      `frames ${await tab.locator('iframe[sandbox=""]').count()}, animations ${after.count}, time ${Math.round(before.t)} → ${Math.round(after.t)} ms`,
    );

    const indicator = tab.getByText("Motion follows your browser");
    for (const state of ["reduce", "no-preference", "reduce"]) {
      await tab.emulateMedia({ reducedMotion: state });
      await pause(300);
      const reduce = state === "reduce";
      check(`PIVOT, ${state}: the mockup ${reduce ? "stops" : "plays"} at once (live)`, (await moves(box)) === !reduce);
      check(
        `PIVOT, ${state}: the indicator says ${reduce ? "on" : "off"}`,
        (await indicator.textContent()).includes(`reduced motion ${reduce ? "on" : "off"}`),
      );
      await replay.click();
      await box.waitFor();
      await pause(300);
      check(`PIVOT, ${state}: same after Replay`, (await moves(box)) === !reduce);
    }
    await tab.emulateMedia({ reducedMotion: "no-preference" });

    // 4. Inside the mockup: a link to the token is refused, a popup link opens nothing.
    served.length = 0;
    await frame.locator("#popup").click();
    await pause(500);
    check("PIVOT: a target=_blank link in the mockup opens no popup", popups.length === 0 && !hits.includes("/popup"));
    await frame.locator("#token").click();
    await pause(1000);
    const tokenNav = statusesOf("/api/settings/token");
    check(
      "PIVOT: following a link to the token from the mockup gets 403",
      tokenNav.length > 0 && tokenNav.every((s) => s === 403),
      tokenNav.join(", "),
    );

    // 5. Legitimate non-page callers, with the real token of this scratch PIVOT (read as a non-browser caller).
    const token = JSON.parse(await rawBody(base, "/api/settings/token")).token;
    const routeRan = async (p, headers) => {
      const r = await rawGet(base, p, headers);
      return !(r.status === 403 && r.body.includes(PROXY_REFUSAL)) && r.status !== 403;
    };
    const auth = { authorization: `Bearer ${token}` };
    for (const variant of [
      { "sec-fetch-site": "none", "sec-fetch-mode": "cors", origin: "chrome-extension://abcdefghijklmnop" },
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin: "chrome-extension://abcdefghijklmnop" },
      {},
    ]) {
      const label = variant["sec-fetch-site"] ?? "no Fetch Metadata";
      check(
        `extension (token, ${label}): /api/visibility reaches the route`,
        await routeRan("/api/visibility?url=" + encodeURIComponent("http://127.0.0.1:1/"), { ...variant, ...auth }),
      );
    }
    check(
      "extension popup thumbnail (an <img>, no token): /api/assets still answered",
      await routeRan("/api/assets/00000000-0000-4000-8000-000000000000?thumb=1", {
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "no-cors",
        referer: "chrome-extension://abcdefghijklmnop/",
      }),
    );
    check(
      "a wrong token from another site is still refused",
      !(await routeRan("/api/favicon?host=example.com", {
        authorization: "Bearer wrong",
        "sec-fetch-site": "cross-site",
      })),
    );

    // The real MCP server (apps/mcp/dist) against this PIVOT: with the token, and without one (a non-browser caller).
    for (const withToken of [true, false]) {
      const result = await mcpCall(base, withToken ? token : null, "search_external", { query: "button" });
      check(
        `MCP search_external ${withToken ? "with" : "without"} the token reaches the route`,
        result.ok && !/unauthorized|refused|403/i.test(result.text),
        result.text.slice(0, 120).replace(/\s+/g, " "),
      );
    }
  } finally {
    await browser.close();
    server.close();
    relay.close();
  }
}

/**
 * The API's authentication boundary, against a scratch PIVOT whose data folder has no token yet: missing, invalid and
 * forged credentials, path tricks, middleware-bypass headers, forged Host and contradictory metadata. A request the
 * proxy refuses must not run its route, and checking a made-up token must not create one.
 */
async function boundary(base, dataDir) {
  const tokenFile = path.join(dataDir, "api-token");
  check("scratch PIVOT starts with no API token", !fs.existsSync(tokenFile));
  const META = "/api/metadata?url=" + encodeURIComponent("http://127.0.0.1:1/");
  const CROSS = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", referer: "https://evil.example/" };
  const PROXY = "Only PIVOT's own pages can do this";
  // The route ran when it answered 200 JSON itself; a proxy refusal, a 404 page or a redirect means it didn't.
  const ran = (r) => r.status === 200 && !r.body.includes(PROXY) && r.body.trim().startsWith("{");

  const badCredentials = [
    ["no Authorization", {}],
    ["Bearer made-up", { authorization: "Bearer made-up" }],
    ["empty Bearer", { authorization: "Bearer " }],
    ["Basic scheme", { authorization: "Basic " + Buffer.from("pivot:secret").toString("base64") }],
    ["token in another header", { "x-api-token": "made-up" }],
  ];
  for (const [label, auth] of badCredentials) {
    const r = await rawGet(base, META, { ...CROSS, ...auth });
    check(`before a token exists, cross-site + ${label}: refused, route didn't run`, r.status === 403 && !ran(r));
  }
  for (const [label, auth] of badCredentials) {
    const r = await rawGet(base, "/api/settings/token", { ...CROSS, ...auth });
    check(`before a token exists, token route + ${label}: refused`, r.status === 403 && !r.body.includes('"token"'));
  }
  check("refused requests and made-up tokens created no token file", !fs.existsSync(tokenFile));

  // A non-browser caller (no Fetch Metadata, Origin or Referer) is inside the trust boundary: it gets the token.
  const first = await rawGet(base, "/api/settings/token");
  const token = JSON.parse(first.body).token;
  check("a non-browser caller can read the token (intended: local trust boundary)", first.status === 200 && !!token);

  const nearMisses = [
    ["the token minus one character", `Bearer ${token.slice(0, -1)}`],
    ["the token plus one character", `Bearer ${token}x`],
    ["a same-length wrong token", `Bearer ${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`],
    ["the token twice", `Bearer ${token}${token}`],
    ["the token after another scheme", `Basic ${token}`],
  ];
  for (const [label, authorization] of nearMisses) {
    const r = await rawGet(base, META, { ...CROSS, authorization });
    check(`cross-site + ${label}: refused, route didn't run`, r.status === 403 && !ran(r));
  }
  check(
    "cross-site + the real token: the route runs (extension, MCP)",
    ran(await rawGet(base, META, { ...CROSS, authorization: `Bearer ${token}` })),
  );
  check(
    "cross-site + 'bearer' in lower case and the real token: the route runs",
    ran(await rawGet(base, META, { ...CROSS, authorization: `bearer ${token}` })),
  );

  // Path tricks: each must be refused, or not reach the route at all.
  const variants = [
    "/api/metadata/",
    "/api/%6detadata",
    "/api//metadata",
    "//api/metadata",
    "/api/./metadata",
    "/api/x/../metadata",
    "/api/metadata%2F",
    "/API/metadata",
    "/api/metadata;x",
    "/api/Metadata",
    "/api/metadata%00",
    "/%61pi/metadata",
  ];
  for (const v of variants) {
    const r = await rawGet(base, v + "?url=" + encodeURIComponent("http://127.0.0.1:1/"), CROSS);
    check(`path ${v}: route didn't run for a cross-site caller`, !ran(r), `${r.status}`);
    const t = await rawGet(
      base,
      v.replace(/metadata/i, (m) => (m === "metadata" ? "settings/token" : "Settings/token")),
      CROSS,
    );
    check(`path ${v} (token route): no token returned`, !t.body.includes(token), `${t.status}`);
  }

  // Headers that once let requests skip Next.js middleware, and forwarded-host tricks.
  for (const value of [
    "middleware",
    "src/middleware",
    "proxy",
    "src/proxy",
    "middleware:middleware:middleware:middleware:middleware",
    "src/proxy:src/proxy:src/proxy:src/proxy:src/proxy",
    "proxy:proxy:proxy:proxy:proxy",
  ]) {
    const r = await rawGet(base, META, { ...CROSS, "x-middleware-subrequest": value });
    check(`x-middleware-subrequest: ${value}: still refused`, r.status === 403 && !ran(r));
  }
  for (const [label, headers] of [
    ["X-Forwarded-Host: evil", { "x-forwarded-host": "evil.example" }],
    ["X-Forwarded-Host: the app", { "x-forwarded-host": new URL(base).host }],
    ["X-Forwarded-Proto/For", { "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" }],
  ]) {
    const r = await rawGet(base, META, { ...CROSS, ...headers });
    check(`${label}: still refused`, r.status === 403 && !ran(r));
  }
  check("Host: evil.example: refused", (await rawGet(base, META, { host: "evil.example" })).status === 403);

  // Contradictory metadata: a browser can't send these, a forged request is refused anyway.
  const APP = base;
  for (const [label, headers] of [
    ["same-origin + foreign Origin", { "sec-fetch-site": "same-origin", origin: "https://evil.example" }],
    ["same-origin + Origin null", { "sec-fetch-site": "same-origin", origin: "null" }],
    ["same-origin + foreign Referer", { "sec-fetch-site": "same-origin", referer: "https://evil.example/" }],
    ["no metadata + foreign Origin", { origin: "https://evil.example" }],
    ["no metadata + foreign Referer", { referer: "https://evil.example/" }],
    ["same-site", { "sec-fetch-site": "same-site", referer: "http://127.0.0.1:9/" }],
    ["none (typed address)", { "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }],
  ]) {
    const r = await rawGet(base, META, headers);
    check(`${label}: refused, route didn't run`, r.status === 403 && !ran(r));
  }
  check(
    "the app's own page (same-origin, its Referer): the route runs",
    ran(await rawGet(base, META, { "sec-fetch-site": "same-origin", referer: `${APP}/library` })),
  );
  check(
    "a non-browser caller without a token: the route runs (intended)",
    ran(await rawGet(base, META, { "sec-fetch-mode": "cors" })),
  );
}

const [mode, arg, arg2] = process.argv.slice(2);
if (mode === "viewer") await viewer();
else if (mode === "pivot" && arg) await pivot(arg.replace(/\/+$/, ""));
else if (mode === "boundary" && arg && arg2) await boundary(arg.replace(/\/+$/, ""), arg2);
else {
  console.error(
    "Usage: node scripts/qa/preview-checks.mjs viewer | pivot <PIVOT url> | boundary <PIVOT url> <its data folder>",
  );
  process.exit(2);
}
process.exit(results.every(Boolean) ? 0 : 1);
