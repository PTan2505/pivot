// Builds a component's preview on this machine (docs/component-store-plan.md, Phase 5): the saved files and demo,
// bundled with esbuild and styled with Tailwind v4 into one self-contained HTML file, stored as the component's
// `component-preview` and served only by the preview origin (preview-server.ts). It runs only when the owner asks
// (Build preview), never on save, because it downloads the component's npm packages: from registry.npmjs.org only,
// with install scripts off, into <data folder>/component-builds/<hash>/, removed afterwards.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { eq } from "drizzle-orm";
import { MAX_PREVIEW_BYTES, PreviewError, setComponentPreview } from "./component-preview";
import { componentOf } from "./components";
import { dataDir } from "./config";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import type { ComponentFile, ComponentMeta } from "./types";

const REGISTRY = "https://registry.npmjs.org/";
const NPM_TIMEOUT_MS = 180_000;
const ERROR_CHARS = 1200;

/** Testing seams: the npm install, and where a build folder goes. */
export const buildDeps = {
  npmInstall: (dir: string) => runNpmInstall(dir),
  buildsDir: () => path.join(dataDir(), "component-builds"),
};

/**
 * `npm install` in the build folder: registry.npmjs.org only, no install scripts, no audit or funding calls, no
 * lockfile, production dependencies only. The user's own npm config is replaced by the folder's, so a private registry
 * or token never applies here.
 */
export async function runNpmInstall(dir: string, timeoutMs = NPM_TIMEOUT_MS): Promise<void> {
  // the folder's .npmrc is its project config; the user and global configs are empty files of its own (npm refuses to
  // load one file twice), so the user's registry, token or scripts settings never apply
  const empty = { user: path.join(dir, ".npmrc-user"), global: path.join(dir, ".npmrc-global") };
  await fs.writeFile(empty.user, "");
  await fs.writeFile(empty.global, "");
  return new Promise((resolve, reject) => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      npm,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        "--omit=dev",
        `--registry=${REGISTRY}`,
        "--loglevel=error",
      ],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          npm_config_userconfig: empty.user,
          npm_config_globalconfig: empty.global,
          npm_config_registry: REGISTRY,
          npm_config_ignore_scripts: "true",
          npm_config_update_notifier: "false",
          NODE_ENV: "production",
        } as NodeJS.ProcessEnv,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let err = "";
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new PreviewError(`npm couldn't start (${e.message}). Is Node's npm installed?`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new PreviewError(
            signal
              ? "Installing the npm packages took too long (3 minutes)."
              : `Installing the npm packages failed: ${err.trim().split("\n").slice(-6).join("\n")}`,
          ),
        );
    });
  });
}

// ---- the page ----------------------------------------------------------------------------------------------------

/** shadcn/ui's default theme variables, light and dark, so components built on them render as intended. */
const THEME_CSS = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
:root{--radius:0.625rem;--background:oklch(1 0 0);--foreground:oklch(0.145 0 0);--card:oklch(1 0 0);--card-foreground:oklch(0.145 0 0);--popover:oklch(1 0 0);--popover-foreground:oklch(0.145 0 0);--primary:oklch(0.205 0 0);--primary-foreground:oklch(0.985 0 0);--secondary:oklch(0.97 0 0);--secondary-foreground:oklch(0.205 0 0);--muted:oklch(0.97 0 0);--muted-foreground:oklch(0.556 0 0);--accent:oklch(0.97 0 0);--accent-foreground:oklch(0.205 0 0);--destructive:oklch(0.577 0.245 27.325);--border:oklch(0.922 0 0);--input:oklch(0.922 0 0);--ring:oklch(0.708 0 0)}
.dark{--background:oklch(0.145 0 0);--foreground:oklch(0.985 0 0);--card:oklch(0.205 0 0);--card-foreground:oklch(0.985 0 0);--popover:oklch(0.205 0 0);--popover-foreground:oklch(0.985 0 0);--primary:oklch(0.922 0 0);--primary-foreground:oklch(0.205 0 0);--secondary:oklch(0.269 0 0);--secondary-foreground:oklch(0.985 0 0);--muted:oklch(0.269 0 0);--muted-foreground:oklch(0.708 0 0);--accent:oklch(0.269 0 0);--accent-foreground:oklch(0.985 0 0);--destructive:oklch(0.704 0.191 22.216);--border:oklch(1 0 0 / 10%);--input:oklch(1 0 0 / 15%);--ring:oklch(0.556 0 0)}
@theme inline{--radius-sm:calc(var(--radius) - 4px);--radius-md:calc(var(--radius) - 2px);--radius-lg:var(--radius);--radius-xl:calc(var(--radius) + 4px);--color-background:var(--background);--color-foreground:var(--foreground);--color-card:var(--card);--color-card-foreground:var(--card-foreground);--color-popover:var(--popover);--color-popover-foreground:var(--popover-foreground);--color-primary:var(--primary);--color-primary-foreground:var(--primary-foreground);--color-secondary:var(--secondary);--color-secondary-foreground:var(--secondary-foreground);--color-muted:var(--muted);--color-muted-foreground:var(--muted-foreground);--color-accent:var(--accent);--color-accent-foreground:var(--accent-foreground);--color-destructive:var(--destructive);--color-border:var(--border);--color-input:var(--input);--color-ring:var(--ring)}
@layer base{*{border-color:var(--border)}body{background:var(--background);color:var(--foreground)}}
`;

/** Class candidates for Tailwind: every token in the source that could be a class (it ignores what isn't one). */
export function candidatesOf(files: { code: string }[]) {
  const out = new Set<string>();
  for (const f of files) {
    for (const m of f.code.matchAll(/[^\s"'`;{}<>()=,\\]+/g)) if (m[0].length < 120) out.add(m[0]);
  }
  return [...out];
}

