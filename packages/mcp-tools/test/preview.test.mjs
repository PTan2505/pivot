// pivot:design's interactive preview (plugin/skills/design/scripts/preview.mjs): versions are checked against
// their digests before anything is shown, run only in a separate Chromium behind motion QA's gate, can't reach other
// hosts, local files or the preview's controls, and the controls (width, reduced motion, compare, replay) work.
import { execFile } from "node:child_process";
import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(path.resolve(here, "../../../plugin/skills/design/scripts/preview.mjs")).href);
const { mockupDigest, loadVersions, startPreview, PreviewError, versionPolicy, versionSandbox } = P;

const SID = "11111111-2222-4333-8444-555555555555";
const version = (n, title, interactive, html, round = 1) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  n,
  round,
  title,
  interactive,
  html,
  digest: mockupDigest(html, interactive),
});
const session = { id: SID, title: "Pricing", round: 1 };

/** A fake PIVOT: the session's JSON and each version's stored HTML, as the API serves them. */
function fakePivot(stored, { tamper } = {}) {
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === `/api/design/sessions/${SID}`)
      return new Response(
        JSON.stringify({
          id: SID,
          title: "Pricing",
          status: "exploring",
          mockups: stored.map(({ html: _h, ...m }) => m),
        }),
      );
    const m = stored.find((s) => u.pathname === `/api/design/mockups/${s.id}`);
    if (!m) return new Response("", { status: 404 });
    return new Response(tamper === m.n ? `${m.html}<!-- changed -->` : m.html);
  };
}

