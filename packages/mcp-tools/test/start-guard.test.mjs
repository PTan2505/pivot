// The launcher's guards: a scratch PIVOT never uses the real data folder or port, and an unknown or mistyped argument
// stops before anything runs. Every run here has HOME pointed at a temp folder, so even a broken guard can't reach the
// real ~/.pivot, and each must exit on its own within seconds (a hang means it went on to start a server).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const start = path.resolve(here, "../../../scripts/start.mjs");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "start-guard-home-"));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

/** Runs the launcher with argv as given (no shell), a fake HOME and a clean env; kills it if it doesn't exit. */
function run(args, env = {}) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(PIVOT_|DATABASE_URL|R2_|PORT$)/.test(k)),
    );
    const child = spawn(process.execPath, [start, ...args], {
      // a port nothing else uses: if a guard ever regresses, the run can't take 4321
      env: { ...clean, HOME: home, PIVOT_NO_OPEN: "1", PORT: "4999", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: "hung", out });
    }, 8000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe("the launcher fails closed", () => {
  it("refuses unknown and mistyped arguments before doing anything", async () => {
    for (const args of [["--scratch /tmp/x"], ["--scrach", "/tmp/x"], ["--port", "4400"], ["serve"]]) {
      const r = await run(args);
      expect(r.code, JSON.stringify(args)).toBe(1);
      expect(r.out).toMatch(/Unknown argument .*nothing was started/);
    }
    expect(fs.existsSync(path.join(home, ".pivot"))).toBe(false);
  }, 60_000);

  it("--scratch refuses no folder, the real data folder, the repository and port 4321", async () => {
    const cases = [
      [["--scratch"], {}, /give it a folder/],
      [["--scratch", path.join(home, ".pivot")], {}, /your real data folder/],
      [["--scratch", path.join(home, ".pivot", "db")], {}, /your real data folder/],
      [["--scratch", "~/.pivot"], {}, /your real data folder/],
      [["--scratch", path.resolve(here, "../../../tmp-scratch")], {}, /outside the repository/],
      [["--scratch", path.join(home, "s")], { PORT: "4321" }, /4321 is the real PIVOT's port/],
    ];
    for (const [args, env, why] of cases) {
      const r = await run(args, env);
      expect(r.code, JSON.stringify(args)).toBe(1);
      expect(r.out).toMatch(why);
    }
    expect(fs.existsSync(path.join(home, ".pivot"))).toBe(false);
  }, 90_000);
});

describe("a scratch PIVOT is isolated", () => {
  it("uses its own data, database, storage and Claude skill folders, whatever the shell has", async () => {
    const dir = path.join(home, "isolated");
    const r = await run(["--scratch", dir], {
      PIVOT_LAUNCH_DRY_RUN: "1",
      DATABASE_URL: "postgres://u:p@ep-real.neon.tech/db",
      R2_ENDPOINT: "https://real.r2.cloudflarestorage.com",
      CLAUDE_SKILLS_DIR: path.join(home, ".claude", "skills"),
    });
    expect(r.code).toBe(0);
    const marker = JSON.parse(fs.readFileSync(path.join(dir, "pivot-scratch.json"), "utf8"));
    expect(marker).toMatchObject({
      scratch: true,
      database: "pglite",
      storage: "local",
      claudeSkillsDir: path.join(dir, "claude", "skills"),
      claudePluginsDir: path.join(dir, "claude", "plugins"),
    });
    expect(r.out).toMatch(/its own Claude skill folders/);
    expect(fs.existsSync(path.join(home, ".claude"))).toBe(false);
  }, 30_000);
});

describe("the normal launcher fails closed without its configuration", async () => {
  const { missingConfig } = await import(path.resolve(here, "../../../scripts/launch-guard.mjs"));
  it("refuses a Neon library's data folder (token, no local database) when DATABASE_URL is missing", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "launch-guard-"));
    fs.writeFileSync(path.join(d, "api-token"), "t");
    expect(missingConfig({ dataDir: d, env: {}, envFile: "/repo/.env" })).toMatch(
      /probably in Neon.*Nothing was started/,
    );
    // positive controls: with DATABASE_URL, a local library (db folder), and a brand-new data folder
    expect(missingConfig({ dataDir: d, env: { DATABASE_URL: "postgres://x" }, envFile: "" })).toBeNull();
    fs.mkdirSync(path.join(d, "db"));
    expect(missingConfig({ dataDir: d, env: {}, envFile: "" })).toBeNull();
    expect(missingConfig({ dataDir: path.join(d, "new"), env: {}, envFile: "" })).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("scripts that write check for a scratch PIVOT first", async () => {
  const { assertScratch } = await import(path.resolve(here, "../../../scripts/qa/scratch-guard.mjs"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-guard-"));
  fs.writeFileSync(path.join(dir, "api-token"), "scratch-token");
  const server = (token) => async () => new Response(JSON.stringify({ token }));
  const ok = {
    base: "http://127.0.0.1:4400",
    dataDir: dir,
    env: { PIVOT_E2E_SCRATCH: "1" },
    fetchImpl: server("scratch-token"),
  };

  it("refuses without the flag, on 4321, off this machine, on the real data folder, or without the marker", async () => {
    for (const [over, why] of [
      [{ env: {} }, /PIVOT_E2E_SCRATCH=1/],
      [{ base: "http://127.0.0.1:4321" }, /real PIVOT's port/],
      [{ base: "http://192.168.1.5:4400" }, /isn't on this machine/],
      [{ dataDir: path.join(os.homedir(), ".pivot") }, /your real data folder/],
      [{ dataDir: undefined }, /PIVOT_DATA_DIR/],
      [{}, /no pivot-scratch.json/],
    ])
      await expect(assertScratch({ ...ok, ...over })).rejects.toThrow(why);
  });

  it("refuses a server that doesn't use that folder, and accepts the scratch one", async () => {
    fs.writeFileSync(path.join(dir, "pivot-scratch.json"), JSON.stringify({ scratch: true }));
    await expect(assertScratch({ ...ok, fetchImpl: server("another-token") })).rejects.toThrow(/doesn't use/);
    await expect(assertScratch(ok)).resolves.toEqual({ dir });
    // without the token check (a PIVOT with no token yet), the marker and the rest still decide
    await expect(assertScratch({ ...ok, fetchImpl: server("x"), checkToken: false })).resolves.toEqual({ dir });
  });
});
