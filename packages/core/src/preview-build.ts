// Builds a component's preview on this machine (docs/component-store-plan.md, Phase 5): the saved files and demo,
// bundled with esbuild and styled with Tailwind v4 into one self-contained HTML file, stored as the component's
// `component-preview` and served only by the preview origin (preview-server.ts). It runs only when the owner asks
// (Build preview), never on save, because it downloads the component's npm packages: from registry.npmjs.org only,
// with install scripts off, into <data folder>/component-builds/<hash>/, removed afterwards.
//
// A saved design (docs/my-designs-plan.md, Phase 3) builds the same way: a React design like a component (with its
// exact dependency versions), and a design with an HTML demo (three.js, GSAP, plain HTML) by bundling that page's
// scripts and styles and inlining them, its files as data URLs.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { getAsset, readAssetBytes, resolveMime } from "./assets";
import { MAX_PREVIEW_BYTES, PreviewError, previewHolder, setComponentPreview } from "./component-preview";
import { componentOf } from "./components";
import { dataDir } from "./config";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { importedPackages } from "./imports";
import { myDesignPreviewPlan } from "./preview-plan";
import type { ComponentMeta, MyDesignMeta, PreviewState } from "./types";

export { myDesignPreviewPlan };

/** A code file to build from: a component's or a saved design's. */
type BuildFile = { path: string; role: string; code: string };

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
function entrySource(file: { path: string }, centre: boolean) {
  const spec = `./${file.path.replace(/\.(tsx|ts|jsx|js)$/, "")}`;
  return `import * as M from ${JSON.stringify(spec)};
import { createElement } from "react";
import { createRoot } from "react-dom/client";
const Pick = M.default ?? Object.values(M).find((v) => typeof v === "function");
const theme = new URLSearchParams(location.search).get("theme") || "dark";
document.documentElement.classList.toggle("dark", theme === "dark");
if (!Pick) throw new Error("Nothing to render: the demo exports no component.");
const page = ${centre}
  ? createElement("div", { style: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "4rem 2rem", boxSizing: "border-box" } }, createElement(Pick))
  : createElement(Pick);
createRoot(document.getElementById("root")).render(page);
requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ type: "21st-preview-ready" }, "*")));
`;
}

const inlineSafe = (s: string, tag: "script" | "style") => s.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

/** Bundles the files in `dir` (already installed) into one HTML page. */
export async function bundlePage(dir: string, c: { files: BuildFile[] }, opts: { centre?: boolean } = {}) {
  const files = c.files;
  const script = (f: BuildFile) => /\.(tsx|ts|jsx|js|mjs)$/.test(f.path);
  const target =
    files.find((f) => f.role === "demo" && script(f)) ?? files.find((f) => f.role === "component" && script(f));
  if (!target) throw new PreviewError("There is no demo or component file to render.");
  // a demo lays out its own page; a 21st component saved without one is centred on the page, as 21st.dev shows it
  await fs.writeFile(path.join(dir, ENTRY), entrySource(target, !!opts.centre && target.role !== "demo"));
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
function buildKey(files: BuildFile[], deps: { name: string; version?: string }[]) {
  return createHash("sha256").update(JSON.stringify({ files, deps })).digest("hex").slice(0, 24);
}

/** `rel` inside `dir`, or a PreviewError naming it. */
function inside(dir: string, rel: string) {
  const file = path.resolve(dir, rel);
  const r = path.relative(dir, file);
  if (r.startsWith("..") || path.isAbsolute(r))
    throw new PreviewError(`The file ${rel} would land outside the build folder.`);
  return file;
}

/**
 * shadcn/ui and 21st.dev components import `cn` from "@/lib/utils", a file every shadcn project has
 * but a saved component rarely includes. When a script imports it and no lib/utils file was saved,
 * the build writes shadcn's standard one (clsx + tailwind-merge).
 */
const UTILS_SHIM = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

function needsUtilsShim(files: BuildFile[]) {
  const hasUtils = files.some((f) => /^(?:\.\/)?lib\/utils(?:\/index)?\.(?:[cm]?[jt]sx?)$/.test(f.path));
  return !hasUtils && files.some((f) => /\.[cm]?[jt]sx?$/.test(f.path) && /["']@\/lib\/utils["']/.test(f.code));
}

/** Writes the files, the package.json, .npmrc and tsconfig into a fresh folder. */
async function prepare(
  dir: string,
  files: BuildFile[],
  deps: { name: string; version?: string }[],
  opts: { react?: boolean; binary?: { path: string; data: Buffer }[] } = {},
) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const f of opts.binary ?? []) {
    const file = inside(dir, f.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, f.data);
  }
  for (const f of files) {
    const file = inside(dir, f.path);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, f.code);
  }
  const dependencies: Record<string, string> = opts.react === false ? {} : { react: "^19", "react-dom": "^19" };
  for (const d of deps) dependencies[d.name] = d.version || "latest";
  // what the code imports but the saved list doesn't name (21st's list is often empty): its latest version
  for (const name of importedPackages(files)) dependencies[name] ??= "latest";
  if (needsUtilsShim(files)) {
    await fs.mkdir(path.join(dir, "lib"), { recursive: true });
    await fs.writeFile(path.join(dir, "lib", "utils.ts"), UTILS_SHIM);
    dependencies.clsx ??= "^2";
    dependencies["tailwind-merge"] ??= "^3";
  }
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

async function setPreviewState(resourceId: string, preview: PreviewState) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const holder = row && previewHolder(row);
  if (!row || !holder) return;
  const c = holder.value;
  // keep the last good preview showing while a new one builds or fails
  const keep =
    c.preview?.status === "ready" || c.preview?.sha256 ? { assetId: c.preview.assetId, sha256: c.preview.sha256 } : {};
  await db
    .update(resources)
    .set({ meta: { ...(row.meta ?? {}), [holder.key]: { ...c, preview: { ...keep, ...preview } } } })
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
  return runBuild(resourceId, c.codeSha256, buildKey(c.files, c.npmDependencies), async (dir) => {
    await prepare(dir, c.files, c.npmDependencies);
    await buildDeps.npmInstall(dir);
    return bundlePage(dir, c, { centre: true });
  });
}