/** Compiles Tailwind v4 (the pure-JS `tailwindcss` package: no native binaries) for these candidates. */
export async function tailwindCss(candidates: string[]) {
  const { compile } = await import("tailwindcss");
  // resolved from the server's own folder (apps/web in a checkout, the package's app in the CLI), not by the bundler
  const twDir = path.dirname(createRequire(path.join(process.cwd(), "noop.js")).resolve("tailwindcss/index.css"));
  const compiler = await compile(THEME_CSS, {
    base: twDir,
    loadStylesheet: async (id: string, base: string) => {
      const file = id === "tailwindcss" ? path.join(twDir, "index.css") : path.resolve(base, id);
      // only Tailwind's own stylesheets: nothing from the component or anywhere else on disk
      if (path.relative(twDir, file).startsWith("..")) throw new PreviewError(`Unexpected stylesheet ${id}`);
      return { path: file, base: path.dirname(file), content: await fs.readFile(file, "utf8") };
    },
  });
  return compiler.build(candidates);
}

const ENTRY = "__pivot_entry.js";

/** What renders: the demo's default export (else its first exported function), else the component's. */
function entrySource(file: ComponentFile) {
  const spec = `./${file.path.replace(/\.(tsx|ts|jsx|js)$/, "")}`;
  return `import * as M from ${JSON.stringify(spec)};
import { createElement } from "react";
import { createRoot } from "react-dom/client";
const Pick = M.default ?? Object.values(M).find((v) => typeof v === "function");
const theme = new URLSearchParams(location.search).get("theme") || "dark";
document.documentElement.classList.toggle("dark", theme === "dark");
if (!Pick) throw new Error("Nothing to render: the demo exports no component.");
createRoot(document.getElementById("root")).render(createElement(Pick));
requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ type: "21st-preview-ready" }, "*")));
`;
}

const inlineSafe = (s: string, tag: "script" | "style") => s.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

