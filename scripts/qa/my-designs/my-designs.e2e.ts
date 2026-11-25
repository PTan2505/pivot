// End-to-end run of My designs, Phase 2 (docs/my-designs-plan.md) against a SCRATCH PIVOT (README.md): the agent's
// part over the real MCP server (plugin/server/server.js, over stdio, as Claude Code runs it). A three.js design with
// an SVG and a tokens CSS, written for this run into a temporary project, is saved with save_my_design (its files read
// from disk), rebuilt into another folder with get_my_design writeTo (sha256 compared), found by search_references,
// and its screenshots looked at. Plus the failure paths: a link out of the project, an
// environment file, different code without replaceCode, a rebuild over a file that differs.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertScratch } from "../scratch-guard.mjs";

const REPO = path.resolve(import.meta.dirname, "../../..");
// the MCP client from the MCP server's own dependencies, Playwright from core's (nothing is installed at the root)
const fromPkg = async <T>(pkg: string, spec: string): Promise<T> =>
  import(pathToFileURL(createRequire(path.join(REPO, pkg, "package.json")).resolve(spec)).href) as Promise<T>;
const { Client } = await fromPkg<typeof import("@modelcontextprotocol/sdk/client/index.js")>(
  "apps/mcp",
  "@modelcontextprotocol/sdk/client/index.js",
);
const { StdioClientTransport } = await fromPkg<typeof import("@modelcontextprotocol/sdk/client/stdio.js")>(
  "apps/mcp",
  "@modelcontextprotocol/sdk/client/stdio.js",
);
const { chromium } = await fromPkg<typeof import("playwright")>("packages/core", "playwright");

const BASE = (process.env.PIVOT_URL ?? "").replace(/\/+$/, "");
const DATA = process.env.PIVOT_DATA_DIR ?? "";
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "pivot-my-designs-out-"));
const RUN = Math.random().toString(36).slice(2, 8);
const NAME = `E2E orbit logo ${RUN}`;

// ---- the fixture: a small three.js design, written for this run ----------------------------------------------
const HERO = `import * as THREE from "three";

// The orbit mark: a torus turning behind the SVG mark. “Exact bytes”: tabs\tand non-ASCII ⌘ stay as they are.
export function mountOrbit(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.z = 6;
  const ember = getComputedStyle(document.documentElement).getPropertyValue("--orbit-ember").trim();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 16, 120), new THREE.MeshBasicMaterial({ color: ember }));
  scene.add(ring);
  renderer.setAnimationLoop((t) => {
    ring.rotation.x = t / 1400;
    ring.rotation.y = t / 900;
    renderer.render(scene, camera);
  });
  return () => renderer.setAnimationLoop(null);
}
`;
const TOKENS =
  ":root {\r\n  --orbit-ember: #ff5a1f;\r\n  --orbit-ink: #0c0806;\r\n}\r\n.orbit { background: var(--orbit-ink); }\r\n";
const DEMO = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="./tokens.css" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      .orbit { position: relative; width: min(80vw, 520px); aspect-ratio: 1; border-radius: 24px; }
      .orbit img { position: absolute; inset: 35%; width: 30%; }
      .pulse { animation: pulse 1.2s ease-in-out infinite alternate; }
      @keyframes pulse { to { transform: scale(1.15); } }
    </style>
  </head>
  <body class="orbit">
    <div class="orbit"><canvas></canvas><img class="pulse" src="../../public/orbit-mark.svg" alt="" /></div>
    <script type="module">
      import { mountOrbit } from "./hero.js";
      mountOrbit(document.querySelector("canvas"));
    </script>
  </body>
</html>
`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="#ff5a1f" stroke-width="6"/><circle cx="32" cy="32" r="8" fill="#ff5a1f"/></svg>\n`;
const FILES = [
  { path: "src/orbit/hero.js", role: "component" },
  { path: "src/orbit/tokens.css", role: "style" },
  { path: "src/orbit/index.html", role: "demo" },
];

const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const log: string[] = [];
const note = (line: string) => log.push(line);
let client: InstanceType<typeof Client>;
let work: string;
let project: string;
let shots: string;
let designId = "";

