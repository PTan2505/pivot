// End-to-end demo of the pivot-design workflow on a synthetic project, against a SCRATCH PIVOT (README.md):
// requirements → references (gate 1) → mockups → interactive preview → approval (gate 2) → implementation → QA,
// plus the failure paths. It plays the agent's part with the real MCP tools (packages/mcp-tools over the MCP
// server's HttpSource), the real preview script and motion QA.
//
// TEST-ONLY: the two gates are the owner's. Here gate 1 is a fixture (the references the "owner" picked) and gate 2
// is clicked in PIVOT's own session page by this test, as the owner would. Both are labelled TEST-ONLY in the
// report. This proves the mechanics, not that a real owner approved anything.
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpSource } from "../../../apps/mcp/src/http-source";
import { runTool, TOOLS } from "../../../packages/mcp-tools/src/tools";
import { WRITE_TOOLS } from "../../../packages/mcp-tools/src/write-tools";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "../../..");
const SKILL = path.join(REPO, ".claude/skills/pivot-design");
const BASE = (process.env.PIVOT_URL ?? "").replace(/\/+$/, "");
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "pivot-workflow-demo-"));
const req = createRequire(path.join(REPO, "packages/mcp-tools/package.json"));

type Q = typeof import("../../../.claude/skills/pivot-design/scripts/motion-qa.mjs");
type P = typeof import("../../../.claude/skills/pivot-design/scripts/preview.mjs");
let qa: Q;
let pv: P;
let source: HttpSource;
const tool = (name: string) => [...TOOLS, ...WRITE_TOOLS].find((t) => t.name === name)!;
const call = async (name: string, input: unknown) => runTool(tool(name), source, input);
const textOf = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");
const log: string[] = [];
/** TEST-ONLY: the scratch instance's owner passphrase, set by this run. A real owner sets theirs in their own terminal. */
const PASS = "TEST-ONLY scratch owner passphrase";
const sameOrigin = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  origin: BASE,
  "sec-fetch-site": "same-origin",
  ...extra,
});
const challengeFor = async (sessionId: string, m: { id: string; digest: string }) =>
  (await (
    await fetch(`${BASE}/api/design/mockups/${m.id}/approval-challenge?session=${sessionId}&digest=${m.digest}`)
  ).json()) as { ready: boolean; challenge?: string };
/** TEST-ONLY: what the owner's page sends once the owner typed the passphrase (only used on scratch sessions). */
async function ownerApprove(sessionId: string, m: { id: string; digest: string }, note = "TEST-ONLY") {
  const { challenge } = await challengeFor(sessionId, m);
  const body = { note, digest: m.digest, sessionId, challenge, passphrase: PASS };
  const res = await fetch(`${BASE}/api/design/mockups/${m.id}/approve`, {
    method: "POST",
    headers: sameOrigin(),
    body: JSON.stringify(body),
  });
  return { res, body };
}
const note = (line: string) => log.push(line);
const shot = (name: string) => path.join(OUT, name);

const state: {
  refIds: string[];
  sessionId: string;
  mockups: { id: string; n: number; digest: string; interactive: boolean }[];
  project: string;
  site?: http.Server;
  siteUrl: string;
} = { refIds: [], sessionId: "", mockups: [], project: "", siteUrl: "" };

