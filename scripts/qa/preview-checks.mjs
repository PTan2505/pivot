#!/usr/bin/env node
// Browser checks for mockup previews, with PIVOT's own Playwright and Chromium (pnpm setup:browser).
//
//   node scripts/qa/preview-checks.mjs viewer          hostile mockups in the local viewer (make-viewer.mjs) must be
//                                                     contained: no network, no file access, no navigating the page,
//                                                     no popups or storage; static versions run no script; CSS motion
//                                                     plays in both kinds
//   node scripts/qa/preview-checks.mjs pivot <url>    CSS motion plays in a mockup shown on a design session page of a
//                                                     running PIVOT (use a scratch instance; it writes one session)
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
#box{width:40px;height:40px;background:#f60;animation:slide 1s linear infinite}</style><div id="box"></div>`;

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
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(secret, { force: true });
  }
}

async function pivot(base) {
  const post = (p, body) =>
    fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  const { sessionId } = await post("/api/design/briefs", {
    title: "CSS motion check",
    targetProject: "preview-checks",
    surface: "Box",
    milestone: "initial",
    markdown: "## Brief: Box\n\n**Goal:** check CSS motion in the mockup frame.",
  });
  await post(`/api/design/sessions/${sessionId}/mockups`, {
    mockups: [
      {
        title: "Moving box",
        html: `<!doctype html><html><head><title>Moving box</title></head><body>${MOVING}</body></html>`,
      },
    ],
  });
  const browser = await chromium.launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await tab.goto(`${base}/design/${sessionId}`);
    const box = tab.frameLocator('iframe[sandbox=""]').locator("#box");
    await box.waitFor({ timeout: 15000 });
    const a = await box.evaluate((el) => getComputedStyle(el).transform);
    await pause(300);
    const b = await box.evaluate((el) => getComputedStyle(el).transform);
    check("PIVOT session page: CSS animation plays in the sandboxed mockup", a !== b, `${a} → ${b}`);
  } finally {
    await browser.close();
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === "viewer") await viewer();
else if (mode === "pivot" && arg) await pivot(arg.replace(/\/+$/, ""));
else {
  console.error("Usage: node scripts/qa/preview-checks.mjs viewer | pivot <PIVOT url>");
  process.exit(2);
}
process.exit(results.every(Boolean) ? 0 : 1);
