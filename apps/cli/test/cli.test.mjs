// The pivot-studio CLI without a built server: options, the launch refusals, the links to native packages, doctor,
// passphrase and extension. The package itself (npm pack, npx, a real start) is checked by hand; see apps/cli/README.md.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { builtVersion, externalsOf, REQUIRED, RUNTIME } from "../build.mjs";
import { parseArgs } from "../lib/args.mjs";
import { BUILDER_FILES, blobSha, setEnvValue, setupBuilder } from "../lib/builder.mjs";
import { checks } from "../lib/doctor.mjs";
import { installExtension } from "../lib/extension.mjs";
import { linkExternals } from "../lib/externals.mjs";
import { writeInstallInfo } from "../lib/install-info.mjs";
import { dist, resolveDataDir } from "../lib/paths.mjs";
import { previewPortFor, serverEnv } from "../lib/start.mjs";
import { packageFiles } from "../release-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "../bin/pivot-studio.mjs");
const pkg = JSON.parse(fs.readFileSync(path.resolve(here, "../package.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-studio-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const dir = (name) => fs.mkdtempSync(path.join(tmp, `${name}-`));

/** Runs the CLI with a throwaway HOME and data folder; resolves with the exit code and output, never throws. */
function cli(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [bin, ...args],
      { env: { PATH: process.env.PATH, HOME: dir("home"), PIVOT_NO_OPEN: "1", ...env }, timeout: 20_000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr }),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

/**
 * `count` distinct ports that were free a moment ago: all held open together, then released. A start that gets past
 * the port checks needs two (PIVOT's and PIVOT_PREVIEW_PORT); PIVOT's + 1 can't be assumed free while other packages'
 * tests run in parallel.
 */
async function freePorts(count) {
  const servers = await Promise.all(Array.from({ length: count }, () => listen()));
  const ports = servers.map((s) => s.address().port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

describe("options", () => {
  it("parses each command's options and refuses anything else before doing anything", () => {
    expect(parseArgs(["--port", "4400", "--data-dir=/x", "--no-open"], "start")).toEqual({
      open: false,
      port: "4400",
      dataDir: "/x",
    });
    expect(() => parseArgs(["--scratch"], "start")).toThrow(/Unknown option/);
    expect(() => parseArgs(["--port", "43a1"], "start")).toThrow(/Bad port/);
    expect(() => parseArgs(["--data-dir"], "start")).toThrow(/needs a value/);
    expect(() => parseArgs(["--data-dir", "--no-open"], "start")).toThrow(/needs a value/);
    expect(() => parseArgs(["--replace"], "start")).toThrow(/Unknown option/);
    expect(parseArgs(["--replace", "--stdin"], "passphrase")).toMatchObject({ replace: true, stdin: true });
    expect(() => parseArgs([], "deploy")).toThrow(/Unknown command/);
  });

  it("prints help and the version, and exits 1 on an unknown command or option", async () => {
    expect((await cli(["help"])).out).toMatch(/Usage: pivot-studio.*\n[\s\S]*preview <session>/);
    expect(await cli(["--version"])).toEqual({ code: 0, out: `${pkg.version}\n` });
    expect((await cli(["deploy"])).code).toBe(1);
    const bad = await cli(["--bogus"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/Unknown option "--bogus" for start\. Nothing was done/);
  });

  it("uses the flag, then PIVOT_DATA_DIR, then ~/.pivot", () => {
    expect(resolveDataDir("/a", { PIVOT_DATA_DIR: "/b" })).toBe(path.resolve("/a"));
    expect(resolveDataDir(undefined, { PIVOT_DATA_DIR: "/b" })).toBe(path.resolve("/b"));
    expect(resolveDataDir(undefined, {})).toBe(path.join(os.homedir(), ".pivot"));
  });
});

describe("start refuses before it serves anything", () => {
  it("when PIVOT already answers at the address: says so and exits 0", async () => {
    const server = await listen((_req, res) => res.end(JSON.stringify({ app: "pivot" })));
    try {
      const r = await cli(["start", "--port", String(server.address().port), "--data-dir", dir("data")]);
      expect(r).toMatchObject({ code: 0, out: expect.stringContaining("already running") });
    } finally {
      server.close();
    }
  });

  it("when something else holds the port", async () => {
    const server = await listen((_req, res) => res.end("not pivot"));
    try {
      const r = await cli(["start", "--port", String(server.address().port), "--data-dir", dir("data")]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("Something else is using port");
    } finally {
      server.close();
    }
  });

  it("when the data folder belongs to a library in Postgres but DATABASE_URL is missing", async () => {
    const data = dir("neon");
    fs.writeFileSync(path.join(data, "api-token"), "t");
    const [port, previewPort] = await freePorts(2);
    const r = await cli(["start", "--port", String(port), "--data-dir", data], {
      env: { PIVOT_PREVIEW_PORT: String(previewPort) },
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/probably in Neon.*Nothing was started/);
    expect(fs.existsSync(path.join(data, "db"))).toBe(false);
    expect(fs.existsSync(path.join(data, "install.json"))).toBe(false);
  });

  it("serves only on this machine, with the migrations and preview script it ships", () => {
    const env = serverEnv({ HOSTNAME: "0.0.0.0", PORT: "1" }, 4410);
    expect(env).toMatchObject({ HOSTNAME: "127.0.0.1", PORT: "4410", NODE_ENV: "production" });
    expect(env.PIVOT_MIGRATIONS_DIR).toBe(dist.migrations);
    expect(env.PIVOT_PREVIEW_SCRIPT).toBe(path.join(dist.scripts, "preview.mjs"));
    expect(serverEnv({ PIVOT_PREVIEW_SCRIPT: "/own.mjs" }, 1).PIVOT_PREVIEW_SCRIPT).toBe("/own.mjs");
  });

  it("puts component previews on their own port: PIVOT's + 1, or PIVOT_PREVIEW_PORT", () => {
    expect(serverEnv({}, 4410).PIVOT_PREVIEW_PORT).toBe("4411");
    expect(serverEnv({ PIVOT_PREVIEW_PORT: "5000" }, 4410).PIVOT_PREVIEW_PORT).toBe("5000");
    expect(previewPortFor({}, "4321")).toBe("4322");
  });
});

describe("the native packages", () => {
  it("are pinned to the versions the web app is built with, and nothing else is a runtime dependency", () => {
    for (const name of RUNTIME) expect(pkg.dependencies[name], name).toBe(builtVersion(name));
    expect(RUNTIME.sort()).toEqual(
      [
        "@aws-sdk/client-s3",
        // presigned R2 links for the cloud builder (packages/core/src/cloud-build.ts)
        "@aws-sdk/s3-request-presigner",
        "@electric-sql/pglite",
        // the component preview build (packages/core/src/preview-build.ts)
        "esbuild",
        "next",
        "playwright",
        "postgres",
        "react",
        "react-dom",
        "sharp",
        "tailwindcss",
      ].sort(),
    );
  });

  it("ship with PIVOT's license and the third-party notices", () => {
    expect(fs.readFileSync(path.resolve(here, "../LICENSE"), "utf8")).toBe(
      fs.readFileSync(path.resolve(here, "../../../LICENSE"), "utf8"),
    );
    expect(REQUIRED).toContain("THIRD_PARTY_NOTICES.md");
  });

  it("are read from the build's pnpm links, and anything but a link there stops the build", () => {
    const nm = dir("nm");
    fs.mkdirSync(path.join(nm, "@electric-sql"));
    fs.symlinkSync("../../../node_modules/.pnpm/sharp@0.35.5/node_modules/sharp", path.join(nm, "sharp-abc"));
    fs.symlinkSync(
      "../../../../node_modules/.pnpm/@electric-sql+pglite@0.5.11/node_modules/@electric-sql/pglite",
      path.join(nm, "@electric-sql", "pglite-def"),
    );
    expect(externalsOf(nm)).toEqual({ "sharp-abc": "sharp", "@electric-sql/pglite-def": "@electric-sql/pglite" });
    fs.mkdirSync(path.join(nm, "stray"));
    expect(() => externalsOf(nm)).toThrow(/Unexpected/);
  });

  it("are linked under their hashed names to this machine's install, again when the install moves", () => {
    const app = dir("app");
    const sharpA = dir("sharp-a");
    const sharpB = dir("sharp-b");
    const map = { "sharp-abc": "sharp", "@electric-sql/pglite-def": "@electric-sql/pglite" };
    let where = { sharp: sharpA, "@electric-sql/pglite": dir("pglite") };
    const find = (name) => where[name] ?? null;
    expect(linkExternals({ appDir: app, map, find })).toEqual([]);
    const link = path.join(app, ".next/node_modules/sharp-abc");
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(sharpA));
    expect(fs.realpathSync(path.join(app, ".next/node_modules/@electric-sql/pglite-def"))).toBeTruthy();
    where = { ...where, sharp: sharpB };
    expect(linkExternals({ appDir: app, map, find })).toEqual([]);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(sharpB));
    where = {};
    expect(linkExternals({ appDir: app, map, find }).sort()).toEqual(["@electric-sql/pglite", "sharp"]);
    expect(() => linkExternals({ appDir: app, map: { "../evil": "sharp" }, find })).toThrow(/Bad external/);
  });
});

describe("doctor", () => {
  it("lists what is there and what is missing, and fails only on what PIVOT needs", async () => {
    const data = dir("doc");
    const claude = dir("claude");
    fs.mkdirSync(path.join(claude, "plugins"));
    fs.writeFileSync(
      path.join(claude, "plugins/installed_plugins.json"),
      JSON.stringify({ plugins: { "pivot@pivot": [{}], "other@x": [{}] } }),
    );
    fs.writeFileSync(path.join(data, "api-token"), "t");
    fs.writeFileSync(path.join(data, ".env"), "DATABASE_URL=postgres://u@h/db\n");
    const byName = Object.fromEntries(
      (await checks({ dataDir: data, port: "1", env: { CLAUDE_CONFIG_DIR: claude }, nodeVersion: "20.11.0" })).map(
        (c) => [c.name, c],
      ),
    );
    expect(byName["Node.js"]).toMatchObject({ ok: false, need: true });
    expect(byName["Database"].detail).toBe("Postgres (DATABASE_URL)");
    expect(byName["API token"].ok).toBe(true);
    expect(byName["Owner passphrase"]).toMatchObject({
      ok: false,
      fix: expect.stringContaining("pivot-studio passphrase"),
    });
    expect(byName["PIVOT"].ok).toBe(false);
    expect(byName["Claude Code plugin"]).toMatchObject({ ok: true, detail: "pivot@pivot" });
  });
});

describe("passphrase", () => {
  it("stores only a scrypt hash, refuses short ones and won't replace one without --replace", async () => {
    const data = dir("pass");
    expect((await cli(["passphrase", "--stdin", "--data-dir", data], { input: "short\n" })).code).toBe(1);
    expect((await cli(["passphrase", "--stdin", "--data-dir", data], { input: "a long test passphrase\n" })).code).toBe(
      0,
    );
    const stored = JSON.parse(fs.readFileSync(path.join(data, "owner-approval.json"), "utf8"));
    expect(stored).toMatchObject({ v: 1, algo: "scrypt", N: 32768, r: 8, p: 1, keylen: 32 });
    expect(JSON.stringify(stored)).not.toContain("a long test passphrase");
    expect((fs.statSync(path.join(data, "owner-approval.json")).mode & 0o777).toString(8)).toBe("600");
    expect((await cli(["passphrase", "--stdin", "--data-dir", data], { input: "another passphrase!!\n" })).code).toBe(
      1,
    );
    expect(
      (await cli(["passphrase", "--stdin", "--replace", "--data-dir", data], { input: "another passphrase!!\n" })).code,
    ).toBe(0);
  });
});

describe("extension", () => {
  it("copies the built extension into the data folder, and only ever replaces its own folder", () => {
    const from = dir("ext");
    fs.writeFileSync(path.join(from, "manifest.json"), JSON.stringify({ version: "9.9.9" }));
    const data = dir("extdata");
    expect(installExtension({ dataDir: data, from })).toBe(0);
    expect(installExtension({ dataDir: data, from })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(data, "extension/manifest.json"), "utf8")).version).toBe("9.9.9");
    const other = dir("otherdata");
    fs.mkdirSync(path.join(other, "extension"));
    fs.writeFileSync(path.join(other, "extension/mine.txt"), "keep");
    expect(installExtension({ dataDir: other, from })).toBe(1);
    expect(fs.readFileSync(path.join(other, "extension/mine.txt"), "utf8")).toBe("keep");
  });
});

it("records the install for the design skill's scripts", () => {
  const data = dir("info");
  const file = writeInstallInfo({
    dataDir: data,
    kind: "npm",
    root: "/r",
    requireFrom: "/r/package.json",
    version: "1",
  });
  expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({
    app: "pivot",
    kind: "npm",
    requireFrom: "/r/package.json",
  });
});

describe("release check", () => {
  it("names the changed files that end up in the npm package, and nothing else", () => {
    const inPackage = [
      "apps/web/src/app/api/ping/route.ts",
      "apps/web/public/icon.svg",
      "apps/web/next.config.ts",
      "packages/core/src/capture.ts",
      "packages/core/src/db/migrations/0042_x.sql",
      "apps/extension/src/popup.tsx",
      "apps/extension/popup.html",
      "apps/cli/lib/start.mjs",
      "apps/cli/build.mjs",
      "apps/cli/package.json",
      "plugin/skills/design/scripts/motion-qa.mjs",
      "plugin/skills/design/scripts/preview.mjs",
      "THIRD_PARTY_NOTICES.md",
      "pnpm-lock.yaml",
    ];
    const outside = [
      "docs/SPEC.md",
      "README.md",
      "plugin/.claude-plugin/plugin.json",
      "plugin/server/server.js",
      "plugin/skills/design/SKILL.md",
      "plugin/skills/design/scripts/wait-for-decision.mjs",
      "plugin/skills/design/viewer/make-viewer.mjs",
      "packages/mcp-tools/src/tools.ts",
      "packages/core/test/capture-flow.test.ts",
      "apps/web/src/lib/format.test.ts",
      "apps/extension/test/popup.test.ts",
      "apps/cli/test/cli.test.mjs",
      "apps/cli/release-check.mjs",
      ".github/workflows/publish-cli.yml",
    ];
    expect(packageFiles([...outside, ...inPackage, ""])).toEqual(inPackage);
  });

  it("reads the changed files from stdin and prints the packaged ones", async () => {
    const run = (input) =>
      new Promise((resolve) => {
        const child = execFile(process.execPath, [path.resolve(here, "../release-check.mjs")], (err, stdout) =>
          resolve({ code: err ? 1 : 0, out: stdout }),
        );
        child.stdin.end(input);
      });
    expect(await run("docs/SPEC.md\npackages/core/src/capture.ts\n")).toEqual({
      code: 0,
      out: "packages/core/src/capture.ts\n",
    });
    expect(await run("docs/SPEC.md\n")).toEqual({ code: 0, out: "" });
  });
});

describe("builder setup", () => {
  const builderDir = path.resolve(here, "../../../builder");

  /** A stand-in for GitHub's API: one account, its repos and their files. */
  function fakeGitHub({ repos = {}, login = "me" } = {}) {
    const calls = [];
    const fetch = async (url, init = {}) => {
      const u = new URL(url);
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: u.pathname, body, auth: init.headers.Authorization });
      const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
      if (u.pathname === "/user") return json({ login });
      if (method === "POST" && u.pathname === "/user/repos") {
        repos[`${login}/${body.name}`] = { private: body.private, files: {} };
        return json({}, 201);
      }
      const m = /^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/.exec(u.pathname);
      const repo = m && repos[m[1]];
      if (!repo) return json({ message: "Not Found" }, 404);
      if (!m[2]) return json({ private: repo.private });
      const file = decodeURIComponent(m[2]);
      if (method === "GET") return repo.files[file] ? json({ sha: repo.files[file] }) : json({}, 404);
      repo.files[file] = blobSha(Buffer.from(body.content, "base64"));
      return json({}, 201);
    };
    return { fetch, calls, repos };
  }

  it("creates the repo private, writes the builder's files and sets PIVOT_BUILD_REPO, keeping the rest of .env", async () => {
    const gh = fakeGitHub();
    const envFile = path.join(dir("env"), ".env");
    fs.writeFileSync(envFile, "R2_BUCKET=b\nR2_ACCESS_KEY_ID=k\nR2_SECRET_ACCESS_KEY=s\n");
    const log = [];
    const code = await setupBuilder({
      repo: "me/builds",
      builderDir,
      envFile,
      env: {},
      fetch: gh.fetch,
      token: () => "t0k3n",
      log: (l) => log.push(l),
    });
    expect(code).toBe(0);
    expect(gh.repos["me/builds"].private).toBe(true);
    expect(Object.keys(gh.repos["me/builds"].files).sort()).toEqual([...BUILDER_FILES].sort());
    expect(gh.calls.every((c) => c.auth === "Bearer t0k3n")).toBe(true);
    expect(fs.readFileSync(envFile, "utf8")).toBe(
      "R2_BUCKET=b\nR2_ACCESS_KEY_ID=k\nR2_SECRET_ACCESS_KEY=s\nPIVOT_BUILD_REPO=me/builds\n",
    );
    expect(log.join("\n")).not.toContain("t0k3n");
    expect(log.join("\n")).not.toMatch(/R2_\* keys/);

    // again: nothing to write
    const puts = gh.calls.filter((c) => c.method === "PUT").length;
    await setupBuilder({
      repo: "me/builds",
      builderDir,
      envFile,
      env: {},
      fetch: gh.fetch,
      token: () => "t",
      log: (l) => log.push(l),
    });
    expect(gh.calls.filter((c) => c.method === "PUT").length).toBe(puts);
    expect(log.at(-3)).toMatch(/up to date/);
  });

  it("refuses a public repo, and a malformed --repo, before writing anything", async () => {
    const gh = fakeGitHub({ repos: { "me/open": { private: false, files: {} } } });
    const envFile = path.join(dir("env"), ".env");
    const opts = { builderDir, envFile, env: {}, fetch: gh.fetch, token: () => "t", log: () => {} };
    await expect(setupBuilder({ ...opts, repo: "me/open" })).rejects.toThrow(/is public/);
    await expect(setupBuilder({ ...opts, repo: "https://github.com/me/open" })).rejects.toThrow(/owner\/name/);
    expect(gh.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(fs.existsSync(envFile)).toBe(false);
  });

  it("replaces an existing PIVOT_BUILD_REPO line", () => {
    const envFile = path.join(dir("env"), ".env");
    fs.writeFileSync(envFile, "A=1\nPIVOT_BUILD_REPO=old/one\nB=2\n");
    setEnvValue(envFile, "PIVOT_BUILD_REPO", "new/one");
    expect(fs.readFileSync(envFile, "utf8")).toBe("A=1\nPIVOT_BUILD_REPO=new/one\nB=2\n");
  });

  it("takes only --repo and --data-dir", async () => {
    expect(parseArgs(["--repo", "me/builds"], "builder")).toMatchObject({ repo: "me/builds" });
    expect(() => parseArgs(["--port", "1"], "builder")).toThrow(/Unknown option/);
    const r = await cli(["builder", "start"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/builder setup --repo/);
  });
});