/** Serves a folder as a static site on 127.0.0.1 (the target project, as its own dev server would). */
async function serve(dir: string) {
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
  };
  const server = http.createServer((q, r) => {
    const p = path.join(dir, decodeURIComponent(new URL(q.url!, "http://x").pathname).replace(/\/$/, "/index.html"));
    if (!p.startsWith(dir) || !fs.existsSync(p)) return r.writeHead(404).end();
    r.writeHead(200, { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" }).end(fs.readFileSync(p));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}

beforeAll(async () => {
  // Never run against the owner's PIVOT: a scratch instance on another port, with its own data folder.
  // Never the owner's PIVOT: a scratch one (scripts/start.mjs --scratch), checked before anything is written.
  const guard = await import(pathToFileURL(path.join(REPO, "scripts/qa/scratch-guard.mjs")).href);
  await guard.assertScratch({ base: BASE, dataDir: process.env.PIVOT_DATA_DIR });
  qa = await import(pathToFileURL(path.join(SKILL, "scripts/motion-qa.mjs")).href);
  pv = await import(pathToFileURL(path.join(SKILL, "scripts/preview.mjs")).href);
  source = new HttpSource(BASE);
  // TEST-ONLY: the owner passphrase of this scratch instance, set the way the owner would (the CLI, not the API)
  execFileSync(process.execPath, [path.join(REPO, "scripts/owner-passphrase.mjs"), "--stdin", "--replace"], {
    input: `${PASS}\n`,
    env: { ...process.env, PIVOT_DATA_DIR: process.env.PIVOT_DATA_DIR },
  });
  fs.mkdirSync(OUT, { recursive: true });
  note(`Scratch PIVOT ${BASE}; evidence in ${OUT}`);
});
afterAll(async () => {
  state.site?.close();
  fs.writeFileSync(path.join(OUT, "report.md"), `# Workflow demo\n\n${log.map((l) => `- ${l}`).join("\n")}\n`);
});

describe("A · requirements", () => {
  it("the brief captures goals, audience, type, preferences, functional needs, constraints and motion", () => {
    const brief = fs.readFileSync(path.join(HERE, "brief.md"), "utf8");
    for (const k of [
      "**Goal:**",
      "**Audience:**",
      "**Type:**",
      "**Preferences:**",
      "**Functional:**",
      "**Constraints:**",
    ])
      expect(brief).toContain(k);
    expect(qa.parseBriefMotion(brief).map((i: { id: string }) => i.id)).toEqual(["M1", "M2"]);
    note("A · Requirements: brief.md has all six parts and a Motion block (M1, M2).");
  });
});

describe("B · references (gate 1)", () => {
  it("seeds three synthetic references in the scratch library", async () => {
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const token = fs.readFileSync(path.join(process.env.PIVOT_DATA_DIR!, "api-token"), "utf8").trim();
    for (const f of fs.readdirSync(path.join(HERE, "references")).sort()) {
      await page.goto(pathToFileURL(path.join(HERE, "references", f)).href);
      const png = await page.screenshot();
      const form = new FormData();
      const title = (await page.title()) || f;
      form.append("file", new Blob([png], { type: "image/png" }), `${title}.png`);
      form.append("type", "reference");
      const res = await fetch(`${BASE}/api/upload`, {
        method: "POST",
        body: form,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(201);
      state.refIds.push(...(await res.json()).created);
    }
    await browser.close();
    expect(state.refIds).toHaveLength(3);
    note(`B · Seeded 3 synthetic references (screenshots of local pages): ${state.refIds.join(", ")}`);
  });

  it("finds references through the MCP tools, and says plainly when nothing matches", async () => {
    const found = await call("search_references", { query: "pricing" });
    expect(textOf(found)).toContain("Pricing cards with switch");
    const detail = await call("get_reference", { id: state.refIds[1] });
    expect(detail.isError).toBeFalsy();
    const images = await call("get_reference_images", { id: state.refIds[1] });
    expect(images.content.some((c) => c.type === "image")).toBe(true);
    const none = await call("search_references", { query: "spaceship cockpit hud" });
    expect(none.isError).toBeFalsy();
    expect(textOf(none)).not.toContain("Pricing cards");
    note(
      `B · search_references "pricing" found it; get_reference and get_reference_images returned it; a query with no match returned none: "${textOf(none).slice(0, 80)}"`,
    );
  });

  it("TEST-ONLY gate 1: the references the owner picked (fixture), then the brief is saved", async () => {
    // TEST-ONLY: in the real workflow the agent stops here until the owner picks references in the chat.
    const brief = fs.readFileSync(path.join(HERE, "brief.md"), "utf8");
    const res = await call("save_design_brief", {
      title: "Kettle & Leaf landing page (demo)",
      targetProject: "kettle-and-leaf-site",
      surface: "landing page",
      milestone: "initial",
      markdown: brief,
      referenceIds: state.refIds,
    });
    expect(res.isError).toBeFalsy();
    state.sessionId = (res.structuredContent as { sessionId: string }).sessionId;
    note(`B · TEST-ONLY gate 1 fixture: all three references "picked"; brief saved, session ${state.sessionId}.`);
  });

  it("production gates hold before any approval: no building, no approval without a version", async () => {
    const building = await call("set_design_status", { sessionId: state.sessionId, status: "building" });
    expect(building.isError).toBe(true);
    note(`B · Gate check: set_design_status building before approval → refused: "${textOf(building).slice(0, 90)}"`);
  });
});

describe("C · mockups", () => {
  it("rejects a mockup that reaches outside its folder and stores nothing", async () => {
    const res = await call("save_design_mockups", {
      sessionId: state.sessionId,
      mockups: [{ title: "Broken", path: path.join(HERE, "broken/invalid-asset.html") }],
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/was not saved: .*points outside/);
    const s = await source.getDesignSession(state.sessionId);
    expect(s!.mockups).toHaveLength(0);
    note(`C · Failure path: invalid asset → "${textOf(res).slice(0, 110)}…"; 0 versions stored.`);
  });

  it("saves three directions, the third interactive, with local CSS, SVG and JS inlined", async () => {
    const m = (n: string) => path.join(HERE, "mockups", n);
    const res = await call("save_design_mockups", {
      sessionId: state.sessionId,
      mockups: [
        { title: "Editorial calm", path: m("mockup-1-editorial.html") },
        { title: "Bold cards", path: m("mockup-2-cards.html") },
        { title: "Live tea shop", path: m("mockup-3-live.html"), interactive: true },
      ],
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toMatch(/Interactive versions: 3\..*preview\.mjs/);
    const s = (await source.getDesignSession(state.sessionId))!;
    state.mockups = s.mockups.map((x) => ({ id: x.id, n: x.n, digest: x.digest, interactive: x.interactive }));
    expect(state.mockups.map((x) => x.interactive)).toEqual([false, false, true]);
    const html3 = await (await fetch(`${BASE}/api/design/mockups/${state.mockups[2].id}`)).text();
    expect(html3).not.toMatch(/live\.js|shared\.css|logo\.svg/);
    expect(html3).toContain("setMenu");
    expect(html3).toContain("data:image/svg+xml;base64,");
    note(
      `C · Saved round 1: 3 versions (version 3 interactive); assets inlined; digests ${state.mockups.map((x) => x.digest.slice(0, 12)).join(", ")}.`,
    );
  });
});

describe("D · interactive preview and approval (gate 2)", () => {
  it("previews the stored, digest-checked versions with interactions, widths, reduced motion and compare", async () => {
    const { session, versions } = await pv.loadVersions({ base: BASE, sessionId: state.sessionId });
    expect(versions.map((v: { digest: string }) => v.digest)).toEqual(state.mockups.map((x) => x.digest));
    const preview = await pv.startPreview({
      session,
      versions,
      pivotPage: `${BASE}/design/${state.sessionId}?round=1`,
      headless: true,
    });
    try {
      const page = preview.page();
      await page.waitForSelector("body[data-ready=true]");
      await page.click("[data-tab='2']");
      expect(await page.textContent("#identity")).toContain(`digest ${state.mockups[2].digest.slice(0, 12)}`);
      let f = page.frameLocator("iframe");
      await f.locator("#billing").click();
      expect(await f.locator("[data-monthly='24']").textContent()).toBe("$20");
      await f.locator("#tab-black").click();
      expect(await f.locator("#panel-black").isVisible()).toBe(true);
      await page.waitForTimeout(500);
      await page.screenshot({ path: shot("preview-desktop.png") });
      await page.click("[data-width='phone']");
      f = page.frameLocator("iframe");
      await f.locator("#menu-button").click();
      await page.waitForTimeout(400);
      expect(await f.locator("#drawer").getAttribute("data-open")).toBe("true");
      await page.screenshot({ path: shot("preview-phone-menu.png") });
      await f.locator("#drawer").press("Escape");
      expect(await f.locator("#drawer").getAttribute("data-open")).toBe("false");
      await page.click("[data-motion='reduce']");
      // the switch waits for the browser's emulation, then updates its label
      await page.waitForFunction(() => document.getElementById("media")?.textContent === "This window: reduced motion");
      await page.click("[data-width='desktop']");
      await page.click("#compare");
      await page.waitForTimeout(800);
      await page.screenshot({ path: shot("preview-compare.png") });
      expect(preview.blocked.size).toBe(0);
    } finally {
      await preview.close();
    }
    note(
      "D · Preview: versions loaded from PIVOT and digest-checked; billing switch, tabs and phone menu (Escape closes) worked; reduced-motion emulation and compare worked; the gate blocked nothing because the mockups request nothing. Screenshots: preview-desktop.png, preview-phone-menu.png, preview-compare.png.",
    );
  });

  it("a tampered version is refused by the preview and a wrong digest by PIVOT", async () => {
    const tampered = (url: string) =>
      fetch(url).then(async (r) => (url.includes("/api/design/mockups/") ? new Response(`${await r.text()} `) : r));
    const err = await pv
      .loadVersions({ base: BASE, sessionId: state.sessionId, fetchImpl: tampered })
      .catch((e: Error) => e);
    expect((err as { code?: number }).code).toBe(2);
    const res = await fetch(
      `${BASE}/api/design/mockups/${state.mockups[2].id}/approval-challenge?session=${state.sessionId}&digest=${"0".repeat(64)}`,
    );
    expect(res.status).toBe(409);
    note(
      `D · Failure paths: tampered HTML → preview exit code 2; an approval form for a digest that isn't the stored one → ${res.status}.`,
    );
  });

  it("an agent can't approve: not with the token, forged browser headers, a missing challenge or other routes", async () => {
    const token = fs.readFileSync(path.join(process.env.PIVOT_DATA_DIR!, "api-token"), "utf8").trim();
    const m = state.mockups[2];
    const post = (url: string, headers: Record<string, string>, body: unknown, method = "POST") =>
      fetch(`${BASE}${url}`, { method, headers, body: JSON.stringify(body) });
    const results: string[] = [];
    // 1. the agent's MCP tool has no approval at all
    const viaTool = await call("record_design_decision", {
      sessionId: state.sessionId,
      kind: "approval",
      summary: "TEST-ONLY: the user said yes in the chat",
      mockupId: m.id,
      mockupDigest: m.digest,
    });
    expect(viaTool.isError).toBe(true);
    results.push(`MCP record_design_decision approval → refused`);
    // 2. the decision route with the token
    const viaRoute = await post(
      `/api/design/sessions/${state.sessionId}/decisions`,
      { "content-type": "application/json", authorization: `Bearer ${token}` },
      { kind: "approval", summary: "TEST-ONLY", mockupId: m.id, mockupDigest: m.digest },
    );
    expect(viaRoute.status).toBe(409);
    results.push(`decisions route with token → ${viaRoute.status}`);
    // 3. the approve route with the token, even carrying a valid challenge and the right passphrase
    const c1 = await challengeFor(state.sessionId, m);
    const withToken = await post(
      `/api/design/mockups/${m.id}/approve`,
      { "content-type": "application/json", authorization: `Bearer ${token}` },
      { digest: m.digest, sessionId: state.sessionId, challenge: c1.challenge, passphrase: PASS },
    );
    expect(withToken.status).toBe(403);
    results.push(`approve with token (+ right passphrase) → ${withToken.status}`);
    // 4. forged same-origin browser headers, a valid challenge, no passphrase
    const c2 = await challengeFor(state.sessionId, m);
    const forged = await post(
      `/api/design/mockups/${m.id}/approve`,
      sameOrigin({ referer: `${BASE}/design/${state.sessionId}` }),
      { digest: m.digest, sessionId: state.sessionId, challenge: c2.challenge },
    );
    expect(forged.status).toBe(401);
    results.push(`approve with forged browser headers, no passphrase → ${forged.status}`);
    // 5. no challenge (a forged or cross-site form)
    const noChallenge = await post(`/api/design/mockups/${m.id}/approve`, sameOrigin(), {
      digest: m.digest,
      sessionId: state.sessionId,
      passphrase: PASS,
    });
    expect(noChallenge.status).toBe(409);
    results.push(`approve without a challenge → ${noChallenge.status}`);
    // 6. building and restore with the token
    const building = await post(
      `/api/design/sessions/${state.sessionId}`,
      { "content-type": "application/json", authorization: `Bearer ${token}` },
      { status: "building" },
      "PATCH",
    );
    expect(building.status).toBe(409);
    results.push(`PATCH building with token → ${building.status}`);
    const restore = await post(
      "/api/backup/restore",
      { "content-type": "application/json", authorization: `Bearer ${token}` },
      { dir: "/tmp/forged-backup", passphrase: PASS },
    );
    expect(restore.status).toBe(403);
    results.push(`restore with token → ${restore.status}`);
    const s = (await source.getDesignSession(state.sessionId))!;
    expect(s.status).toBe("exploring");
    expect(s.currentApprovalId).toBeNull();
    note(
      `D · Agent-side approval attempts, all refused; session still exploring with no approval: ${results.join("; ")}.`,
    );
  });

  it("TEST-ONLY gate 2: approved in PIVOT's own page, bound to the previewed digest; the watcher wakes", async () => {
    const watcher = new Promise<string>((resolve) =>
      execFile(
        process.execPath,
        [
          path.join(SKILL, "scripts/wait-for-decision.mjs"),
          state.sessionId,
          "--url",
          BASE,
          "--interval-s",
          "1",
          "--timeout-min",
          "3",
        ],
        (_e, out) => resolve(out),
      ),
    );
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/design/${state.sessionId}?round=1`);
    await page.getByRole("tab", { name: /Live tea shop/ }).click();
    await page.getByText("Interactive version.").waitFor();
    const digestLine = await page.getByText(/Version 3 · digest/).textContent();
    expect(digestLine).toContain(state.mockups[2].digest.slice(0, 12));
    // the frame shows the version's static rendering (its scripts don't run here): wait until it has loaded
    await page.frameLocator("#mockup-panel iframe").locator("h1").waitFor();
    await page.screenshot({ path: shot("pivot-session-interactive.png") });
    // TEST-ONLY: this click stands in for the owner's.
    await page.getByRole("button", { name: /Approve this version/ }).click();
    await page.getByLabel(/Note for the build/).fill("TEST-ONLY approval by the workflow demo, not by the owner.");
    await page.getByLabel("Owner passphrase").fill(PASS); // TEST-ONLY: the scratch instance's passphrase
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.waitForTimeout(400); // let the dialog finish fading in before the evidence screenshot
    await page.screenshot({ path: shot("pivot-approve-dialog.png") });
    await page.getByRole("button", { name: /^Approve$/ }).click();
    await page
      .getByText(/Approved/)
      .first()
      .waitFor();
    await browser.close();
    const s = (await source.getDesignSession(state.sessionId))!;
    const approval = s.decisions.at(-1)!;
    expect(approval).toMatchObject({
      kind: "approval",
      source: "owner",
      binding: { mockupId: state.mockups[2].id, digest: state.mockups[2].digest, status: "bound" },
    });
    const woke = JSON.parse((await watcher).trim().split("\n").at(-1)!);
    expect(woke).toMatchObject({ event: "approved", source: "owner" });
    note(
      `D · TEST-ONLY gate 2: clicked Approve on version 3 in PIVOT's page and typed the scratch passphrase (not the owner); approval bound to ${state.mockups[2].digest.slice(0, 12)} = the digest the preview showed; wait-for-decision woke with ${JSON.stringify(woke).slice(0, 80)}. Screenshot: pivot-session-interactive.png.`,
    );
  });
});

describe("E · implementation", () => {
  it("only after approval: building is accepted, and the approved design is built into the target project", async () => {
    const res = await call("set_design_status", { sessionId: state.sessionId, status: "building" });
    expect(res.isError).toBeFalsy();
    state.project = fs.mkdtempSync(path.join(os.tmpdir(), "kettle-and-leaf-"));
    fs.cpSync(path.join(HERE, "target"), state.project, { recursive: true });
    fs.cpSync(path.join(HERE, "implementation"), state.project, { recursive: true });
    const { server, url } = await serve(state.project);
    state.site = server;
    state.siteUrl = url;
    note(
      `E · building accepted after approval; implementation applied to a copy of the target project (${state.project}) and served at ${url}.`,
    );
  });
});

describe("F · QA", () => {
  it("functional: menu, Escape, billing switch and keyboard tabs work", async () => {
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(state.siteUrl);
    await page.click("#menu-button");
    expect(await page.getAttribute("#drawer", "data-open")).toBe("true");
    await page.keyboard.press("Escape");
    expect(await page.getAttribute("#drawer", "data-open")).toBe("false");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("menu-button");
    await page.click("#billing");
    expect(await page.textContent("[data-monthly='14']")).toBe("$12");
    await page.focus("#tab-green");
    await page.keyboard.press("ArrowRight");
    expect(await page.isVisible("#panel-black")).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-black");
    await browser.close();
    note(
      "F · Functional: menu opens, Escape closes and returns focus, yearly prices apply, ArrowRight moves tabs and focus. Pass.",
    );
  });

  it("responsive: no sideways scroll at phone, tablet and desktop; a broken layout is caught", async () => {
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const overflow = async (url: string, width: number) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (width === 390) await page.screenshot({ path: shot(`impl-${width}.png`), fullPage: true });
      await page.close();
      return o;
    };
    const widths = [390, 768, 1440];
    const ok = await Promise.all(widths.map((w) => overflow(state.siteUrl, w)));
    expect(ok).toEqual([0, 0, 0]);
    // failure path: a plan grid that refuses to shrink
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "kettle-broken-"));
    fs.cpSync(state.project, broken, { recursive: true });
    fs.appendFileSync(path.join(broken, "styles/site.css"), "\n.plans{min-width:1100px}\n");
    const b = await serve(broken);
    const bad = await overflow(b.url, 390);
    b.server.close();
    await browser.close();
    expect(bad).toBeGreaterThan(0);
    note(
      `F · Responsive: overflow at ${widths.join("/")} px = ${ok.join("/")} px (pass); a deliberately broken grid overflowed by ${bad} px at 390 (caught).`,
    );
  });

  it("visual: the build matches the approved, stored mockup at desktop and phone", async () => {
    const sharp = req("sharp");
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const approvedHtml = await (await fetch(`${BASE}/api/design/mockups/${state.mockups[2].id}`)).text();
    expect(pv.mockupDigest(approvedHtml, true)).toBe(state.mockups[2].digest);
    const results: string[] = [];
    for (const [name, width] of [
      ["desktop", 1440],
      ["phone", 390],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const a = await ctx.newPage();
      await a.setContent(approvedHtml);
      const imgA = await a.screenshot();
      const b = await ctx.newPage();
      await b.goto(state.siteUrl);
      const imgB = await b.screenshot();
      await ctx.close();
      const [ra, rb] = await Promise.all([imgA, imgB].map((i) => sharp(i).raw().toBuffer({ resolveWithObject: true })));
      let diff = 0;
      for (let i = 0; i < ra.data.length; i += ra.info.channels)
        if (
          Math.abs(ra.data[i] - rb.data[i]) +
            Math.abs(ra.data[i + 1] - rb.data[i + 1]) +
            Math.abs(ra.data[i + 2] - rb.data[i + 2]) >
          30
        )
          diff++;
      const pct = (100 * diff) / (ra.info.width * ra.info.height);
      fs.writeFileSync(shot(`visual-${name}-mockup.png`), imgA);
      fs.writeFileSync(shot(`visual-${name}-build.png`), imgB);
      results.push(`${name} ${pct.toFixed(2)}%`);
      expect(pct).toBeLessThan(1);
    }
    await browser.close();
    note(
      `F · Visual vs the approved stored mockup (pixels differing): ${results.join(", ")} (threshold 1%). Screenshots: visual-*.png.`,
    );
  });

  it("accessibility: axe finds no serious or critical issue", async () => {
    const axePath = [path.join(REPO, "node_modules/.pnpm/node_modules/axe-core/axe.min.js")].find((p) =>
      fs.existsSync(p),
    );
    expect(axePath, "axe-core isn't installed: accessibility stays Not Verified").toBeTruthy();
    const { chromium } = qa.loadPlaywright();
    const browser = await chromium.launch();
    const found: string[] = [];
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      await page.goto(state.siteUrl);
      await page.addScriptTag({ content: fs.readFileSync(axePath!, "utf8") });
      const r = await page.evaluate(async () =>
        (
          window as unknown as { axe: { run: () => Promise<{ violations: { id: string; impact: string }[] }> } }
        ).axe.run(),
      );
      found.push(
        ...r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${width}:${v.id}`),
      );
      await page.close();
    }
    await browser.close();
    expect(found).toEqual([]);
    note(
      "F · Accessibility (axe-core 4.14, WCAG rules, 1440 and 390, reduced motion): 0 serious or critical violations.",
    );
  });

  it("motion QA: the approved motion passes against the brief; a missing animation fails", async () => {
    const plan = (url: string) => ({
      target: { url },
      viewports: ["desktop", "phone"],
      items: [
        {
          id: "M1",
          name: "Hero entrance",
          tag: "essential",
          trigger: "load",
          target: "#hero h1",
          expect: { animates: true, properties: ["opacity", "transform"], end: { opacity: "1" } },
          reduced: { animates: false, end: { opacity: "1" } },
        },
        {
          id: "M2",
          name: "Tab panel",
          tag: "essential",
          trigger: { type: "click", on: "#tab-black" },
          target: "#panel-black",
          expect: { animates: true, properties: ["opacity"], end: { opacity: "1" } },
          reduced: { animates: false, end: { opacity: "1" } },
        },
      ],
    });
    const brief = fs.readFileSync(path.join(HERE, "brief.md"), "utf8");
    const good = await qa.runPlan(plan(state.siteUrl), { out: path.join(OUT, "motion-qa"), briefText: brief });
    expect(good.overall.status).toBe("Pass");
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "kettle-still-"));
    fs.cpSync(state.project, broken, { recursive: true });
    fs.appendFileSync(path.join(broken, "styles/site.css"), "\n.hero h1{animation:none}\n");
    const b = await serve(broken);
    const bad = await qa.runPlan(plan(b.url), { out: path.join(OUT, "motion-qa-broken"), briefText: brief });
    b.server.close();
    expect(bad.overall.status).toBe("Fail");
    note(
      `F · Motion QA (${good.environment?.browser ?? "Chromium"}): approved build ${good.overall.status}; a build without the hero entrance ${bad.overall.status}. Reports: motion-qa/, motion-qa-broken/.`,
    );
  });

  it("done, and the session reads back after an interruption", async () => {
    const done = await call("set_design_status", { sessionId: state.sessionId, status: "done" });
    expect(done.isError).toBeFalsy();
    const fresh = new HttpSource(BASE); // a new agent session picking the work up
    const s = (await fresh.getDesignSession(state.sessionId))!;
    expect(s.status).toBe("done");
    expect(s.decisions.find((d) => d.kind === "approval")).toMatchObject({ binding: { status: "bound" } });
    note("F · Status done; a fresh client reads the session back: status done, approval still bound.");
  });
});

describe("failure path · stale approval", () => {
  it("a major change after approval resets it: building is refused until a version is approved again", async () => {
    const r = await call("save_design_brief", {
      title: "Stale demo",
      milestone: "initial",
      markdown: "# Stale demo\n\nTEST-ONLY.",
    });
    const sessionId = (r.structuredContent as { sessionId: string }).sessionId;
    await call("save_design_mockups", { sessionId, mockups: [{ title: "Only", html: "<p>only</p>" }] });
    const s1 = (await source.getDesignSession(sessionId))!;
    const { res, body } = await ownerApprove(sessionId, s1.mockups[0], "TEST-ONLY approval to make it stale");
    expect(res.status).toBe(201);
    // the same request again (a replay) is refused: its challenge is spent
    const replay = await fetch(`${BASE}/api/design/mockups/${s1.mockups[0].id}/approve`, {
      method: "POST",
      headers: sameOrigin(),
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(409);
    await call("save_design_brief", {
      sessionId,
      title: "Stale demo",
      milestone: "major_change",
      markdown: "# Stale demo v2\n\nTEST-ONLY.",
      note: "changed",
    });
    const building = await call("set_design_status", { sessionId, status: "building" });
    expect(building.isError).toBe(true);
    note(
      `Failure path · stale approval: a replayed approval request → ${replay.status}; after a major change, building → "${textOf(building).slice(0, 90)}…"`,
    );
  });
});