type ToolResult = {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

const saveInput = (over: Record<string, unknown> = {}) => ({
  name: NAME,
  kind: "3d",
  root: project,
  files: FILES,
  assets: ["public/orbit-mark.svg"],
  screenshots: [path.join(shots, "orbit-desktop.png"), path.join(shots, "orbit-mobile.png")],
  video: path.join(shots, "orbit.webm"),
  dependencies: [{ name: "three", version: "0.170.0" }],
  install: ["npm install three@0.170.0"],
  usage:
    "Mount `mountOrbit(canvas)` on a square canvas inside `.orbit`; load `tokens.css` first. The SVG mark sits on top at 30% of the box.",
  tokens: [
    { name: "--orbit-ember", value: "#ff5a1f" },
    { name: "--orbit-ink", value: "#0c0806" },
  ],
  sourceProject: "pivot-e2e-orbit",
  facets: [{ kind: "technology", name: "Three.js" }],
  ...over,
});

beforeAll(async () => {
  await assertScratch({ base: BASE, dataDir: DATA });
  fs.mkdirSync(OUT, { recursive: true });
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pivot-my-designs-e2e-")));
  project = path.join(work, "orbit-site");
  shots = path.join(work, "shots");
  fs.mkdirSync(path.join(project, "src/orbit"), { recursive: true });
  fs.mkdirSync(path.join(project, "public"), { recursive: true });
  fs.mkdirSync(shots);
  fs.writeFileSync(path.join(project, "src/orbit/hero.js"), HERO);
  fs.writeFileSync(path.join(project, "src/orbit/tokens.css"), TOKENS);
  fs.writeFileSync(path.join(project, "src/orbit/index.html"), DEMO);
  fs.writeFileSync(path.join(project, "public/orbit-mark.svg"), SVG);
  // TEST-ONLY: a fake environment file, and a file outside the project linked from inside it
  fs.writeFileSync(path.join(project, ".env"), "ORBIT_TOKEN=not-a-real-token\n");
  fs.writeFileSync(path.join(work, "outside.js"), "export const outside = true;\n");
  fs.symlinkSync(path.join(work, "outside.js"), path.join(project, "src/orbit/linked.js"));

  // the original, as the owner saw it: desktop and phone screenshots, and a short video (three.js isn't installed in
  // this throwaway project, so the ring doesn't draw; the tokens, the SVG and its pulse do)
  const browser = await chromium.launch();
  const url = pathToFileURL(path.join(project, "src/orbit/index.html")).href;
  for (const [name, width, height] of [
    ["orbit-desktop.png", 1440, 900],
    ["orbit-mobile.png", 390, 844],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url);
    await page.screenshot({ path: path.join(shots, name) });
    await page.close();
  }
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 600 },
    recordVideo: { dir: shots, size: { width: 800, height: 600 } },
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(1500);
  const video = page.video()!;
  await ctx.close();
  fs.renameSync(await video.path(), path.join(shots, "orbit.webm"));
  await browser.close();

  const server = path.join(REPO, "plugin/server/server.js");
  client = new Client({ name: "pivot-my-designs-e2e", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), PIVOT_URL: BASE, PIVOT_DATA_DIR: DATA },
      stderr: "ignore",
    }),
  );
});

