// `pivot-studio doctor`: what this machine has and what is missing, each with the command that fixes it. Reads only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromiumStatus, ffmpegStatus } from "./browser.mjs";
import { DEFAULT_PORT, expandHome, loadEnvFile, resolveDataDir } from "./paths.mjs";
import { pivotAt } from "./start.mjs";

/** Installed Claude Code plugins named pivot (from any marketplace), from Claude Code's own record. */
export function pivotPlugins(env = process.env) {
  const config = path.resolve(expandHome(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")));
  try {
    const data = JSON.parse(fs.readFileSync(path.join(config, "plugins", "installed_plugins.json"), "utf8"));
    return Object.keys(data.plugins ?? {}).filter((k) => k.startsWith("pivot@"));
  } catch {
    return [];
  }
}

/**
 * Each check: `ok`, what was found (`detail`), and `fix` when it isn't ok. `need: true` checks make doctor exit 1;
 * the others only limit what PIVOT can do.
 */
export async function checks({ dataDir: flag, port, env = process.env, nodeVersion = process.versions.node } = {}) {
  const dataDir = resolveDataDir(flag, env);
  const scoped = { ...env };
  loadEnvFile(path.join(dataDir, ".env"), scoped);
  const url = `http://127.0.0.1:${port || scoped.PORT || DEFAULT_PORT}`;
  const out = [];
  const add = (c) => out.push(c);

  const major = Number(nodeVersion.split(".")[0]);
  add({
    name: "Node.js",
    ok: major >= 22,
    need: true,
    detail: `v${nodeVersion}`,
    fix: "Install Node.js 22 or newer (https://nodejs.org).",
  });

  add({ name: "Data folder", ok: true, detail: dataDir + (fs.existsSync(dataDir) ? "" : " (created on first start)") });
  add({
    name: "Database",
    ok: true,
    detail: scoped.DATABASE_URL ? "Postgres (DATABASE_URL)" : `local, in ${path.join(dataDir, "db")}`,
  });
  add({
    name: "File storage",
    ok: true,
    detail: scoped.R2_BUCKET ? `Cloudflare R2 (${scoped.R2_BUCKET})` : `local, in ${dataDir}`,
  });

  const chromium = chromiumStatus();
  add({
    name: "Chromium (screenshots)",
    ok: chromium.installed,
    need: true,
    detail: chromium.installed ? chromium.path : "not installed",
    fix: "Run `pivot-studio start` once: it downloads Chromium (about 150 MB).",
  });
  const ffmpeg = ffmpegStatus(chromium.path);
  add({
    name: "ffmpeg (motion recording)",
    ok: ffmpeg.installed,
    detail: ffmpeg.installed ? ffmpeg.path : "not found beside Chromium",
    fix: "It comes with Chromium: run `pivot-studio start` once. Screenshots work without it; motion recording doesn't.",
  });

  const token = fs.existsSync(path.join(dataDir, "api-token"));
  add({
    name: "API token",
    ok: token,
    detail: token ? path.join(dataDir, "api-token") : "not created yet",
    fix: "PIVOT creates it when it starts: run `pivot-studio start`.",
  });
  const passphrase = fs.existsSync(path.join(dataDir, "owner-approval.json"));
  add({
    name: "Owner passphrase",
    ok: passphrase,
    detail: passphrase ? "set" : "not set",
    fix: "Run `pivot-studio passphrase` in your own terminal. Approving a design in PIVOT needs it.",
  });

  const running = await pivotAt(url);
  add({
    name: "PIVOT",
    ok: running,
    detail: running ? `running at ${url}` : `not answering at ${url}`,
    fix: "Run `pivot-studio start`.",
  });

  const plugins = pivotPlugins(scoped);
  add({
    name: "Claude Code plugin",
    ok: plugins.length > 0,
    detail: plugins.length ? plugins.join(", ") : "not installed",
    fix: "Run `claude plugin install pivot --marketplace PTan2505/pivot`, then start a new Claude Code session.",
  });
  return out;
}

export async function doctor(opts) {
  const list = await checks(opts);
  for (const c of list) {
    console.log(`${c.ok ? "✓" : c.need ? "✗" : "!"} ${c.name}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`    ${c.fix}`);
  }
  const failed = list.filter((c) => !c.ok && c.need);
  console.log(failed.length ? `\n${failed.length} required check(s) failed.` : "\nEverything PIVOT needs is here.");
  return failed.length ? 1 : 0;
}
