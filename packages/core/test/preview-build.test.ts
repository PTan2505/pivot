// Building a component's preview on this machine (docs/component-store-plan.md, Phase 5). The components here are
// fixtures written for the test (no 21st code), and the npm install is stubbed with React from this checkout and a
// fake package, so the tests run offline; one test runs the real npm on a local package to prove install scripts
// never run.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let comps: typeof import("../src/components");
let build: typeof import("../src/preview-build");
let preview: typeof import("../src/component-preview");
let server: typeof import("../src/preview-server");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");
const installs: string[] = [];

const webRequire = createRequire(path.resolve(__dirname, "../../../apps/web/package.json"));
const pkgDir = (name: string) => path.dirname(webRequire.resolve(`${name}/package.json`));

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-build-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  comps = await import("../src/components");
  build = await import("../src/preview-build");
  preview = await import("../src/component-preview");
  server = await import("../src/preview-server");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
  // offline npm: React and React DOM from this checkout, and a fake package standing in for an npm dependency
  build.buildDeps.npmInstall = async (dir: string) => {
    installs.push(dir);
    const nm = path.join(dir, "node_modules");
    await fsp.mkdir(nm, { recursive: true });
    for (const name of ["react", "react-dom", "scheduler"]) {
      await fsp.symlink(pkgDir(name), path.join(nm, name), "junction").catch(() => {});
    }
    await fsp.mkdir(path.join(nm, "fixture-greeting"), { recursive: true });
    await fsp.writeFile(
      path.join(nm, "fixture-greeting", "package.json"),
      JSON.stringify({ name: "fixture-greeting", version: "1.0.0", main: "index.js" }),
    );
    await fsp.writeFile(path.join(nm, "fixture-greeting", "index.js"), 'exports.greet = (n) => "Hello, " + n;');
  };
});
afterAll(async () => {
  await db.closeDb();
  await fsp.rm(tmp, { recursive: true, force: true });
});

const BADGE = `import { cn } from "@/lib/utils";
import { greet } from "fixture-greeting";

export function Badge({ name, className }: { name: string; className?: string }) {
  return <span className={cn("inline-flex rounded-lg px-3 py-1 text-4xl font-medium", className)}>{greet(name)}</span>;
}
`;
const DEMO = `import { Badge } from "@/components/ui/badge";

export default function BadgeDemo() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Badge name="PIVOT" className="bg-primary text-primary-foreground" />
    </div>
  );
}
`;
const UTILS = `export function cn(...c: (string | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
`;

let nextId = 81000;
const save = async (over: Record<string, unknown> = {}) =>
  (
    await comps.saveComponent({
      provider: "21st",
      providerId: ++nextId,
      name: "Badge",
      pageUrl: `https://21st.dev/@tester/components/badge-${nextId}`,
      author: { username: "tester" },
      licence: { spdx: "MIT", source: "component_page" },
      files: [
        { path: "components/ui/badge.tsx", role: "component", language: "tsx", code: BADGE },
        { path: "demo.tsx", role: "demo", language: "tsx", code: DEMO },
        { path: "lib/utils.ts", role: "support", language: "ts", code: UTILS },
      ],
      npmDependencies: [{ name: "fixture-greeting", version: "^1.0.0" }],
      status: "built",
      ...over,
    })
  ).resource;

const previewOf = async (id: string) =>
  ((await resources.getResource(id))!.meta.component as { preview?: Record<string, unknown> }).preview;

