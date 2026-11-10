// pivot-design's interactive preview (.claude/skills/pivot-design/scripts/preview.mjs): versions are checked against
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
const P = await import(
  pathToFileURL(path.resolve(here, "../../../.claude/skills/pivot-design/scripts/preview.mjs")).href
);
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
        await import(
          pathToFileURL(path.resolve(here, "../../../.claude/skills/pivot-design/scripts/motion-qa.mjs")).href
        )
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

describe("the preview script", () => {
  it("takes only a PIVOT on this machine as --url", async () => {
    const script = path.resolve(here, "../../../.claude/skills/pivot-design/scripts/preview.mjs");
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
    const script = path.resolve(here, "../../../.claude/skills/pivot-design/scripts/preview.mjs");
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
