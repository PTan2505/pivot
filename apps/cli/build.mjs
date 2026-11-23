// Builds the npm package's dist/ from this checkout:
//   app/         the web app as a Next.js standalone server (server.js, .next/, public/), without the build machine's
//                node_modules: npm installs the runtime packages listed in package.json for each machine instead, and
//                app/externals.json names the hashed links `start` recreates (lib/externals.mjs)
//   migrations/  the database migrations (PIVOT_MIGRATIONS_DIR)
//   scripts/     the design skill's preview.mjs and motion-qa.mjs (pivot-studio preview / motion-qa), and the
//                motion-fit.mjs motion-qa imports
//   extension/   the built Chrome extension (pivot-studio extension)
//
//   node build.mjs                 build the web app and the extension, then assemble dist/
//   node build.mjs --skip-builds   assemble dist/ from the last builds
//   node build.mjs --check-built   only check that dist/ is complete (prepack)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const web = path.join(repo, "apps/web");
const out = path.join(here, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

/** What a complete dist/ holds; prepack refuses to publish without it. */
export const REQUIRED = [
  "app/server.js",
  "app/package.json",
  "app/externals.json",
  "app/.next/BUILD_ID",
  "app/.next/static",
  "migrations/meta/_journal.json",
  "scripts/preview.mjs",
  "scripts/motion-qa.mjs",
  "scripts/motion-fit.mjs",
  "extension/manifest.json",
  "THIRD_PARTY_NOTICES.md",
];

/** The runtime packages the server needs installed: everything it loads from node_modules, pinned to the build's. */
export const RUNTIME = Object.keys(pkg.dependencies);

/** The version of a package the web app was built with. */
export function builtVersion(name) {
  return JSON.parse(fs.readFileSync(path.join(web, "node_modules", name, "package.json"), "utf8")).version;
}

/** Hashed external name → package name, from the links the standalone build made in .next/node_modules. */
export function externalsOf(dir) {
  const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const [k, v] of Object.entries(externalsOf(p))) map[`${entry.name}/${k}`] = v;
      continue;
    }
    if (!entry.isSymbolicLink()) throw new Error(`Unexpected ${p}: the build should only link packages here`);
    const target = fs.readlinkSync(p).split(path.sep).join("/");
    const name = target.slice(target.lastIndexOf("node_modules/") + "node_modules/".length);
    map[entry.name] = name;
  }
  return map;
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: repo, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function check() {
  const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(out, f)));
  if (missing.length) throw new Error(`dist/ is incomplete (${missing.join(", ")}): run node build.mjs first`);
}

function main(argv) {
  if (argv.includes("--check-built")) return check();

  if (!argv.includes("--skip-builds")) {
    // a throwaway data folder and no database or bucket: building must never touch a real library
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-studio-build-"));
    run("pnpm", ["--filter", "web", "exec", "next", "build"], {
      PIVOT_STANDALONE: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      PIVOT_DATA_DIR: scratch,
      DATABASE_URL: "",
      R2_BUCKET: "",
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "",
      R2_SECRET_ACCESS_KEY: "",
    });
    fs.rmSync(scratch, { recursive: true, force: true });
    run("pnpm", ["--filter", "extension", "build"]);
  }

  const standalone = path.join(web, ".next/standalone/apps/web");
  if (!fs.existsSync(path.join(standalone, "server.js")))
    throw new Error("No standalone build: run node build.mjs without --skip-builds");

  for (const name of RUNTIME) {
    const v = builtVersion(name);
    if (pkg.dependencies[name] !== v)
      throw new Error(`package.json pins ${name} ${pkg.dependencies[name]}, but the app was built with ${v}`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  const app = path.join(out, "app");
  fs.mkdirSync(app, { recursive: true });
  fs.copyFileSync(path.join(standalone, "server.js"), path.join(app, "server.js"));
  // the server and its chunks are CommonJS, inside a "type": "module" package
  fs.writeFileSync(
    path.join(app, "package.json"),
    JSON.stringify({ name: "pivot-studio-app", private: true, type: "commonjs" }, null, 2) + "\n",
  );
  fs.cpSync(path.join(standalone, ".next"), path.join(app, ".next"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(path.join(standalone, ".next"), src).split(path.sep);
      return rel[0] !== "node_modules" && rel[0] !== "cache";
    },
  });
  fs.cpSync(path.join(web, ".next/static"), path.join(app, ".next/static"), { recursive: true });
  if (fs.existsSync(path.join(web, "public")))
    fs.cpSync(path.join(web, "public"), path.join(app, "public"), { recursive: true });

  const externals = externalsOf(path.join(standalone, ".next/node_modules"));
  const unknown = [...new Set(Object.values(externals))].filter((n) => !RUNTIME.includes(n));
  if (unknown.length) throw new Error(`The server loads ${unknown.join(", ")}: add them to package.json dependencies`);
  fs.writeFileSync(path.join(app, "externals.json"), JSON.stringify(externals, null, 2) + "\n");

  fs.cpSync(path.join(repo, "packages/core/src/db/migrations"), path.join(out, "migrations"), { recursive: true });
  fs.mkdirSync(path.join(out, "scripts"));
  for (const f of ["preview.mjs", "motion-qa.mjs", "motion-fit.mjs"])
    fs.copyFileSync(path.join(repo, "plugin/skills/design/scripts", f), path.join(out, "scripts", f));
  fs.cpSync(path.join(repo, "apps/extension/dist"), path.join(out, "extension"), { recursive: true });
  // the built app includes third-party code under its own terms (GSAP among them)
  fs.copyFileSync(path.join(repo, "THIRD_PARTY_NOTICES.md"), path.join(out, "THIRD_PARTY_NOTICES.md"));

  check();
  console.log(`Built ${path.relative(process.cwd(), out)} for pivot-studio ${pkg.version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