describe("building a preview", () => {
  it("bundles the demo, its support files and npm packages with Tailwind into one HTML file, then cleans up", async () => {
    const r = await save();
    const started = await build.startComponentPreviewBuild(r.id);
    expect(started.status).toBe("building");
    expect(await previewOf(r.id)).toMatchObject({ status: "building" });
    await started.done;
    const p = await previewOf(r.id);
    expect(p).toMatchObject({ status: "ready", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const asset = (await preview.findPreviewAsset(p!.sha256 as string))!;
    const html = fs.readFileSync(path.join(tmp, "data", asset.storagePath), "utf8");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script[^>]+src=/); // everything inline
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain(".text-4xl"); // Tailwind compiled from the classes in the files
    expect(html).toContain("--primary:"); // shadcn's theme variables
    expect(html).toContain("Hello, "); // the npm dependency was bundled
    expect(html).toContain("21st-preview-ready");
    // the build folder is removed after the build
    expect(fs.existsSync(installs.at(-1)!)).toBe(false);
  });

  it("keeps a failed build's error, and the last good preview", async () => {
    const r = await save({
      files: [
        { path: "components/ui/badge.tsx", role: "component", language: "tsx", code: BADGE },
        { path: "demo.tsx", role: "demo", language: "tsx", code: DEMO },
      ],
    });
    await (
      await build.startComponentPreviewBuild(r.id)
    ).done;
    const p = await previewOf(r.id);
    expect(p).toMatchObject({ status: "failed" });
    expect(p!.error).toMatch(/Could not resolve "@\/lib\/utils".*save it as a support file/s);
    expect(p!.sha256).toBeUndefined();

    const ok = await save();
    await (
      await build.startComponentPreviewBuild(ok.id)
    ).done;
    const good = (await previewOf(ok.id))!.sha256;
    build.buildDeps.npmInstall = (async () => {
      throw new preview.PreviewError("Installing the npm packages failed: E404 fixture");
    }) as typeof build.buildDeps.npmInstall;
    try {
      await (
        await build.startComponentPreviewBuild(ok.id)
      ).done;
    } finally {
      build.buildDeps.npmInstall = installStub;
    }
    expect(await previewOf(ok.id)).toMatchObject({
      status: "failed",
      sha256: good,
      error: expect.stringMatching(/E404/),
    });
  });

  it("never builds a rejected component, and builds one at a time", async () => {
    const rejected = await save({ review: { verdict: "rejected", notes: "Runs fetched code." } });
    await expect(build.startComponentPreviewBuild(rejected.id)).rejects.toThrow(/rejected/);
    const a = await save();
    const b = await save();
    const first = await build.startComponentPreviewBuild(a.id);
    await expect(build.startComponentPreviewBuild(b.id)).rejects.toThrow(/Another preview is building/);
    await first.done;
    expect(build.isBuilding()).toBe(false);
    const ref = await resources.createResource({ type: "reference", title: "R", sourceUrl: "https://a.dev" });
    await expect(build.startComponentPreviewBuild(ref.id)).rejects.toThrow(/No such component/);
  });

  it("takes class candidates from every file, and compiles only Tailwind's own stylesheets", async () => {
    expect(build.candidatesOf([{ code: '<div className="p-4 dark:bg-red-500 md:flex">' }])).toEqual(
      expect.arrayContaining(["p-4", "dark:bg-red-500", "md:flex"]),
    );
    const css = await build.tailwindCss(["p-4", "dark:bg-red-500"]);
    expect(css).toContain(".p-4");
    expect(css).toContain(".dark\\:bg-red-500");
  });
});

let installStub: typeof build.buildDeps.npmInstall;
beforeAll(() => {
  installStub = build.buildDeps.npmInstall;
});

// ---- the real npm: install scripts never run --------------------------------------------------------------------

const hasNpm = (() => {
  try {
    return require("node:child_process").spawnSync("npm", ["--version"]).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasNpm)("npm install in a build folder", () => {
  it("never runs a package's install scripts", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-npm-"));
    const marker = path.join(dir, "SCRIPT-RAN");
    try {
      await fsp.mkdir(path.join(dir, "evil"));
      await fsp.writeFile(
        path.join(dir, "evil", "package.json"),
        JSON.stringify({
          name: "evil",
          version: "1.0.0",
          scripts: {
            preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'pre')"`,
            install: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'install')"`,
            postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'post')"`,
          },
        }),
      );
      await fsp.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "t", private: true, dependencies: { evil: "file:./evil" } }),
      );
      await fsp.writeFile(path.join(dir, ".npmrc"), "ignore-scripts=true\n");
      await build.runNpmInstall(dir, 60_000);
      expect(fs.existsSync(path.join(dir, "node_modules", "evil", "package.json"))).toBe(true);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

// ---- the built page runs in Chromium, offline, from the preview origin -----------------------------------------

const { playwrightStatus, closeCaptureBrowser } = await import("../src/capture");
const browser = await playwrightStatus();

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

describe.skipIf(!browser.installed)("the built preview in Chromium", () => {
  afterAll(() => closeCaptureBrowser());
  it("renders the demo with its Tailwind styles and the dark theme, with no network", async () => {
    const r = await save();
    await (
      await build.startComponentPreviewBuild(r.id)
    ).done;
    const sha = (await previewOf(r.id))!.sha256 as string;
    const port = await freePort();
    const srv: http.Server = server.createPreviewServer({ port, appPort: port - 1 });
    await new Promise<void>((ok) => srv.listen(port, "127.0.0.1", ok));
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      const outside: string[] = [];
      page.on("request", (req) => {
        if (!req.url().startsWith(`http://127.0.0.1:${port}/`) && !req.url().startsWith("data:"))
          outside.push(req.url());
      });
      await page.goto(`http://127.0.0.1:${port}/p/${sha}.html?theme=dark`);
      await page.waitForSelector("text=Hello, PIVOT");
      const s = await page.evaluate(() => {
        const el = [...document.querySelectorAll("span")].find((x) => x.textContent === "Hello, PIVOT")!;
        const cs = getComputedStyle(el);
        return { size: cs.fontSize, weight: cs.fontWeight, dark: document.documentElement.classList.contains("dark") };
      });
      expect(s).toEqual({ size: "36px", weight: "500", dark: true });
      await page.goto(`http://127.0.0.1:${port}/p/${sha}.html?theme=light`);
      await page.waitForSelector("text=Hello, PIVOT");
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
      expect(outside).toEqual([]);
    } finally {
      await b.close();
      await new Promise<void>((ok) => srv.close(() => ok()));
    }
  }, 60_000);
});
