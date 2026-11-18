// The built server loads its native packages (sharp, Playwright, PGlite, postgres, the S3 client) under hashed names,
// through links in dist/app/.next/node_modules that the build machine's pnpm layout made. npm doesn't ship links, so
// the build records the names (dist/app/externals.json) and `start` points each one at the package npm installed
// for this machine.
import fs from "node:fs";
import path from "node:path";
import { dist, findPackageDir } from "./paths.mjs";

/** Reads the hashed-name → package-name map the build wrote. */
export function readExternals(file = dist.externals) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Makes `<appDir>/.next/node_modules/<hashed>` a link to each package's installed folder, replacing stale links.
 * Returns the packages it couldn't find (an incomplete install).
 */
export function linkExternals({ appDir = dist.app, map = readExternals(), find = findPackageDir } = {}) {
  const base = path.join(appDir, ".next", "node_modules");
  const missing = [];
  for (const [hashed, name] of Object.entries(map)) {
    if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(hashed)) throw new Error(`Bad external name ${hashed}`);
    const target = find(name);
    if (!target) {
      missing.push(name);
      continue;
    }
    const link = path.join(base, hashed);
    let current = null;
    try {
      current = fs.realpathSync(link);
    } catch {
      // missing or dangling
    }
    if (current === target) continue;
    fs.rmSync(link, { force: true, recursive: false });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    // a junction needs no extra rights on Windows; elsewhere the type is ignored
    fs.symlinkSync(target, link, "junction");
  }
  return [...new Set(missing)];
}
