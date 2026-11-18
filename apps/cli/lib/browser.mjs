// Screenshots and motion recording use Playwright's Chromium and the ffmpeg Playwright installs beside it.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { packageRoot } from "./paths.mjs";

const req = createRequire(path.join(packageRoot, "package.json"));

/** This package's Playwright, or null when it isn't installed. */
export function playwright() {
  try {
    return { chromium: req("playwright").chromium, version: req("playwright/package.json").version };
  } catch {
    return null;
  }
}

/** Chromium's executable and whether it is there. */
export function chromiumStatus(pw = playwright()) {
  if (!pw) return { installed: false, path: null };
  const exe = pw.chromium.executablePath();
  return { installed: fs.existsSync(exe), path: exe };
}

/** Playwright's ffmpeg: the ffmpeg-NNNN folder beside chromium-NNNN (the lookup packages/core/src/capture.ts does). */
export function ffmpegStatus(chromiumPath, platform = process.platform) {
  if (process.env.PIVOT_FFMPEG)
    return { installed: fs.existsSync(process.env.PIVOT_FFMPEG), path: process.env.PIVOT_FFMPEG };
  if (!chromiumPath) return { installed: false, path: null };
  let dir = path.dirname(chromiumPath);
  while (dir !== path.dirname(dir) && !/^chromium(_headless_shell)?-\d+$/.test(path.basename(dir)))
    dir = path.dirname(dir);
  const root = path.dirname(dir);
  const exe = platform === "darwin" ? "ffmpeg-mac" : platform === "win32" ? "ffmpeg-win64.exe" : "ffmpeg-linux";
  const folders = fs.existsSync(root)
    ? fs
        .readdirSync(root)
        .filter((n) => /^ffmpeg-\d+$/.test(n))
        .sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)))
    : [];
  for (const f of folders) {
    const file = path.join(root, f, exe);
    if (fs.existsSync(file)) return { installed: true, path: file };
  }
  return { installed: false, path: null };
}

/** Downloads Chromium (and its ffmpeg) with this package's own Playwright: about 150 MB, once. */
export function installChromium() {
  const cli = req.resolve("playwright/cli.js");
  const r = spawnSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
  if (r.status !== 0 && process.platform === "linux")
    console.error(
      "› On Linux, Chromium also needs system libraries: run `sudo npx playwright@" +
        (playwright()?.version ?? "latest") +
        " install-deps chromium`, then start PIVOT again.",
    );
  return r.status === 0;
}
