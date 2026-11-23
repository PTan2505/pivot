// End-to-end run of the component store (docs/component-store-plan.md, Phase 6) against a SCRATCH PIVOT (README.md):
// the agent's part over the real MCP server (plugin/server/server.js, over stdio, as Claude Code runs it) → saved and
// looked up → the component's page → Build preview (the real npm, from registry.npmjs.org) → the live preview in its
// frame on the preview origin. Plus the failure paths: a key in the install command, different code without
// replaceCode, a rejected component.
//
// The component is a fixture written for this run: no 21st code, and no 21st retrieval is spent. Its 21st id and page
// are made up.
import { spawnSync } from "node:child_process";
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
type Browser = Awaited<ReturnType<typeof chromium.launch>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;
const BASE = (process.env.PIVOT_URL ?? "").replace(/\/+$/, "");
const DATA = process.env.PIVOT_DATA_DIR ?? "";
const OUT = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "pivot-component-store-"));
/** Made up for this run, far from any real 21st id. */
const ID = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const PAGE_URL = `https://21st.dev/@pivot-e2e/components/e2e-badge-${ID}`;

const BADGE = `import { cn } from "@/lib/utils";

export function E2EBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-5 py-2 text-3xl font-semibold", className)}>
      {label}
    </span>
  );
}
`;
const DEMO = `import { E2EBadge } from "@/components/ui/e2e-badge";

export default function E2EBadgeDemo() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <E2EBadge label="Built by PIVOT" className="bg-primary text-primary-foreground" />
    </div>
  );
}
`;
const UTILS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
const FILES = [
  { path: "components/ui/e2e-badge.tsx", role: "component", language: "tsx", code: BADGE },
  { path: "demo.tsx", role: "demo", language: "tsx", code: DEMO },
];
const BASE_INPUT = {
  provider: "21st",
  providerId: ID,
  name: "E2E Badge",
  pageUrl: PAGE_URL,
  author: { username: "pivot-e2e" },
  licence: { spdx: "MIT", source: "component_page" },
  npmDependencies: [
    { name: "clsx", version: "^2.1.1" },
    { name: "tailwind-merge", version: "^3.0.0" },
  ],
  // TEST-ONLY placeholder key, the shape 21st's commands have: PIVOT must replace it
  installCommand: `npx shadcn@latest add "https://21st.dev/r/pivot-e2e/e2e-badge?api_key=an_e2e_fake_key_0000"`,
};

const log: string[] = [];
const note = (line: string) => log.push(line);
let client: InstanceType<typeof Client>;
let browser: Browser;
let page: Page;
let componentId = "";