/**
 * Runs one build: marks it building, runs `work` in a fresh build folder, stores the page it returns (at most 5 MB)
 * or the error, and removes the folder. One build at a time in this process.
 */
async function runBuild(resourceId: string, codeSha256: string, key: string, work: (dir: string) => Promise<string>) {
  if (running) throw new PreviewError("Another preview is building; try again when it's done.");
  const startedAt = new Date().toISOString();
  await setPreviewState(resourceId, { status: "building", builtFrom: codeSha256, builtAt: startedAt });
  const done = (async () => {
    const dir = path.join(buildDeps.buildsDir(), key);
    try {
      const html = await work(dir);
      if (Buffer.byteLength(html) > MAX_PREVIEW_BYTES)
        throw new PreviewError("The built preview is over 5 MB; PIVOT doesn't keep it.");
      await setComponentPreview(resourceId, html, { builtFrom: codeSha256 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setPreviewState(resourceId, {
        status: "failed",
        builtFrom: codeSha256,
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

// ---- saved designs ------------------------------------------------------------------------------------------------

const DATA_EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|wav|ogg|glb|gltf|hdr|bin|json)$/i;
const isRemote = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

/**
 * Bundles a design's HTML demo into one page: each local module script bundled with esbuild (its npm packages from the
 * build folder) and moved to the end of the body, as a module would run; classic scripts and stylesheets inlined; local
 * images, media and fonts as data URLs. A script loaded from the network fails the build: the preview has none.
 */
export async function bundleHtmlPage(dir: string, htmlPath: string) {
  const htmlFile = inside(dir, htmlPath);
  const $ = cheerio.load(await fs.readFile(htmlFile, "utf8"));
  const base = path.dirname(htmlFile);
  const local = (ref: string) => {
    const clean = ref.split(/[?#]/)[0];
    if (!clean || isRemote(ref)) return null;
    return inside(dir, clean.startsWith("/") ? clean.slice(1) : path.relative(dir, path.resolve(base, clean)));
  };
  const exists = async (f: string) => !!(await fs.stat(f).catch(() => null))?.isFile();
  const dataUrl = async (f: string) => `data:${resolveMime(f)};base64,${(await fs.readFile(f)).toString("base64")}`;
  const esbuild = await import("esbuild");
  const loader = Object.fromEntries(
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "avif",
      "svg",
      "woff",
      "woff2",
      "ttf",
      "otf",
      "glb",
      "hdr",
      "bin",
      "mp3",
      "wav",
      "mp4",
      "webm",
    ].map((e) => [`.${e}`, "dataurl" as const]),
  );
  const bundle = async (entry: string) => {
    try {
      const r = await esbuild.build({
        entryPoints: [entry],
        absWorkingDir: dir,
        bundle: true,
        write: false,
        outdir: path.join(dir, "out"),
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify: true,
        jsx: "automatic",
        define: {
          "process.env.NODE_ENV": '"production"',
          "import.meta.env": '{"MODE":"production","PROD":true,"DEV":false,"BASE_URL":"/"}',
        },
        loader,
        logLevel: "silent",
      });
      return {
        js: r.outputFiles
          .filter((f) => f.path.endsWith(".js"))
          .map((f) => f.text)
          .join("\n"),
        css: r.outputFiles
          .filter((f) => f.path.endsWith(".css"))
          .map((f) => f.text)
          .join("\n"),
      };
    } catch (err) {
      const msgs = (err as { errors?: { text: string }[] }).errors?.map((e) => e.text) ?? [String(err)];
      const bare = msgs.map((m) => /Could not resolve "([^"./][^"]*)"/.exec(m)?.[1]).find(Boolean);
      throw new PreviewError(
        `Bundling failed: ${msgs.slice(0, 3).join("; ")}${
          bare ? `. Save "${bare}" with its exact version in the design's dependencies.` : ""
        }`,
      );
    }
  };

  const tail: string[] = [];
  let n = 0;
  for (const el of $("script").toArray()) {
    const s = $(el);
    const type = (s.attr("type") ?? "").trim().toLowerCase();
    const src = s.attr("src");
    if (type === "importmap") {
      s.remove(); // bare imports resolve from the build folder's packages instead
      continue;
    }
    const isModule = type === "module";
    if (type && !isModule && type !== "text/javascript" && type !== "application/javascript") continue; // shaders, JSON
    if (src && isRemote(src))
      throw new PreviewError(
        `The demo loads ${src} from the network, and the preview has none. Save that library in the design's dependencies (an exact version) and import it, or save the file with the design.`,
      );
    const file = src ? local(src) : null;
    if (src && (!file || !(await exists(file))))
      throw new PreviewError(`The demo's script ${src} isn't among the design's saved files.`);
    if (!isModule) {
      // a classic script keeps its globals: inlined as it is, where it was
      const code = file ? await fs.readFile(file, "utf8") : (s.html() ?? "");
      s.replaceWith(`<script>${inlineSafe(code, "script")}</script>`);
      continue;
    }
    let entry = file;
    if (!entry) {
      entry = path.join(base, `__pivot_inline_${n++}.mjs`);
      await fs.writeFile(entry, s.html() ?? "");
    }
    const out = await bundle(entry);
    if (out.css) $("head").append(`<style>${inlineSafe(out.css, "style")}</style>`);
    tail.push(`<script>${inlineSafe(out.js, "script")}</script>`);
    s.remove();
  }
  for (const el of $('link[rel~="stylesheet"][href]').toArray()) {
    const l = $(el);
    const file = local(l.attr("href")!);
    if (!file) continue; // a stylesheet from the network (web fonts): the preview's policy blocks it, the page still renders
    if (!(await exists(file)))
      throw new PreviewError(`The demo's stylesheet ${l.attr("href")} isn't among the design's saved files.`);
    const out = await bundle(file);
    l.replaceWith(`<style>${inlineSafe(out.css, "style")}</style>`);
  }
  const media: [string, string][] = [
    ["img", "src"],
    ["source", "src"],
    ["video", "src"],
    ["video", "poster"],
    ["audio", "src"],
    ["link[rel~='icon']", "href"],
    ["image", "href"],
  ];
  for (const [sel, attr] of media) {
    for (const el of $(`${sel}[${attr}]`).toArray()) {
      const ref = $(el).attr(attr)!;
      const file = local(ref);
      if (file && DATA_EXT.test(file) && (await exists(file))) $(el).attr(attr, await dataUrl(file));
    }
  }
  const ready = `<script>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({type:"21st-preview-ready"},"*")))</script>`;
  $("body").append(tail.join("") + ready);
  return $.html();
}

/**
 * Starts building a saved design's preview and returns at once; the page follows `meta.myDesign.preview.status`. An
 * HTML demo installs npm packages only when the design lists some (exact versions); a React design always does.
 */
export async function startMyDesignPreviewBuild(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const d = row && !row.deletedAt && row.type === "my_design" ? (row.meta?.myDesign as MyDesignMeta | undefined) : null;
  if (!row || !d) throw new PreviewError("No such design.");
  const plan = myDesignPreviewPlan(d);
  if (plan.kind === "none") throw new PreviewError(plan.reason);
  const deps = d.dependencies;
  return runBuild(resourceId, d.codeSha256, buildKey(d.files, [...deps, { name: plan.kind }]), async (dir) => {
    const binary: { path: string; data: Buffer }[] = [];
    for (const a of d.assets) {
      const row = await getAsset(a.assetId);
      const data = row && (await readAssetBytes(row));
      if (data) binary.push({ path: a.path, data });
    }
    await prepare(dir, d.files, deps, { react: plan.kind === "react", binary });
    if (plan.kind === "react") {
      await buildDeps.npmInstall(dir);
      return bundlePage(dir, d);
    }
    if (deps.length) await buildDeps.npmInstall(dir);
    return bundleHtmlPage(dir, plan.file);
  });
}