/** Bundles the files in `dir` (already installed) into one HTML page. */
export async function bundlePage(dir: string, c: Pick<ComponentMeta, "files">) {
  const files = c.files;
  const target = files.find((f) => f.role === "demo") ?? files.find((f) => f.role === "component");
  if (!target) throw new PreviewError("There is no demo or component file to render.");
  await fs.writeFile(path.join(dir, ENTRY), entrySource(target));
  const esbuild = await import("esbuild");
  let result;
  try {
    result = await esbuild.build({
      entryPoints: [path.join(dir, ENTRY)],
      absWorkingDir: dir,
      bundle: true,
      write: false,
      outdir: path.join(dir, "out"),
      format: "iife",
      platform: "browser",
      target: "es2020",
      minify: true,
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      tsconfig: path.join(dir, "tsconfig.json"),
      loader: {
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".webp": "dataurl",
        ".svg": "dataurl",
        ".woff": "dataurl",
        ".woff2": "dataurl",
      },
      logLevel: "silent",
    });
  } catch (err) {
    const msgs = (err as { errors?: { text: string }[] }).errors?.map((e) => e.text) ?? [String(err)];
    const missing = msgs.find((m) => /Could not resolve "@\//.test(m));
    throw new PreviewError(
      `Bundling failed: ${msgs.slice(0, 3).join("; ")}${
        missing
          ? ". A file it imports from the project isn't saved: save it as a support file with save_component."
          : ""
      }`,
    );
  }
  const js = result.outputFiles
    .filter((f) => f.path.endsWith(".js"))
    .map((f) => f.text)
    .join("\n");
  const css = result.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
  const tw = await tailwindCss(candidatesOf(files));
  return `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title><style>${inlineSafe(
    tw + "\n" + css,
    "style",
  )}</style></head><body><div id="root"></div><script>${inlineSafe(js, "script")}</script></body></html>`;
}

/** The build folder's name: a hash of everything that goes into it. */
function buildKey(c: ComponentMeta) {
  return createHash("sha256")
    .update(JSON.stringify({ files: c.files, deps: c.npmDependencies }))
    .digest("hex")
    .slice(0, 24);
}

/** Writes the files, the package.json, .npmrc and tsconfig into a fresh folder. */
async function prepare(dir: string, c: ComponentMeta) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const f of c.files) {
    const file = path.resolve(dir, f.path);
    if (path.relative(dir, file).startsWith("..") || path.isAbsolute(path.relative(dir, file)))
      throw new PreviewError(`The file ${f.path} would land outside the build folder.`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, f.code);
  }
  const dependencies: Record<string, string> = { react: "^19", "react-dom": "^19" };
  for (const d of c.npmDependencies) dependencies[d.name] = d.version || "latest";
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "pivot-component-preview", private: true, dependencies }, null, 2),
  );
  await fs.writeFile(
    path.join(dir, ".npmrc"),
    `registry=${REGISTRY}\nignore-scripts=true\naudit=false\nfund=false\npackage-lock=false\n`,
  );
  await fs.writeFile(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] }, jsx: "react-jsx" } }),
  );
}

async function setPreviewState(resourceId: string, preview: NonNullable<ComponentMeta["preview"]>) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const c = row && componentOf(row as { meta: Record<string, unknown> });
  if (!row || !c) return;
  // keep the last good preview showing while a new one builds or fails
  const keep =
    c.preview?.status === "ready" || c.preview?.sha256 ? { assetId: c.preview.assetId, sha256: c.preview.sha256 } : {};
  await db
    .update(resources)
    .set({ meta: { ...(row.meta ?? {}), component: { ...c, preview: { ...keep, ...preview } } } })
    .where(eq(resources.id, resourceId));
}

/** The one build running in this process, if any. */
let running: { resourceId: string; done: Promise<void> } | null = null;

export function isBuilding(resourceId?: string) {
  return !!running && (!resourceId || running.resourceId === resourceId);
}

/**
 * Starts building a component's preview and returns at once; the page follows `meta.component.preview.status`
 * (building → ready or failed, with the error). One build at a time. A rejected component is never built.
 */
export async function startComponentPreviewBuild(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const c = row && !row.deletedAt ? componentOf(row as { meta: Record<string, unknown> }) : null;
  if (!row || row.type !== "component" || !c) throw new PreviewError("No such component.");
  if (c.review?.verdict === "rejected" && c.review.codeSha256 === c.codeSha256)
    throw new PreviewError("This component was rejected in its review; PIVOT doesn't build it.");
  if (running) throw new PreviewError("Another preview is building; try again when it's done.");
  const startedAt = new Date().toISOString();
  await setPreviewState(resourceId, { status: "building", builtFrom: c.codeSha256, builtAt: startedAt });
  const done = (async () => {
    const dir = path.join(buildDeps.buildsDir(), buildKey(c));
    try {
      await prepare(dir, c);
      await buildDeps.npmInstall(dir);
      const html = await bundlePage(dir, c);
      if (Buffer.byteLength(html) > MAX_PREVIEW_BYTES)
        throw new PreviewError("The built preview is over 5 MB; PIVOT doesn't keep it.");
      await setComponentPreview(resourceId, html, { builtFrom: c.codeSha256 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setPreviewState(resourceId, {
        status: "failed",
        builtFrom: c.codeSha256,
        builtAt: startedAt,
        error: msg.slice(0, ERROR_CHARS),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      running = null;
    }
  })();
  running = { resourceId, done };
  return { status: "building" as const, done };
}