type ToolResult = {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
const call = async (name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;
const textOf = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("\n");

beforeAll(async () => {
  await assertScratch({ base: BASE, dataDir: DATA });
  fs.mkdirSync(OUT, { recursive: true });
  const server = path.join(REPO, "plugin/server/server.js");
  client = new Client({ name: "pivot-component-store-e2e", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: { PATH: process.env.PATH ?? "", HOME: os.homedir(), PIVOT_URL: BASE, PIVOT_DATA_DIR: DATA },
      stderr: "ignore",
    }),
  );
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
});

afterAll(async () => {
  await browser?.close();
  await client?.close();
  fs.writeFileSync(
    path.join(OUT, "report.md"),
    `# Component store e2e (${new Date().toISOString()})\n\n${log.join("\n")}\n`,
  );
});

describe("the component store, end to end", () => {
  it("the MCP server offers both tools, and nothing is saved yet", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["save_component", "get_saved_component"]));
    const r = await call("get_saved_component", { providerId: ID });
    expect(r.structuredContent).toMatchObject({ found: false });
    note(`1. MCP (stdio, plugin/server/server.js): both tools listed; get_saved_component ${ID} → found false`);
  });

  it("saves right after the fetch, with the key replaced and the code scanned", async () => {
    const r = await call("save_component", { ...BASE_INPUT, files: FILES, status: "fetched" });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as { outcome: string; id: string; status: string; codeSha256: string };
    expect(s).toMatchObject({ outcome: "created", status: "fetched" });
    componentId = s.id;
    const saved = await (await fetch(`${BASE}/api/resources/${componentId}`)).json();
    expect(saved.type).toBe("component");
    expect(saved.meta.component.installCommand).toContain("api_key=$API_KEY_21ST");
    expect(JSON.stringify(saved)).not.toContain("an_e2e_fake_key");
    note(`2. save_component (fetched) → created ${componentId}; the install command's key became $API_KEY_21ST`);
  });

  it("refuses different code without replaceCode, and a command that still holds a secret", async () => {
    const changed = await call("save_component", {
      ...BASE_INPUT,
      files: [{ ...FILES[0], code: BADGE.replace("text-3xl", "text-2xl") }, FILES[1]],
      status: "fetched",
    });
    expect(changed.isError).toBe(true);
    expect(textOf(changed)).toMatch(/replaceCode|different code/i);
    const secret = await call("save_component", {
      ...BASE_INPUT,
      providerId: ID + 1,
      pageUrl: `${PAGE_URL}-x`,
      files: FILES,
      installCommand: `GITHUB_TOKEN=ghp_${"a".repeat(36)} npx shadcn@latest add x`,
      status: "fetched",
    });
    expect(secret.isError).toBe(true);
    note("3. different code without replaceCode → refused; an install command holding a token → refused");
  });

  it("saves again once built, with the review and the support file the build needed", async () => {
    const r = await call("save_component", {
      ...BASE_INPUT,
      files: [...FILES, { path: "lib/utils.ts", role: "support", language: "ts", code: UTILS }],
      status: "built",
      project: "pivot-e2e-fixture",
      review: { verdict: "clean", notes: "TEST-ONLY fixture: renders a span, no network, no storage, no eval." },
    });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ outcome: "updated", status: "built", id: componentId });
    expect(textOf(r)).toMatch(/Build preview/);
    note("4. save_component (built, review clean, support file) → updated; the answer offers Build preview");
  });

  it("a later use reads it from PIVOT by its 21st id, its page and its PIVOT id", async () => {
    for (const q of [{ providerId: ID }, { pageUrl: PAGE_URL }, { resourceId: componentId }]) {
      const r = await call("get_saved_component", q);
      const s = r.structuredContent as { found: boolean; id: string; component: { files: { path: string }[] } };
      expect(s.found).toBe(true);
      expect(s.id).toBe(componentId);
      expect(s.component.files.map((f) => f.path)).toEqual(
        expect.arrayContaining(["components/ui/e2e-badge.tsx", "demo.tsx", "lib/utils.ts"]),
      );
      expect(textOf(r)).toContain("spends no retrieval");
    }
    note("5. get_saved_component by 21st id, page URL and PIVOT id → found, with all three files");
  });

  it("the page shows it, builds its preview with the real npm, and runs it on the preview origin", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/r/${componentId}`);
    await page.getByText("@pivot-e2e").first().waitFor();
    await page.screenshot({ path: path.join(OUT, "1-page-before-build.png") });
    const build = page.getByRole("button", { name: /Build preview/ });
    await build.click();
    await page
      .getByText(/Building/)
      .first()
      .waitFor();
    // the real npm install (clsx, tailwind-merge, react, react-dom) and the build
    const frame = page.locator("iframe[title]");
    await frame.waitFor({ timeout: 240_000 });
    const src = (await frame.getAttribute("src")) ?? "";
    const previewOrigin = new URL(src).origin;
    expect(previewOrigin).not.toBe(new URL(BASE).origin);
    expect(src).toMatch(/\/p\/[0-9a-f]{64}\.html/);
    expect(await frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    const inner = page.frameLocator("iframe[title]");
    const badge = inner.getByText("Built by PIVOT");
    await badge.waitFor({ timeout: 30_000 });
    const size = await badge.evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe("30px"); // text-3xl, compiled by Tailwind from the saved files
    await page.screenshot({ path: path.join(OUT, "2-page-live-preview.png") });
    const saved = await (await fetch(`${BASE}/api/resources/${componentId}`)).json();
    expect(saved.meta.component.preview).toMatchObject({ status: "ready", sha256: expect.any(String) });
    // the build folder is gone
    const builds = path.join(DATA, "component-builds");
    expect(fs.existsSync(builds) ? fs.readdirSync(builds) : []).toEqual([]);
    expect(errors).toEqual([]);
    note(
      `6. /r/${componentId}: Build preview → Building… → ready; the frame loads ${previewOrigin} (sandboxed), the badge renders at 30px (text-3xl); the build folder is removed`,
    );
  }, 300_000);

  it("the preview origin serves that page and nothing else", async () => {
    const saved = await (await fetch(`${BASE}/api/resources/${componentId}`)).json();
    const sha = saved.meta.component.preview.sha256 as string;
    const { port } = await (await fetch(`${BASE}/api/components/preview-origin`)).json();
    const origin = `http://127.0.0.1:${port}`;
    const ok = await fetch(`${origin}/p/${sha}.html`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(ok.headers.get("set-cookie")).toBeNull();
    expect((await fetch(`${origin}/api/resources`)).status).toBe(404);
    expect((await fetch(`${origin}/p/${"0".repeat(64)}.html`)).status).toBe(404);
    expect((await fetch(`${origin}/p/${sha}.html`, { method: "POST" })).status).toBe(405);
    note(
      `7. ${origin}: the preview 200 with connect-src 'none' and no cookie; the API, an unknown sha and POST refused`,
    );
  });

  it("a rejected component offers no build, and the API refuses one", async () => {
    const rid = ID + 2;
    const r = await call("save_component", {
      ...BASE_INPUT,
      providerId: rid,
      pageUrl: `${PAGE_URL}-rejected`,
      name: "E2E Rejected",
      files: FILES,
      status: "fetched",
      review: { verdict: "rejected", notes: "TEST-ONLY: the user turned it down." },
    });
    const id = (r.structuredContent as { id: string }).id;
    expect(textOf(r)).toMatch(/don't build it/i);
    const again = await call("get_saved_component", { providerId: rid });
    expect(textOf(again)).toMatch(/THE USER REJECTED THIS COMPONENT/);
    await page.goto(`${BASE}/r/${id}`);
    await page.getByText("@pivot-e2e").first().waitFor();
    await page
      .getByText(/Rejected/)
      .first()
      .waitFor();
    expect(await page.getByRole("button", { name: /Build preview/ }).count()).toBe(0);
    const res = await fetch(`${BASE}/api/components/${id}/preview`, {
      method: "POST",
      headers: { origin: BASE, "sec-fetch-site": "same-origin" },
    });
    expect(res.status).toBe(400);
    await page.screenshot({ path: path.join(OUT, "3-rejected.png") });
    note("8. a rejected component: get_saved_component warns, the page has no Build preview, the API answers 400");
  });

  it("npm is the one on this machine", () => {
    const v = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], { encoding: "utf8" });
    note(`npm ${v.stdout.trim()}, Node ${process.version}, ${process.platform}-${process.arch}`);
  });
});
