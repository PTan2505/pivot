// `pivot-studio start`: serve PIVOT on 127.0.0.1 from the built server in dist/app, with its data in ~/.pivot.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { chromiumStatus, installChromium } from "./browser.mjs";
import { linkExternals } from "./externals.mjs";
import { writeInstallInfo } from "./install-info.mjs";
import { missingConfig } from "./launch-guard.mjs";
import { DEFAULT_PORT, dist, loadEnvFile, packageRoot, packageVersion, resolveDataDir } from "./paths.mjs";

/** Is PIVOT (not just anything) answering at this address? */
export async function pivotAt(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${url}/api/capabilities`, { signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.json())?.app === "pivot";
  } catch {
    return false;
  }
}

/** Whether something already listens on the port. */
export function portBusy(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(port), host });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

export function openBrowser(url, platform = process.platform) {
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser to open (a server, a container): the address is printed anyway
  }
}

/** The component preview origin's port: PIVOT_PREVIEW_PORT, else PIVOT's port + 1 (docs/component-store-plan.md). */
export function previewPortFor(env, port) {
  return String(env.PIVOT_PREVIEW_PORT || Number(port) + 1);
}

/** The built server's environment: this machine only, and the migrations and preview script shipped in dist/. */
export function serverEnv(env, port) {
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    PIVOT_PREVIEW_PORT: previewPortFor(env, port),
    PIVOT_MIGRATIONS_DIR: env.PIVOT_MIGRATIONS_DIR || dist.migrations,
    PIVOT_PREVIEW_SCRIPT: env.PIVOT_PREVIEW_SCRIPT || path.join(dist.scripts, "preview.mjs"),
  };
}

export async function start(opts) {
  const dataDir = resolveDataDir(opts.dataDir);
  const env = process.env;
  opts = { ...opts, open: opts.open !== false && !env.PIVOT_NO_OPEN };
  env.PIVOT_DATA_DIR = dataDir;
  // Neon, R2 and other settings for this data folder (optional)
  const envFile = path.join(dataDir, ".env");
  loadEnvFile(envFile, env);
  const port = String(opts.port || env.PORT || DEFAULT_PORT);
  if (!/^\d{2,5}$/.test(port)) throw new Error(`Bad port ${port}`);
  const url = `http://127.0.0.1:${port}`;

  if (await pivotAt(url)) {
    console.log(`› PIVOT is already running at ${url}`);
    if (opts.open) openBrowser(url);
    return 0;
  }
  if (await portBusy(port)) {
    console.error(
      `› Something else is using port ${port}. Start PIVOT on another one: pivot-studio start --port ${Number(port) + 1}`,
    );
    return 1;
  }
  const previewPort = previewPortFor(env, port);
  if (!/^\d{2,5}$/.test(previewPort) || previewPort === port || (await portBusy(previewPort))) {
    console.error(
      `› Port ${previewPort}, where PIVOT shows component previews, is busy or invalid. Start PIVOT on another port (pivot-studio start --port ${Number(port) + 2}) or set PIVOT_PREVIEW_PORT.`,
    );
    return 1;
  }
  // fail closed: never start an empty local library in place of one kept in Neon
  const why = missingConfig({ dataDir, env, envFile });
  if (why) {
    console.error(`› ${why}`);
    return 1;
  }
  if (!fs.existsSync(path.join(dist.app, "server.js"))) {
    console.error(`› This copy of pivot-studio has no built server (${dist.app}). Reinstall it.`);
    return 1;
  }

  if (!chromiumStatus().installed) {
    console.log("› Installing Chromium for screenshots (one time, about 150 MB)…");
    if (!installChromium()) console.error("› Chromium didn't install: PIVOT will run, but screenshots will fail.");
  }
  const missing = linkExternals();
  if (missing.length) {
    console.error(`› These packages are missing from the install: ${missing.join(", ")}. Reinstall pivot-studio.`);
    return 1;
  }
  writeInstallInfo({
    dataDir,
    kind: "npm",
    root: packageRoot,
    requireFrom: path.join(packageRoot, "package.json"),
    version: packageVersion(),
  });

  console.log(`› PIVOT ${packageVersion()} → ${url}  (data: ${dataDir})`);
  const server = spawn(process.execPath, [path.join(dist.app, "server.js")], {
    cwd: dist.app,
    stdio: "inherit",
    env: serverEnv(env, port),
  });

  if (opts.open) {
    const started = Date.now();
    const poll = setInterval(async () => {
      if (await pivotAt(url)) {
        clearInterval(poll);
        openBrowser(url);
      } else if (Date.now() - started > 60_000) clearInterval(poll);
    }, 700);
    server.on("exit", () => clearInterval(poll));
  }
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
  return new Promise((resolve) => server.on("exit", (code) => resolve(code ?? 0)));
}