describe("versions are checked before anything is shown", () => {
  it("computes a version's digest exactly as PIVOT does", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "preview-digest-"));
    Object.assign(process.env, { PIVOT_DATA_DIR: tmp });
    delete process.env.DATABASE_URL;
    const core = await import("@pivot/core/design");
    for (const [html, interactive] of [
      ["<p>x</p>", false],
      ["<p>x</p>", true],
      ["<script>1</script>ü", true],
    ])
      expect(mockupDigest(html, interactive)).toBe(core.mockupDigest(html, interactive));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("loads the latest round by default, or the one asked for, in order", async () => {
    const stored = [
      version(1, "Old", false, "<p>old</p>", 1),
      version(2, "B", true, "<p>b</p>", 2),
      version(1, "A", false, "<p>a</p>", 2),
    ];
    stored[2].id = "00000000-0000-4000-8000-000000000009";
    const { session: s, versions } = await loadVersions({
      base: "http://pivot.test",
      sessionId: SID,
      fetchImpl: fakePivot(stored),
    });
    expect(s.round).toBe(2);
    expect(versions.map((v) => [v.n, v.title, v.interactive])).toEqual([
      [1, "A", false],
      [2, "B", true],
    ]);
    const one = await loadVersions({
      base: "http://pivot.test",
      sessionId: SID,
      round: 1,
      fetchImpl: fakePivot(stored),
    });
    expect(one.versions.map((v) => v.title)).toEqual(["Old"]);
  });

  it("refuses the whole round when one version doesn't match its digest", async () => {
    const stored = [version(1, "A", false, "<p>a</p>"), version(2, "B", true, "<p>b</p>")];
    const err = await loadVersions({
      base: "http://pivot.test",
      sessionId: SID,
      fetchImpl: fakePivot(stored, { tamper: 2 }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PreviewError);
    expect(err.code).toBe(2);
    expect(err.message).toMatch(/Version 2 doesn't match its stored digest/);
    // an interactive flag flipped on the way changes the digest too
    const flipped = [{ ...version(1, "A", false, "<p>a</p>"), interactive: true }];
    const err2 = await loadVersions({ base: "http://pivot.test", sessionId: SID, fetchImpl: fakePivot(flipped) }).catch(
      (e) => e,
    );
    expect(err2.code).toBe(2);
  });

  it("refuses an answer for another session", async () => {
    const other = async (url) => {
      const r = await fakePivot([version(1, "A", false, "<p>a</p>")])(url);
      if (!url.includes("/sessions/")) return r;
      return new Response(JSON.stringify({ ...(await r.json()), id: "99999999-2222-4333-8444-555555555555" }));
    };
    await expect(loadVersions({ base: "http://pivot.test", sessionId: SID, fetchImpl: other })).rejects.toThrow(
      /another session/,
    );
  });

  it("says so when the session has no mockups", async () => {
    await expect(loadVersions({ base: "http://pivot.test", sessionId: SID, fetchImpl: fakePivot([]) })).rejects.toThrow(
      /no mockups yet/,
    );
  });

  it("gives static versions no scripts and interactive ones scripts but no connections", () => {
    expect(versionPolicy(false)).toContain("script-src 'none'");
    expect(versionPolicy(true)).toContain("script-src 'unsafe-inline'");
    for (const i of [false, true]) {
      expect(versionPolicy(i)).toContain("connect-src 'none'");
      expect(versionPolicy(i)).toContain("default-src 'none'");
      expect(versionSandbox(i)).not.toMatch(/same-origin|top-navigation|popups|forms|modals/);
    }
  });
});

describe("the preview browser", () => {
  const hits = [];
  let recorder;
  let recorderUrl;
  let preview;
  let page;
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i?.family === "IPv4" && !i.internal)?.address;
  const secretFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "preview-secret-")), "secret.txt");
  const SECRET = "PREVIEW-SYNTHETIC-SECRET-7b1d";
  const events = [];
  const feedbackSent = [];

  const toggle = version(
    2,
    "Toggle",
    true,
    `<button id=b>Open</button><p id=o>closed</p><p id=w></p><p id=m></p><p id=p></p>
<script>
b.onclick = () => { o.textContent = "open"; w.textContent = innerWidth; m.textContent = matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "full"; };
// a hostile mockup: reach the preview's page, its privileged control and the API, all of which must fail
try { parent.document.body.innerHTML = "HIJACKED"; p.textContent = "parent reachable"; } catch { p.textContent = "parent blocked"; }
try { window.pivotPreview && window.pivotPreview({ reducedMotion: true }); } catch {}
try { window.pivotPreview && window.pivotPreview({ choose: 2, note: "chosen by the mockup" }); } catch {}
try { window.open("about:blank"); } catch {}
</script>`,
  );
  const stat = version(
    1,
    "Static",
    false,
    `<h1 id=t>static</h1><script>document.getElementById("t").textContent = "SCRIPT RAN"</script>`,
  );

  beforeAll(async () => {
    fs.writeFileSync(secretFile, SECRET);
    recorder = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.end("RECORDED");
    });
    await new Promise((r) => recorder.listen(0, "127.0.0.1", r));
    recorderUrl = `http://127.0.0.1:${recorder.address().port}`;
    preview = await startPreview({
      session,
      versions: [stat, toggle],
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      headless: true,
      onEvent: (e) => events.push(e),
      sendFeedback: async (fb) => {
        feedbackSent.push(fb);
        return { id: "fb-1" };
      },
    });
    page = preview.page();
    await page.waitForSelector("body[data-ready=true]");
  }, 60_000);
  afterAll(async () => {
    await preview?.close();
    recorder?.close();
  });

  it("names each version by id and digest, the ones PIVOT shows", async () => {
    expect(await page.textContent("#identity")).toBe(
      `Version 1 · static · id ${stat.id} · digest ${stat.digest.slice(0, 12)} (checked against PIVOT's stored copy)`,
    );
    expect(await page.locator("[role=tab]").allTextContents()).toEqual(["1 · Staticstatic", "2 · Toggleinteractive"]);
    expect(await page.inputValue("#pivot")).toBe(`http://127.0.0.1:4321/design/${SID}`);
  });

  it("runs no scripts in a static version", async () => {
    await page.click("[data-tab='0']");
    expect(await page.frameLocator("iframe").locator("#t").textContent()).toBe("static");
  });

  it("runs an interactive version: clicks, width and reduced motion reach it", async () => {
    await page.click("[data-tab='1']");
    await page.click("[data-width='phone']");
    const f = page.frameLocator("iframe");
    await f.locator("#b").click();
    expect(await f.locator("#o").textContent()).toBe("open");
    expect(await f.locator("#w").textContent()).toBe("390");
    expect(await f.locator("#m").textContent()).toBe("full");
    await page.click("[data-motion='reduce']");
    await page.frameLocator("iframe").locator("#b").click();
    expect(await page.frameLocator("iframe").locator("#m").textContent()).toBe("reduce");
    await page.waitForFunction(() => document.getElementById("media")?.textContent === "This window: reduced motion");
    await page.click("[data-motion='no-preference']");
    await page.click("[data-width='desktop']");
  });

  it("keeps the mockup out of the preview's page and its privileged control", async () => {
    await page.click("[data-tab='1']");
    const f = page.frameLocator("iframe");
    expect(await f.locator("#p").textContent()).toBe("parent blocked");
    expect(await page.textContent("#identity")).toContain(`digest ${toggle.digest.slice(0, 12)}`);
    // the mockup asked for reduced motion on load: refused, the window stays at full motion
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
    // and its window.open didn't open anything
    expect(preview.context.pages()).toHaveLength(1);
    // nor could it pick a version for the user
    expect(events.some((e) => e.event === "chosen")).toBe(false);
  });

  it("fills the window with the version; the quick bar steps through versions and toggles the controls drawer", async () => {
    await page.click("[data-tab='0']");
    const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const box = await page.locator("iframe").boundingBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, win.w, win.h]);
    expect(await page.textContent("#pos-sr")).toBe("Version 1 of 2: Static");
    await page.click("#next");
    expect(await page.getAttribute("[data-tab='1']", "aria-selected")).toBe("true");
    await page.click("#prev");
    expect(await page.getAttribute("[data-tab='0']", "aria-selected")).toBe("true");
    // the drawer starts open (a first visit), and closes with the toggle or Esc, focus returning to the toggle
    expect(await page.getAttribute("#drawer", "data-state")).toBe("open");
    await page.click("#toggle");
    expect(await page.getAttribute("#drawer", "data-state")).toBe("closed");
    expect(await page.getAttribute("#toggle", "aria-expanded")).toBe("false");
    expect(await page.evaluate(() => document.getElementById("drawer").inert)).toBe(true);
    await page.click("#toggle");
    // focus moves to the selected version on the next frame
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-selected") === "true");
    await page.keyboard.press("Escape");
    expect(await page.getAttribute("#drawer", "data-state")).toBe("closed");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("toggle");
    // the bar folds into a dot and comes back
    await page.click("#toggle");
    await page.click("[data-place='dot']");
    expect(await page.getAttribute("#bar-place", "class")).toBe("bar-place dot");
    expect(await page.textContent("#dot")).toBe("1/2");
    await page.click("[data-place='bottom']");
    expect(await page.getAttribute("#bar-place", "class")).toBe("bar-place bottom");
  });

  it("sends the user's feedback for the version shown to PIVOT, and keeps the window open", async () => {
    await page.click("[data-tab='1']");
    expect(await page.isDisabled("#fb-send")).toBe(true);
    await page.fill("#fb-text", "  The toggle should be larger  ");
    await page.click("#fb-send");
    await page.waitForFunction(() => document.getElementById("fb-status")?.textContent === "Sent · waiting for Claude");
    expect(await page.textContent("#fb-send")).toBe("Send to Claude");
    expect(feedbackSent.at(-1)).toEqual({
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      sessionId: SID,
      round: toggle.round,
      mockupId: toggle.id,
      text: "The toggle should be larger",
    });
    expect(events.at(-1)).toMatchObject({ event: "feedback", n: 2, id: toggle.id, feedbackId: "fb-1", notes: 0 });
    expect(await page.inputValue("#fb-text")).toBe("");
    // typing digits in the box doesn't switch versions
    await page.fill("#fb-text", "");
    await page.focus("#fb-text");
    await page.keyboard.type("1");
    expect(await page.getAttribute("[data-tab='1']", "aria-selected")).toBe("true");
    await page.fill("#fb-text", "");
    expect(preview.context.pages()).toHaveLength(1);
  });

  it("compares versions side by side and replays", async () => {
    await page.click("#compare");
    expect(await page.locator("iframe").count()).toBe(2);
    await page.click("#compare");
    const before = await page.getAttribute("iframe", "src");
    await page.click("#replay");
    expect(await page.getAttribute("iframe", "src")).not.toBe(before);
  });

  it("recovers from a crashed page with the same checked versions", async () => {
    const cdp = await preview.context.newCDPSession(page);
    await cdp.send("Page.crash").catch(() => {});
    for (let i = 0; i < 50 && !events.some((e) => e.event === "reloaded"); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["crashed", "reloaded"]));
    page = preview.page();
    await page.waitForSelector("body[data-ready=true]");
    expect(await page.locator("[role=tab]").count()).toBe(2);
    // it doesn't reload the version that crashed: it waits for a pick
    expect(await page.isVisible("#crashed")).toBe(true);
    expect(await page.locator("iframe").count()).toBe(0);
    await page.click("[data-tab='0']");
    expect(await page.locator("iframe").count()).toBe(1);
  }, 30_000);

  it("serves a version only with its own token, and only to its own address", async () => {
    const meta = await (await fetch(`${preview.origin}/versions.json`)).json();
    expect(meta.map((v) => v.src)).toEqual([
      expect.stringMatching(/^\/v\/1\?t=[0-9a-f]{32}$/),
      expect.stringMatching(/^\/v\/2\?t=[0-9a-f]{32}$/),
    ]);
    expect((await fetch(`${preview.origin}${meta[1].src}`)).status).toBe(200);
    expect((await fetch(`${preview.origin}/v/2`)).status).toBe(404);
    expect((await fetch(`${preview.origin}/v/2?t=${"0".repeat(32)}`)).status).toBe(404);
    const rebound = await new Promise((resolve) =>
      http.get(`${preview.origin}/versions.json`, { headers: { host: "rebind.attacker.example" } }, (r) =>
        resolve(r.statusCode),
      ),
    );
    expect(rebound).toBe(421);
  });

  it("keeps a version from loading another one in its frame (no mislabelled content)", async () => {
    const own = version(1, "Jumper", true, `<p id=x>ONE</p><script>location.href = "/v/2?r=0";</script>`);
    const two = version(2, "Two", false, `<p id=x>VERSION TWO</p>`);
    const p2 = await startPreview({
      session,
      versions: [own, two],
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      headless: true,
    });
    try {
      const pg = p2.page();
      await pg.waitForSelector("body[data-ready=true]");
      await pg.waitForTimeout(800);
      const texts = await Promise.all(
        pg.frames().map((f) => f.evaluate(() => document.body?.innerText ?? "").catch(() => "")),
      );
      expect(texts.join(" ")).not.toContain("VERSION TWO");
      expect(await pg.textContent("#identity")).toContain("Version 1");
    } finally {
      await p2.close();
    }
  }, 30_000);

  it("sends the user's pick, with the checked id and digest and their note, then closes", async () => {
    const seen = [];
    const p4 = await startPreview({
      session,
      versions: [stat, toggle],
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      headless: true,
      onEvent: (e) => seen.push(e),
    });
    const pg = p4.page();
    await pg.waitForSelector("body[data-ready=true]");
    // nothing to pick while comparing
    await pg.click("#compare");
    expect(await pg.isDisabled("#choose")).toBe(true);
    await pg.click("#compare");
    await pg.click("[data-tab='1']");
    await pg.click("#choose");
    expect(await pg.textContent("#chosen")).toBe(`version 2 · Toggle (digest ${toggle.digest.slice(0, 12)})`);
    // Cancel sends nothing
    await pg.click("#cancel");
    expect(await pg.isHidden("#confirm")).toBe(true);
    await pg.click("#choose");
    await pg.fill("#note", "  keep the hover lift  ");
    await pg.click("#send");
    await p4.closed;
    expect(seen.filter((e) => e.event === "chosen")).toEqual([
      {
        event: "chosen",
        round: toggle.round,
        n: 2,
        title: "Toggle",
        id: toggle.id,
        digest: toggle.digest,
        note: "keep the hover lift",
      },
    ]);
  }, 30_000);

  it("stops after three crashes in a minute instead of crashing forever", async () => {
    const seen = [];
    const p3 = await startPreview({
      session,
      versions: [stat],
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      headless: true,
      onEvent: (e) => seen.push(e.event),
    });
    for (let i = 0; i < 3 && !seen.includes("stopped"); i++) {
      const before = seen.length;
      await (await p3.context.newCDPSession(p3.page())).send("Page.crash").catch(() => {});
      for (let t = 0; t < 50 && seen.length === before; t++) await new Promise((r) => setTimeout(r, 100));
      for (let t = 0; t < 50 && !seen.includes("stopped") && seen.at(-1) !== "reloaded"; t++)
        await new Promise((r) => setTimeout(r, 100));
    }
    await p3.closed;
    expect(seen.filter((e) => e === "crashed")).toHaveLength(3);
    expect(seen.at(-1)).toBe("stopped");
  }, 60_000);

  describe("network and files, with the versions' CSP switched off: the gate alone holds", () => {
    let open;
    let udp;
    const packets = [];
    beforeAll(async () => {
      if (lan) {
        udp = dgram.createSocket("udp4");
        udp.on("message", () => packets.push(1));
        await new Promise((r) => udp.bind(0, lan, r));
      }
    });
    afterAll(async () => {
      await open?.close();
      udp?.close();
    });

    // `pivot`: also try PIVOT's default address. Only the gated preview gets it, so no test ever reaches a real PIVOT.
    const hostile = (pivot = false) => {
      const stun = lan && udp ? `stun:${lan}:${udp.address().port}` : "";
      const lanUrl = lan ? `http://${lan}:${recorder.address().port}` : recorderUrl;
      return `<p id=s>start</p><form id=f action="${recorderUrl}/form" method=post><input name=x value=1></form>
<script>
fetch("${recorderUrl}/fetch").catch(() => {});
fetch("${lanUrl}/lan").catch(() => {});
new Image().src = "${recorderUrl}/img";
try { const ws = new WebSocket("${recorderUrl.replace("http", "ws")}/ws"); } catch {}
try { new EventSource("${recorderUrl}/es"); } catch {}
const x = new XMLHttpRequest(); x.open("GET", "${recorderUrl}/xhr"); x.send();
fetch("http://localhost:${recorder.address().port}/alias").catch(() => {});
${pivot ? 'fetch("http://127.0.0.1:4321/api/settings/token").catch(() => {});' : ""}
fetch("file://${secretFile}").then((r) => r.text()).then((t) => (s.textContent = t)).catch(() => {});
try { if ("${stun}") { const pc = new RTCPeerConnection({ iceServers: [{ urls: "${stun}" }] }); pc.createDataChannel("d"); pc.createOffer().then((o) => pc.setLocalDescription(o)); } } catch {}
setTimeout(() => { try { document.getElementById("f").submit(); } catch {} }, 300);
setTimeout(() => { location.href = "${recorderUrl}/navigate"; }, 600);
setTimeout(() => { location.href = "file://${secretFile}"; }, 900);
</script>`;
    };

    it("positive control: the same mockup reaches the recorder from an ungated browser", async () => {
      const { chromium } = (
        await import(pathToFileURL(path.resolve(here, "../../../plugin/skills/design/scripts/motion-qa.mjs")).href)
      ).loadPlaywright();
      const plain = http.createServer((_q, r) => r.end(hostile()));
      await new Promise((r) => plain.listen(0, "127.0.0.1", r));
      const browser = await chromium.launch();
      const p = await browser.newPage();
      hits.length = 0;
      await p.goto(`http://127.0.0.1:${plain.address().port}/`);
      await new Promise((r) => setTimeout(r, 1500));
      await browser.close();
      plain.close();
      expect(hits.length).toBeGreaterThan(0);
    }, 30_000);

    it("lets nothing out: no request reaches another origin, no WebRTC packet, no local file", async () => {
      const v = version(1, "Hostile", true, hostile(true));
      hits.length = 0;
      packets.length = 0;
      open = await startPreview({
        session,
        versions: [v],
        pivotPage: `http://127.0.0.1:4321/design/${SID}`,
        headless: true,
        policy: () => "",
      });
      const p = open.page();
      await p.waitForSelector("body[data-ready=true]");
      await new Promise((r) => setTimeout(r, 2500));
      expect(hits).toEqual([]);
      expect(packets).toEqual([]);
      const texts = await Promise.all(
        p.frames().map((f) => f.evaluate(() => document.documentElement?.outerHTML ?? "").catch(() => "")),
      );
      expect(texts.join("\n")).not.toContain(SECRET);
      expect(open.blocked.size).toBeGreaterThan(0);
      expect([...open.blocked].join(" ")).toMatch(/127\.0\.0\.1:4321 \(PIVOT\)/);
    }, 60_000);
  });
});

