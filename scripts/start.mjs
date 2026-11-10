#!/usr/bin/env node
// `npm start`: install what's missing, rebuild if the code changed, then serve on 127.0.0.1.
// `npm run dev` (this script with --dev): same environment, Next.js dev server.
// `node scripts/start.mjs --scratch <folder>`: a throwaway PIVOT for tests and demos, on port 4400 by default. It never
// reads .env, so it never reaches your Neon database or R2 bucket, never uses your data folder, never serves on 4321,
// and leaves a marker (pivot-scratch.json) that test scripts check before they write anything.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const dev = process.argv.includes("--dev");
// Unknown arguments stop everything before any side effect: a mistyped flag must never fall back to the real PIVOT
// (your data folder, .env database, port 4321).
for (const [i, arg] of process.argv.slice(2).entries()) {
  if (process.argv[i + 1] === "--scratch") continue; // the folder given to --scratch
  if (!["--dev", "--rebuild", "--scratch"].includes(arg)) {
    console.error(`› Unknown argument ${JSON.stringify(arg)}: nothing was started.`);
    process.exit(1);
  }
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function newestMtime(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

// Scratch mode is decided before anything else runs, and refuses anything that could be the real PIVOT.
const scratchAt = process.argv.indexOf("--scratch");
if (scratchAt >= 0) {
  const fail = (why) => {
    console.error(`› --scratch refused: ${why}`);
    process.exit(1);
  };
  const raw = process.argv[scratchAt + 1];
  if (!raw || raw.startsWith("--")) fail("give it a folder, e.g. --scratch /tmp/pivot-scratch");
  const dir = path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
  for (const real of [path.join(os.homedir(), ".pivot"), path.join(os.homedir(), ".stan-bag")])
    if (dir === real || dir.startsWith(real + path.sep)) fail(`${dir} is (inside) your real data folder`);
  if (dir === root || dir.startsWith(root + path.sep)) fail("keep scratch data outside the repository");
  // empty values count as unset: no Neon, no R2, whatever the shell has
  for (const k of ["DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"])
    process.env[k] = "";
  process.env.PIVOT_DATA_DIR = dir;
  process.env.PORT ||= "4400";
  if (process.env.PORT === "4321") fail("4321 is the real PIVOT's port");
  process.env.PIVOT_NO_OPEN = "1";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "pivot-scratch.json"),
    JSON.stringify({ scratch: true, database: "pglite", storage: "local", startedAt: new Date().toISOString() }),
  );
  console.log(`› Scratch PIVOT: data in ${dir}, no .env, no Neon, no R2`);
} else {
  loadEnv(path.join(root, ".env"));
}

// The project used to be called Stan Bag and kept its data in ~/.stan-bag (API token, cache, local database).
// Move it once to the new default so the paired extension and local data carry over.
const legacyDataDir = path.join(os.homedir(), ".stan-bag");
const dataDir = path.join(os.homedir(), ".pivot");
if (!process.env.PIVOT_DATA_DIR && !fs.existsSync(dataDir) && fs.existsSync(legacyDataDir)) {
  fs.renameSync(legacyDataDir, dataDir);
  console.log(`› Moved ${legacyDataDir} to ${dataDir}`);
}

process.env.PIVOT_MIGRATIONS_DIR ??= path.join(root, "packages/core/src/db/migrations");
const port = process.env.PORT || "4321";

if (!fs.existsSync(path.join(web, "node_modules"))) {
  console.log("› Installing dependencies…");
  run("pnpm", ["install"]);
}

// Screenshots need Playwright's Chromium (one-time download, ~150 MB).
try {
  const require = createRequire(path.join(root, "packages/core/package.json"));
  const { chromium } = require("playwright");
  if (!fs.existsSync(chromium.executablePath())) {
    console.log("› Installing Chromium for screenshots (one time)…");
    run("pnpm", ["setup:browser"]);
  }
} catch (err) {
  console.warn("› Could not check Playwright's Chromium:", err.message);
}

if (!dev) {
  const buildId = path.join(web, ".next/BUILD_ID");
  const built = fs.existsSync(buildId) ? fs.statSync(buildId).mtimeMs : 0;
  const changed = Math.max(
    newestMtime(path.join(web, "src")),
    newestMtime(path.join(root, "packages/core/src")),
    ...["next.config.ts", "package.json"].map((f) => fs.statSync(path.join(web, f)).mtimeMs),
  );
  if (changed > built || process.argv.includes("--rebuild")) {
    console.log("› Building PIVOT…");
    run("pnpm", ["--filter", "web", "exec", "next", "build"]);
  }
}

const url = `http://127.0.0.1:${port}`;
console.log(`› PIVOT ${dev ? "(dev) " : ""}→ ${url}`);
const server = spawn("pnpm", ["exec", "next", dev ? "dev" : "start", "-H", "127.0.0.1", "-p", port], {
  cwd: web,
  stdio: "inherit",
  env: process.env,
});

// Open the browser once the server answers (macOS), unless disabled.
if (process.platform === "darwin" && !process.env.PIVOT_NO_OPEN) {
  const started = Date.now();
  const poll = setInterval(async () => {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      clearInterval(poll);
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } catch {
      if (Date.now() - started > 60_000) clearInterval(poll);
    }
  }, 700);
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
