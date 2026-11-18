// `pivot-studio extension`: puts the built Chrome extension in <data dir>/extension, where Chrome can load it unpacked.
import fs from "node:fs";
import path from "node:path";
import { dist, resolveDataDir } from "./paths.mjs";

const MARKER = ".pivot-extension";

export function installExtension({ dataDir: flag, from = dist.extension } = {}) {
  const dataDir = resolveDataDir(flag);
  const dest = path.join(dataDir, "extension");
  if (!fs.existsSync(path.join(from, "manifest.json"))) {
    console.error(`› This copy of pivot-studio has no built extension (${from}). Reinstall it.`);
    return 1;
  }
  // only ever replace a folder this command made
  if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, MARKER))) {
    console.error(`› ${dest} exists and wasn't made by pivot-studio. Move it away, then run this again.`);
    return 1;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(from, dest, { recursive: true });
  fs.writeFileSync(
    path.join(dest, MARKER),
    "Made by `pivot-studio extension`; it replaces this folder on every run.\n",
  );
  const version = JSON.parse(fs.readFileSync(path.join(dest, "manifest.json"), "utf8")).version;
  console.log(`› PIVOT's Chrome extension ${version} is in ${dest}

  1. Open chrome://extensions and turn on Developer mode.
  2. Click "Load unpacked" and pick ${dest}
     (already loaded? press its reload button instead).
  3. Open the extension's options and paste the server address and API token from
     PIVOT › Settings › Browser extension.`);
  return 0;
}
