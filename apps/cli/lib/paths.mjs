// Where things are: this package, the parts `node build.mjs` put in dist/, and PIVOT's data folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The pivot-studio package folder (an npm install, an npx cache entry, or apps/cli in a checkout). */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const dist = {
  root: path.join(packageRoot, "dist"),
  /** Next.js standalone server: server.js, .next/, public/ */
  app: path.join(packageRoot, "dist/app"),
  /** hashed external package name → package name, for the links in dist/app/.next/node_modules */
  externals: path.join(packageRoot, "dist/app/externals.json"),
  migrations: path.join(packageRoot, "dist/migrations"),
  scripts: path.join(packageRoot, "dist/scripts"),
  extension: path.join(packageRoot, "dist/extension"),
  /** the cloud builder's repo files (builder/ in the repo), for `pivot-studio builder setup` */
  builder: path.join(packageRoot, "dist/builder"),
};

export const DEFAULT_PORT = "4321";

export const expandHome = (p) => p.replace(/^~(?=$|[/\\])/, os.homedir());

/** PIVOT's data folder: the flag, else PIVOT_DATA_DIR, else ~/.pivot. */
export function resolveDataDir(flag, env = process.env) {
  return path.resolve(expandHome(flag || env.PIVOT_DATA_DIR || "~/.pivot"));
}

/** KEY=value lines, without overriding what the environment already has. Returns whether the file existed. */
export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return true;
}

export function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
}

/**
 * The folder of an installed package, found the way Node would from this package (its own node_modules, then each
 * parent's), without importing it. Works for packages whose `exports` hide package.json.
 */
export function findPackageDir(name, from = packageRoot) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}