// Comment mode (live feedback, live-feedback-plan.md Phase 10): the shield, the element read in the version frame's
// isolated world, the crops, the notes sent with the text, and what a hostile mockup can't do.
const LIVE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px system-ui;color:#111}header{display:flex;gap:16px;align-items:center;padding:12px 16px;background:#eee;position:sticky;top:0;z-index:2}
.menu{position:fixed;top:60px;left:16px;background:#fff;box-shadow:0 8px 24px #0003;padding:8px;width:200px;display:flex;flex-direction:column;gap:4px;z-index:3}
.item{display:block;padding:6px 8px;color:#111;background:#f6f6f6}.sec{min-height:700px;padding:24px}
.card{width:300px;height:120px;background:#cde;margin:12px;display:grid;place-items:center}</style></head><body>
<header><button id="open" class="btn primary">Menu</button><a href="#pricing" class="nav-link">Pricing</a><input id="q" placeholder="Search"></header>
<section class="sec" id="hero"><h1 class="title">Hero title</h1><div class="card" id="c1">Card A</div></section>
<section class="sec"><div class="card" id="c2">Card B</div></section><section class="sec"><div class="card" id="deep">Deep card</div></section>
<script>
const d = document.body.dataset;
const bump = (k) => (d[k] = String(Number(d[k] || 0) + 1));
for (const t of ["click", "pointerdown", "mousedown", "submit"]) addEventListener(t, () => bump(t), true);
document.getElementById("open").addEventListener("click", () => {
  const m = document.createElement("div"); m.className = "menu"; m.setAttribute("role", "menu");
  m.innerHTML = '<a href="#a" class="item">Profile</a><a href="#b" class="item">Settings</a>';
  document.body.appendChild(m);
});
// hostile: the privileged binding (read, note, send, mode), the isolated world's key binding, a made-up ⌥C, and an
// elementFromPoint that lies to anything reading the page from its own world
const tries = [{ hover: { x: 40, y: 30 } }, { pick: { x: 40, y: 30, tool: "select", n: 1 } }, { feedback: "from the mockup", n: 1 }, { mode: "comment" }, { drop: "x" }];
Promise.all(tries.map((c) => { try { return window.pivotPreview ? window.pivotPreview(c).then((r) => String(r), () => "threw") : "absent"; } catch { return "sync-throw"; } })).then((r) => (d.evil = r.join(",")));
d.keyBinding = typeof window.__pivotPreviewKey;
setTimeout(() => dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", key: "ç", altKey: true, bubbles: true })), 300);
document.elementFromPoint = () => document.getElementById("deep");
</script></body></html>`;
const STATIC_PAGE = `<!doctype html><style>body{margin:0;font:16px system-ui}h1{margin:40px}</style><h1 id="t" class="title big">Hello static</h1><p class="lead" style="margin:40px">Plain text</p><script>document.getElementById("t").textContent = "SCRIPT RAN"</script>`;
// a page whose crops can't stay small at full quality: noise on a canvas
const NOISE_PAGE = `<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas id="c"></canvas><script>
const c = document.getElementById("c"); c.width = innerWidth; c.height = 2400; c.style.width = innerWidth + "px"; c.style.height = "2400px";
const x = c.getContext("2d"), im = x.createImageData(c.width, c.height);
for (let i = 0; i < im.data.length; i += 4) { im.data[i] = Math.random() * 255; im.data[i + 1] = Math.random() * 255; im.data[i + 2] = Math.random() * 255; im.data[i + 3] = 255; }
x.putImageData(im, 0, 0);</script>`;

/** Starts a preview of the comment fixtures, recording what it would post to PIVOT. */
async function commentPreview(extra = {}) {
  const sent = [];
  const events = [];
  const versions = [
    version(1, "Live", true, LIVE_PAGE),
    version(2, "Static", false, STATIC_PAGE),
    version(3, "Noise", true, NOISE_PAGE),
  ];
  const pv = await startPreview({
    session,
    versions,
    pivotPage: `http://127.0.0.1:4321/design/${SID}`,
    headless: true,
    onEvent: (e) => events.push(e),
    sendFeedback: async (body) => {
      sent.push(body);
      return { id: `fb-${sent.length}` };
    },
    ...extra,
  });
  const page = pv.page();
  await page.waitForSelector("body[data-ready=true]");
  await loaded(page);
  return { pv, page, sent, events, versions };
}
/** The version's frame has run its own scripts (the live fixture marks its body when it has). */
async function loaded(page) {
  for (let i = 0; i < 100; i++) {
    const done = await versionFrame(page)
      ?.evaluate(
        () => document.readyState === "complete" && (!document.getElementById("open") || !!document.body.dataset.evil),
      )
      .catch(() => false);
    if (done) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the version's frame didn't load");
}
const versionFrame = (page) => page.frames().find((f) => f.parentFrame() === page.mainFrame());
const commenting = (page) => page.evaluate(() => document.body.classList.contains("commenting"));
/** The centre of an element of the version, in the window (the frame is unscaled at Desktop). */
async function centreOf(page, sel) {
  const b = await page.frameLocator("iframe").locator(sel).first().boundingBox();
  return { x: b.x + Math.min(b.width / 2, 40), y: b.y + b.height / 2 };
}
async function hoverChip(page, sel) {
  const p = await centreOf(page, sel);
  await page.mouse.move(p.x - 1, p.y);
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => !document.getElementById("hl").hidden);
  return page.textContent("#chip");
}

describe("comment mode in the preview window", () => {
  let c;
  beforeAll(async () => {
    c = await commentPreview();
  }, 60_000);
  afterAll(async () => {
    await c?.pv.close();
  });

  it("switches between Use and Comment: the shield covers the version, the tools show only in Comment", async () => {
    const { page } = c;
    expect(await commenting(page)).toBe(false);
    expect(await page.isVisible("#cshield")).toBe(false);
    expect(await page.isVisible("#ctool")).toBe(false);
    expect(await page.isVisible("#dtools-row")).toBe(false);
    expect(await page.textContent("#notes-empty")).toBe(
      "Use the page first: open the menu or tab you want, then switch to Comment.",
    );
    await page.click("#qmode [data-mode=comment]");
    expect(await commenting(page)).toBe(true);
    expect(await page.getAttribute("#dmode [data-mode=comment]", "aria-checked")).toBe("true");
    expect(await page.textContent("#chint")).toBe("Commenting · page paused · Esc to use it");
    // the shield covers exactly the version's box, under the drawer and the bars
    const shield = await page.locator("#cshield").boundingBox();
    const frame = await page.locator("#stage .frame").boundingBox();
    expect(shield).toEqual(frame);
    // focus moved to the preview's page, on the current tool
    expect(await page.evaluate(() => document.activeElement?.dataset.tool)).toBe("select");
    // V and P pick the tool; never while typing in a field
    await page.keyboard.press("p");
    expect(await page.getAttribute("#ctools [data-tool=pin]", "aria-checked")).toBe("true");
    expect(await page.textContent("#centre-label")).toBe("Add pin at centre");
    await page.focus("#fb-text");
    await page.keyboard.type("v");
    expect(await page.getAttribute("#ctools [data-tool=pin]", "aria-checked")).toBe("true");
    await page.keyboard.press("Escape"); // typing: Esc stays in the field
    expect(await commenting(page)).toBe(true);
    await page.fill("#fb-text", "");
    await page.locator("#done").focus();
    await page.keyboard.press("v");
    expect(await page.getAttribute("#ctools [data-tool=select]", "aria-checked")).toBe("true");
    // Esc goes back to Use; ⌥C switches both ways
    await page.keyboard.press("Escape");
    expect(await commenting(page)).toBe(false);
    expect(await page.isVisible("#cshield")).toBe(false);
    expect(await page.getAttribute("#drawer", "data-state")).toBe("open");
    await page.keyboard.press("Alt+KeyC");
    expect(await commenting(page)).toBe(true);
    await page.keyboard.press("Alt+KeyC");
    expect(await commenting(page)).toBe(false);
    // V and P do nothing in Use
    await page
      .locator("#done")
      .focus()
      .catch(() => {});
    await page.keyboard.press("p");
    expect(await page.getAttribute("#ctools [data-tool=select]", "aria-checked")).toBe("true");
  }, 30_000);

  it("reads the element under the pointer in its own world, on a static version (no scripts)", async () => {
    const { page } = c;
    await page.click("[data-tab='1']");
    await loaded(page);
    expect(await page.frameLocator("iframe").locator("#t").textContent()).toBe("Hello static");
    await page.click("#qmode [data-mode=comment]");
    const chip = await hoverChip(page, "#t");
    expect(chip).toMatch(/^h1#t “Hello static” · \d+×\d+$/);
    expect(await hoverChip(page, "p.lead")).toMatch(/^p\.lead “Plain text” · \d+×\d+$/);
    await page.click("#qmode [data-mode=use]");
  }, 30_000);

  it("comments on what a script opened: a menu opened in Use, commented on in Comment, clicks never reaching it", async () => {
    const { page, pv } = c;
    await page.click("[data-tab='0']");
    await loaded(page);
    const f = page.frameLocator("iframe");
    // a link within the page first (a same-document navigation: the guard stays single, ⌥C switches once)
    await f.locator("a.nav-link").click();
    await f.locator("#open").click();
    expect(await f.locator(".menu").count()).toBe(1);
    const before = await versionFrame(page).evaluate(() => ({ ...document.body.dataset, hash: location.hash }));
    expect(before.hash).toBe("#pricing");
    // focus is in the mockup: ⌥C is caught there and switches to Comment (and types nothing)
    await f.locator("#q").focus();
    await page.keyboard.press("Alt+KeyC");
    await page.waitForFunction(() => document.body.classList.contains("commenting"));
    await page.waitForTimeout(200);
    expect(await commenting(page)).toBe(true); // switched once
    expect(await f.locator("#q").inputValue()).toBe("");
    // the mockup's elementFromPoint lies (it always answers #deep): the read happens in another world
    expect(await hoverChip(page, ".menu a.item:nth-of-type(2)")).toMatch(/^a\.item “Settings” · 200×\d+$/);
    const p = await centreOf(page, ".menu a.item:nth-of-type(2)");
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector("#pop:not([hidden])");
    expect(await page.textContent("#pop-label")).toBe("Note on a.item “Settings”");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("pop-text");
    await page.keyboard.type("Make this one bold");
    await page.keyboard.press("Escape"); // closes the note, stays in Comment
    expect(await page.isHidden("#pop")).toBe(true);
    expect(await commenting(page)).toBe(true);
    // a marker just outside the element's top-left corner, and the row in the drawer
    const marker = page.locator(".mk");
    expect(await marker.getAttribute("aria-label")).toBe("Note 1 on a.item “Settings”: Make this one bold");
    const mb = await marker.boundingBox();
    const eb = await f.locator(".menu a.item:nth-of-type(2)").boundingBox();
    // (kept whole inside the frame: the element is 24px from its left edge)
    expect([Math.round(mb.x + mb.width / 2), Math.round(mb.y + mb.height / 2)]).toEqual([
      Math.round(Math.max(14, eb.x - 14)),
      Math.round(eb.y - 14),
    ]);
    expect(mb.width).toBe(28);
    expect(await page.locator("#notes li").count()).toBe(1);
    expect(await page.textContent("#notes li small")).toBe("a.item “Settings” · Desktop 1500 · live");
    expect(await page.textContent("#qcount")).toBe("1 note");
    expect(pv.notes.size).toBe(1);
    // nothing reached the mockup: no click, no pointerdown, the menu still open, no link followed
    const after = await versionFrame(page).evaluate(() => ({ ...document.body.dataset, hash: location.hash }));
    expect(after.click).toBe(before.click);
    expect(after.pointerdown).toBe(before.pointerdown);
    expect(after.mousedown).toBe(before.mousedown);
    expect(after.hash).toBe("#pricing");
    expect(await f.locator(".menu").count()).toBe(1);
    // the page's own keys are paused while commenting: typing in its field does nothing, Esc there returns to Use
    await f.locator("#q").focus();
    await page.keyboard.type("abc");
    expect(await f.locator("#q").inputValue()).toBe("");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.body.classList.contains("commenting"));
    // and come back in Use
    await page.keyboard.type("ok");
    expect(await f.locator("#q").inputValue()).toBe("ok");
  }, 30_000);

  it("can't be driven by the mockup: no binding call, no key binding, no made-up ⌥C", async () => {
    const { page, events } = c;
    const d = await versionFrame(page).evaluate(() => ({ ...document.body.dataset }));
    expect(d.evil).toBe("false,false,false,false,false");
    expect(d.keyBinding).toBe("undefined");
    expect(await page.evaluate(() => typeof window.__pivotPreviewKey)).toBe("undefined");
    expect(events.filter((e) => e.event === "feedback")).toEqual([]);
    // reading the page is refused outside Comment, even to the preview's own page
    expect(await page.evaluate(() => window.pivotPreview({ hover: { x: 40, y: 30 } }))).toBe(null);
    expect(await page.evaluate(() => window.pivotPreview({ pick: { x: 40, y: 30, tool: "pin", n: 1 } }))).toBe(null);
    // keys and clicks the mockup makes up count for nothing: no ⌥C into Comment, no Esc out of it
    await versionFrame(page).evaluate(() =>
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", key: "ç", altKey: true, bubbles: true })),
    );
    await page.waitForTimeout(150);
    expect(await commenting(page)).toBe(false);
    await page.click("#qmode [data-mode=comment]");
    await versionFrame(page).evaluate(() => {
      for (const code of ["Escape", "KeyP"])
        dispatchEvent(new KeyboardEvent("keydown", { code, key: code === "Escape" ? code : "p", bubbles: true }));
    });
    await page.waitForTimeout(150);
    expect(await commenting(page)).toBe(true);
    expect(await page.getAttribute("#ctools [data-tool=select]", "aria-checked")).toBe("true");
    await page.click("#done");
    expect(await commenting(page)).toBe(false);
  }, 30_000);

  it("sends the notes and the text together with one Send to Claude, crops and all", async () => {
    const { page, pv, sent, events } = c;
    await page.click("#dmode [data-mode=comment]");
    // a spot with Pin, after scrolling the version with the wheel over the shield
    await page.keyboard.press("p");
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(async () => true);
    await expect.poll(() => versionFrame(page).evaluate(() => scrollY)).toBeGreaterThan(500);
    const sy = await versionFrame(page).evaluate(() => scrollY);
    await page.mouse.click(500, 400);
    await page.waitForSelector("#pop:not([hidden])");
    expect(await page.textContent("#pop-label")).toBe("Note for spot 2");
    await page.keyboard.type("Too much space here");
    await page.click("#cshield", { position: { x: 900, y: 20 } }); // a click elsewhere closes the note
    expect(await page.isHidden("#pop")).toBe(true);
    // a note closed without text is dropped, here and in the process
    await page.click("#centre");
    await page.waitForSelector("#pop:not([hidden])");
    expect(pv.notes.size).toBe(3);
    await page.keyboard.press("Escape");
    expect(pv.notes.size).toBe(2);
    expect(await page.locator("#notes li").count()).toBe(2);
    await page.fill("#fb-text", "  And the header feels heavy  ");
    expect(await page.textContent("#fb-send")).toBe("Send to Claude");
    await page.click("#fb-send");
    await page.waitForFunction(() => document.getElementById("fb-status")?.textContent === "Sent · waiting for Claude");
    const body = sent.at(-1);
    expect(body).toMatchObject({
      pivotPage: `http://127.0.0.1:4321/design/${SID}`,
      sessionId: SID,
      round: 1,
      mockupId: c.versions[0].id,
      text: "And the header feels heavy",
      width: 1500,
      height: 950,
    });
    expect(body.pins).toHaveLength(2);
    const [menu, spot] = body.pins;
    expect(menu).toMatchObject({
      n: 1,
      text: "Make this one bold",
      live: true,
      element: {
        selector: "body > div.menu > a.item:nth-of-type(2)",
        tag: "a",
        classes: ["item"],
        text: "Settings",
        html: '<a href="#b" class="item">Settings</a>',
      },
    });
    expect(spot).toMatchObject({ n: 2, text: "Too much space here", live: true, x: 500 });
    expect(spot.element).toBeUndefined();
    expect(spot.y).toBe(400 + sy);
    for (const pin of body.pins) {
      const img = Buffer.from(pin.capture.image, "base64");
      expect([img[0], img[1]]).toEqual([0xff, 0xd8]);
      const dim = P.jpegSize(img);
      expect(dim.w).toBeLessThanOrEqual(2400);
      expect(img.length).toBeLessThanOrEqual(P.NOTE_LIMITS.cropBytes);
      // the region is in the version's document: it holds the note's point
      const r = pin.capture.region;
      expect(pin.x).toBeGreaterThanOrEqual(r.left);
      expect(pin.x).toBeLessThanOrEqual(r.left + r.width);
      expect(pin.y).toBeGreaterThanOrEqual(r.top);
      expect(pin.y).toBeLessThanOrEqual(r.top + r.height);
    }
    // the spot's crop is the 160px square around it, plus a margin
    expect(spot.capture.region).toEqual({ left: 404, top: 304 + sy, width: 192, height: 192 });
    // the crop is the page as seen: the menu's item, not the drawer or an outline
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.from(menu.capture.image, "base64"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (let i = 0; i < data.length; i += info.channels)
      if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark++;
    expect(dark / (info.width * info.height)).toBeLessThan(0.2); // the menu's light box, not the dark outline or chrome
    expect(events.at(-1)).toMatchObject({
      event: "feedback",
      n: 1,
      id: c.versions[0].id,
      feedbackId: "fb-1",
      notes: 2,
      width: 1500,
    });
    // the notes left the draft, here and in the process
    expect(await page.locator("#notes li").count()).toBe(0);
    expect(await page.locator(".mk").count()).toBe(0);
    expect(pv.notes.size).toBe(0);
    expect(await page.inputValue("#fb-text")).toBe("");
    expect(await page.isDisabled("#fb-send")).toBe(true);
  }, 30_000);

  it("keeps notes made at another width, saying so, and sends each width as its own piece", async () => {
    const { page, sent, events } = c;
    await page.keyboard.press("v");
    await page.mouse.move(10, 10);
    const p = await centreOf(page, "#open");
    await page
      .frameLocator("iframe")
      .locator("#open")
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector("#pop:not([hidden])");
    await page.keyboard.type("Desktop note");
    await page.keyboard.press("Escape");
    await page.click("[data-width='phone']");
    expect(await commenting(page)).toBe(true);
    expect(await page.textContent("#notes li small")).toBe("button#open “Menu” · made at Desktop 1500 · live");
    expect(await page.locator(".mk").count()).toBe(0);
    await page.click("#centre");
    await page.waitForSelector("#pop:not([hidden])");
    await page.keyboard.type("Phone note");
    await page.keyboard.press("Escape");
    expect(await page.locator("#notes li small").nth(1).textContent()).toMatch(/ · Phone 390 · live$/);
    expect(await page.locator(".mk").count()).toBe(1);
    const n = sent.length;
    await page.click("#fb-send");
    await page.waitForFunction(() => document.getElementById("fb-status")?.textContent === "Sent · waiting for Claude");
    expect(sent.slice(n).map((b) => [b.width, b.pins.map((x) => x.text), b.text])).toEqual([
      [1500, ["Desktop note"], ""],
      [390, ["Phone note"], ""],
    ]);
    expect(events.slice(-2).map((e) => [e.notes, e.width])).toEqual([
      [1, 1500],
      [1, 390],
    ]);
    await page.click("[data-width='desktop']");
  }, 30_000);

  it("keeps every crop under PIVOT's limits, even of a page that can't compress", async () => {
    const { page, pv } = c;
    await page.click("[data-tab='2']");
    await loaded(page);
    expect(await commenting(page)).toBe(true);
    await page.waitForFunction(() => true);
    await expect.poll(() => versionFrame(page).evaluate(() => document.getElementById("c")?.height ?? 0)).toBe(2400);
    await page.keyboard.press("v");
    await page.mouse.move(300, 300);
    await page.mouse.click(300, 300);
    await page.waitForSelector("#pop:not([hidden])");
    expect(await page.textContent("#pop-label")).toMatch(/^Note on canvas#c · 1500×2400$/);
    const [kept] = [...pv.notes.values()];
    const img = Buffer.from(kept.image, "base64");
    expect(img.length).toBeLessThanOrEqual(P.NOTE_LIMITS.cropBytes);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(img).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2400);
    // noise doesn't compress: the crop was made smaller than the window's 1500 px to fit
    expect(meta.width).toBeLessThan(1500);
    // the visible part of the canvas: the whole window's width, cut at the window's bottom
    expect(kept.region).toMatchObject({ left: 0, top: 0, width: 1500, height: 950 });
    await page.click("#pop-del");
    expect(pv.notes.size).toBe(0);
    await page.click("#done");
  }, 30_000);
});

describe("comment mode on full Chromium (the version's frame out of process, as in the window)", () => {
  let c;
  let why = "";
  beforeAll(async () => {
    try {
      c = await commentPreview({ channel: "chromium" });
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }
  }, 60_000);
  afterAll(async () => {
    await c?.pv.close();
  });

  it("reads, crops and sends a note on a script-made element through the frame's own session", async (ctx) => {
    if (!c) return ctx.skip(`full Chromium isn't available: ${why}`);
    const { page, pv, sent } = c;
    // the frame runs in its own process here: it has its own CDP session
    const session = await pv.context.newCDPSession(versionFrame(page));
    await session.detach();
    const f = page.frameLocator("iframe");
    // an out-of-process frame takes the mouse only once it has painted: click until the menu opens
    for (let i = 0; i < 20 && !(await f.locator(".menu").count()); i++) {
      await f.locator("#open").click();
      await page.waitForTimeout(100);
    }
    // a same-document navigation (a link within the page) keeps one guard: ⌥C switches once, not twice
    await f.locator("a.nav-link").click();
    expect(await versionFrame(page).evaluate(() => location.hash)).toBe("#pricing");
    await f.locator("#q").focus();
    await page.keyboard.press("Alt+KeyC");
    await page.waitForFunction(() => document.body.classList.contains("commenting"));
    await page.waitForTimeout(200);
    expect(await commenting(page)).toBe(true);
    expect(await hoverChip(page, ".menu a.item:nth-of-type(1)")).toMatch(/^a\.item “Profile” · 200×\d+$/);
    const before = await versionFrame(page).evaluate(() => document.body.dataset.click);
    const p = await centreOf(page, ".menu a.item:nth-of-type(1)");
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector("#pop:not([hidden])");
    await page.keyboard.type("Rename");
    await page.keyboard.press("Escape");
    expect(await versionFrame(page).evaluate(() => document.body.dataset.click)).toBe(before);
    await page.click("#fb-send");
    await page.waitForFunction(() => document.getElementById("fb-status")?.textContent === "Sent · waiting for Claude");
    const pin = sent.at(-1).pins[0];
    expect(pin.element.selector).toBe("body > div.menu > a.item:nth-of-type(1)");
    expect(Buffer.from(pin.capture.image, "base64").length).toBeGreaterThan(500);
    const d = await versionFrame(page).evaluate(() => ({ ...document.body.dataset }));
    expect(d.evil).toBe("false,false,false,false,false");
    expect(d.keyBinding).toBe("undefined");
  }, 60_000);
});

describe("the preview script", () => {
  it("takes only a PIVOT on this machine as --url", async () => {
    const script = path.resolve(here, "../../../plugin/skills/design/scripts/preview.mjs");
    const { status, stderr } = await new Promise((resolve) =>
      execFile(process.execPath, [script, SID, "--url", "https://pivot.example.com"], (e, _o, err) =>
        resolve({ status: e?.code ?? 0, stderr: String(err) }),
      ),
    );
    expect(status).toBe(1);
    expect(stderr).toMatch(/must be PIVOT on this machine/);
  });

  it("exits 2 and shows nothing when a version doesn't match its digest", async () => {
    const stored = [version(1, "A", false, "<p>a</p>")];
    const api = http.createServer(async (req, res) => {
      const r = await fakePivot(stored, { tamper: 1 })(`http://x${req.url}`);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(await r.text());
    });
    await new Promise((r) => api.listen(0, "127.0.0.1", r));
    const script = path.resolve(here, "../../../plugin/skills/design/scripts/preview.mjs");
    // async: the fake PIVOT answers from this process, so it must not be blocked while the script runs
    const { status, stderr } = await new Promise((resolve) =>
      execFile(process.execPath, [script, SID, "--url", `http://127.0.0.1:${api.address().port}`], (e, _out, err) =>
        resolve({ status: e?.code ?? 0, stderr: String(err) }),
      ),
    );
    api.close();
    expect(status).toBe(2);
    expect(stderr).toMatch(/doesn't match its stored digest/);
  }, 30_000);
});