afterAll(async () => {
  await client?.close();
  fs.writeFileSync(
    path.join(OUT, "report.md"),
    `# My designs e2e (${new Date().toISOString()})\n\n${log.join("\n")}\n`,
  );
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

describe("My designs, end to end", () => {
  it("the MCP server offers both tools, and the design isn't saved yet", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_my_design", "get_my_design"]));
    const r = await call("get_my_design", { name: NAME });
    expect(r.structuredContent).toMatchObject({ found: false });
    note(`1. MCP (stdio, plugin/server/server.js): both tools listed; get_my_design "${NAME}" → found false`);
  });

  it("refuses a link out of the project and an environment file, and saves nothing", async () => {
    for (const [p, why] of [
      ["src/orbit/linked.js", /is a link to .*outside\.js, outside/],
      [".env", /it is an environment file/],
    ] as const) {
      const r = await call("save_my_design", saveInput({ files: [...FILES, { path: p, role: "support" }] }));
      expect(r.isError, p).toBe(true);
      expect(textOf(r), p).toMatch(why);
    }
    const found = await call("search_references", { query: NAME, types: ["my_design"] });
    expect(found.structuredContent).toMatchObject({ total: 0 });
    note("2. refused before any save: a link to a file outside the project, and .env; nothing was saved");
  });

  it("save_my_design reads the files from disk and keeps the SVG, the screenshots and the video", async () => {
    const r = await call("save_my_design", saveInput());
    expect(r.isError, textOf(r)).toBeFalsy();
    const s = r.structuredContent as {
      outcome: string;
      id: string;
      files: { path: string; sha256: string }[];
      added: string[];
      failed: string[];
      assets: { path: string; sha256: string }[];
    };
    expect(s.outcome).toBe("created");
    expect(s.failed).toEqual([]);
    expect(s.added).toEqual([
      "public/orbit-mark.svg",
      "screenshot orbit-desktop.png (desktop)",
      "screenshot orbit-mobile.png (mobile)",
      "video orbit.webm",
    ]);
    for (const f of s.files) expect(f.sha256, f.path).toBe(sha(path.join(project, f.path)));
    expect(s.assets[0]).toMatchObject({
      path: "public/orbit-mark.svg",
      sha256: sha(path.join(project, "public/orbit-mark.svg")),
    });
    designId = s.id;
    note(
      `3. save_my_design → created ${designId}: 3 code files (sha256 equal to the originals), the SVG, 2 screenshots (desktop, mobile), the video`,
    );
  });

  it("refuses different code without replaceCode (409), and changes nothing", async () => {
    fs.writeFileSync(path.join(project, "src/orbit/tokens.css"), TOKENS.replace("#ff5a1f", "#00ff00"));
    try {
      const r = await call("save_my_design", saveInput({ id: designId }));
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/^conflict: /);
      expect(textOf(r)).toMatch(/replaceCode: true only when the owner asked/);
    } finally {
      fs.writeFileSync(path.join(project, "src/orbit/tokens.css"), TOKENS);
    }
    const again = await call("save_my_design", saveInput({ id: designId, screenshots: [], video: undefined }));
    expect(again.isError, textOf(again)).toBeFalsy();
    expect(textOf(again)).toContain("Already saved, unchanged: public/orbit-mark.svg");
    note(
      "4. different code without replaceCode → conflict, nothing changed; the same code again → no new upload of the SVG",
    );
  });

  it("get_my_design writeTo rebuilds it byte for byte, and never overwrites a file that differs", async () => {
    const target = path.join(work, "rebuild");
    fs.mkdirSync(target);
    const r = await call("get_my_design", { id: designId, writeTo: target });
    expect(r.isError, textOf(r)).toBeFalsy();
    expect(textOf(r)).toContain(`${NAME} — 3d · saved `);
    expect(textOf(r)).toContain("three@0.170.0");
    for (const p of [...FILES.map((f) => f.path), "public/orbit-mark.svg"])
      expect(sha(path.join(target, p)), p).toBe(sha(path.join(project, p)));
    note(`5. get_my_design writeTo → 3 code files and the SVG written; sha256 of all 4 equal to the originals`);

    const other = path.join(work, "rebuild-conflict");
    fs.mkdirSync(path.join(other, "src/orbit"), { recursive: true });
    fs.writeFileSync(path.join(other, "src/orbit/tokens.css"), ":root { --orbit-ember: red; }\n");
    const blocked = await call("get_my_design", { id: designId, writeTo: other });
    expect(textOf(blocked)).toMatch(/NOTHING WAS WRITTEN .*src\/orbit\/tokens\.css/);
    expect(fs.readFileSync(path.join(other, "src/orbit/tokens.css"), "utf8")).toBe(":root { --orbit-ember: red; }\n");
    expect(fs.existsSync(path.join(other, "src/orbit/hero.js"))).toBe(false);
    note("6. writeTo over a folder with a different tokens.css → nothing written, the file listed, left as it was");
  });

  it("search_references finds it, marked Yours; its screenshots can be looked at", async () => {
    const found = await call("search_references", { query: NAME, types: ["my_design"] });
    expect((found.structuredContent as { results: { id: string }[] }).results.map((h) => h.id)).toContain(designId);
    expect(textOf(found)).toContain(`${NAME} — My design — Yours (3d)`);
    const ref = await call("get_reference", { id: designId });
    expect(textOf(ref)).toMatch(/get_my_design \(id .*\) gives its files/);
    const images = await call("get_reference_images", { id: designId, which: "shots" });
    expect(images.content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(textOf(images)).toMatch(/\(desktop\)[\s\S]*\(mobile\)/);
    note(
      "7. search_references in My designs → found, marked Yours (3d); get_reference points to get_my_design; get_reference_images shots → desktop and mobile",
    );
  });
});
