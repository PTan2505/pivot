// The builder repo's files (builder/): the committed bundle matches the source, the workflow takes the job only as a
// link, and the bundle itself runs a job end to end (an HTML design, which needs no npm, so the test stays offline).
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeJob, type WireJob, type WireResult } from "../src/build-page";
import { BUILDER_DIR, bundleBuilder, OUTPUT } from "../scripts/build-builder.mjs";

const read = (f: string) => fs.readFileSync(path.join(BUILDER_DIR, f), "utf8");

describe("the builder repo's files", () => {
  it("hold the current bundle of the builder (pnpm builder:build writes it)", async () => {
    expect(fs.readFileSync(OUTPUT, "utf8") === (await bundleBuilder())).toBe(true);
  });

  it("install the esbuild, Tailwind and Playwright versions PIVOT builds with, from the lockfile", () => {
    const req = createRequire(path.resolve(__dirname, "../package.json"));
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    for (const name of ["esbuild", "playwright", "tailwindcss"]) {
      const version = JSON.parse(fs.readFileSync(req.resolve(`${name}/package.json`), "utf8")).version;
      expect(pkg.dependencies[name], name).toBe(version);
      expect(lock.packages[`node_modules/${name}`].version, name).toBe(version);
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["esbuild", "playwright", "tailwindcss"]);
  });

  it("run the bundle with the job's link from the environment, never inside a script, with read-only rights", () => {
    const wf = read(".github/workflows/build.yml");
    expect(wf).toMatch(/run-name: build \$\{\{ inputs\.id \}\}/);
    expect(wf).toMatch(/permissions:\n {2}contents: read/);
    expect(wf).toMatch(/npm ci --ignore-scripts/);
    expect(wf).toMatch(/- run: node build\.mjs\n {8}env:\n {10}PIVOT_JOB_URL: \$\{\{ inputs\.job \}\}/);
    // pictures: Playwright's ffmpeg for the video, the runner's Google Chrome for the browser
    expect(wf).toMatch(/npx playwright install ffmpeg/);
    expect(wf).toMatch(/PIVOT_RECORD_CHANNEL: chrome/);
    // an input expanded inside a run line could inject shell commands
    for (const line of wf.split("\n").filter((l) => /^\s*- run:/.test(l))) expect(line).not.toContain("${{");
  });
});

describe("the bundled builder", () => {
  it("builds a job from its link and writes the page, then the result", async () => {
    // the bundle next to the two packages it leaves outside, as `npm ci` installs them in the builder repo
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-builder-"));
    const req = createRequire(path.resolve(__dirname, "../package.json"));
    await fsp.mkdir(path.join(dir, "node_modules"));
    for (const name of ["esbuild", "tailwindcss"])
      await fsp.symlink(path.dirname(req.resolve(`${name}/package.json`)), path.join(dir, "node_modules", name));
    await fsp.copyFile(OUTPUT, path.join(dir, "build.mjs"));

    const puts: Record<string, { type: string; body: string }> = {};
    let job: WireJob | null = null;
    const server = http.createServer((rq, rs) => {
      const chunks: Buffer[] = [];
      rq.on("data", (c) => chunks.push(c));
      rq.on("end", () => {
        if (rq.method === "GET" && rq.url === "/job") {
          rs.setHeader("Content-Type", "application/json");
          return rs.end(JSON.stringify(job));
        }
        if (rq.method === "PUT") {
          puts[rq.url!] = { type: String(rq.headers["content-type"]), body: Buffer.concat(chunks).toString("utf8") };
          return rs.end();
        }
        rs.statusCode = 404;
        rs.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    job = {
      version: 1,
      id: "t1",
      job: encodeJob({
        kind: "html",
        html: "index.html",
        deps: [],
        files: [
          {
            path: "index.html",
            role: "demo",
            code: '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Builder test</h1><script type="module" src="main.js"></script></body></html>',
          },
          {
            path: "main.js",
            role: "component",
            code: 'import { label } from "./label.js";\ndocument.title = label;\n',
          },
          { path: "label.js", role: "support", code: 'export const label = "Bundled label";\n' },
          { path: "style.css", role: "support", code: "h1 { letter-spacing: 7px; }\n" },
        ],
        binary: [{ path: "dot.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }],
      }),
      upload: { page: `${base}/page`, result: `${base}/result` },
    };
    try {
      const code = await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, ["build.mjs"], {
          cwd: dir,
          env: { PATH: process.env.PATH, PIVOT_JOB_URL: `${base}/job` },
          stdio: "ignore",
        });
        child.on("exit", (c) => resolve(c ?? 1));
      });
      expect(code).toBe(0);
      const result = JSON.parse(puts["/result"].body) as WireResult;
      expect(result).toMatchObject({ ok: true });
      expect(puts["/page"].type).toBe("text/html; charset=utf-8");
      const page = puts["/page"].body;
      expect(page).toContain("<h1>Builder test</h1>");
      expect(page).toContain("Bundled label"); // the module and its import, bundled by esbuild
      expect(page).toContain("letter-spacing:7px"); // the stylesheet, inlined
      expect(page).not.toMatch(/<script[^>]+src=/);
      // the work folder is removed
      expect(fs.existsSync(path.join(dir, "work"))).toBe(false);
    } finally {
      server.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
