// <data dir>/install.json: which PIVOT install last started with this data folder. The design skill's scripts
// (preview.mjs, motion-qa.mjs), installed with the Claude Code plugin wherever Claude Code keeps it, read it to load
// that install's Playwright, so they work with an npm install as well as a checkout.
import fs from "node:fs";
import path from "node:path";

export const INSTALL_FILE = "install.json";

/**
 * Records the install. `requireFrom` is a file inside it from which `playwright` resolves (createRequire's base):
 * the package.json of pivot-studio, or of packages/core in a checkout.
 */
export function writeInstallInfo({ dataDir, kind, root, requireFrom, version }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const info = { app: "pivot", kind, root, requireFrom, version, startedAt: new Date().toISOString() };
  const file = path.join(dataDir, INSTALL_FILE);
  fs.writeFileSync(file, JSON.stringify(info, null, 2) + "\n");
  return file;
}
