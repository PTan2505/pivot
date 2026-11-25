// A saved design's live preview and its zip download (docs/my-designs-plan.md, Phase 3). The designs here are fixtures
// written for the test, and the npm install is stubbed (React from this checkout and a fake package), so it runs
// offline.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MyDesignMeta } from "../src/types";

let tmp: string;
let designs: typeof import("../src/my-designs");
let build: typeof import("../src/preview-build");
let preview: typeof import("../src/component-preview");
let resources: typeof import("../src/resources");
let zip: typeof import("../src/zip");
let db: typeof import("../src/db/client");
const installs: string[] = [];
let lastPackage: { dependencies: Record<string, string> } | null = null;

const webRequire = createRequire(path.resolve(__dirname, "../../../apps/web/package.json"));
const pkgDir = (name: string) => path.dirname(webRequire.resolve(`${name}/package.json`));

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-design-preview-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  designs = await import("../src/my-designs");
  build = await import("../src/preview-build");
  preview = await import("../src/component-preview");
  resources = await import("../src/resources");
  zip = await import("../src/zip");
  db = await import("../src/db/client");
  build.buildDeps.npmInstall = async (dir: string) => {
    installs.push(dir);
    lastPackage = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
    const nm = path.join(dir, "node_modules");
    await fsp.mkdir(nm, { recursive: true });
    for (const name of ["react", "react-dom", "scheduler"]) {
      await fsp.symlink(pkgDir(name), path.join(nm, name), "junction").catch(() => {});
    }
    await fsp.mkdir(path.join(nm, "fixture-greeting"), { recursive: true });
    await fsp.writeFile(
      path.join(nm, "fixture-greeting", "package.json"),
      JSON.stringify({ name: "fixture-greeting", version: "1.0.0", main: "index.js" }),
    );
    await fsp.writeFile(path.join(nm, "fixture-greeting", "index.js"), 'exports.greet = (n) => "Hello, " + n;');
  };
});
afterAll(async () => {
  await db.closeDb();
  await fsp.rm(tmp, { recursive: true, force: true });
});

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="./src/style.css" />
    <link rel="stylesheet" href="https://fonts.example.com/css?family=Inter" />
    <script>window.CLASSIC_GLOBAL = 1;</script>
    <script type="importmap">{ "imports": { "fixture-greeting": "https://cdn.example.com/greeting.js" } }</script>
    <script type="module" src="./src/main.js"></script>
    <script type="x-shader/x-fragment" id="frag">void main() { gl_FragColor = vec4(1.0); }</script>
  </head>
  <body>
    <img src="logo.svg" alt="Logo" />
    <div id="out"></div>
    <script type="module">
      import { greet } from "fixture-greeting";
      document.getElementById("out").textContent = greet("inline module");
    </script>
  </body>
</html>
`;
const MAIN = `import "./main.css";
import { greet } from "fixture-greeting";
document.body.dataset.greet = greet("PIVOT") + " " + import.meta.env.MODE;
`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;

const htmlDesign = (over: Record<string, unknown> = {}) => ({
  name: "Greeting page",
  kind: "page",
  ownership: "personal",
  files: [
    { path: "index.html", role: "demo", code: HTML },
    { path: "src/main.js", role: "component", code: MAIN },
    { path: "src/main.css", role: "style", code: ".from-main{color:#ff8c42}\n" },
    { path: "src/style.css", role: "style", code: "body{background:url(../logo.svg) no-repeat}\n" },
  ],
  dependencies: [{ name: "fixture-greeting", version: "1.0.0" }],
  usage: "Open index.html; the greeting fills #out.",
  ...over,
});

const stateOf = async (id: string) => ((await resources.getResource(id))!.meta.myDesign as MyDesignMeta).preview;
const pageOf = async (sha256: string) => {
  const asset = (await preview.findPreviewAsset(sha256))!;
  return fs.readFileSync(path.join(tmp, "data", asset.storagePath), "utf8");
};

describe("a saved design's live preview", () => {
  it("bundles an HTML demo into one page: module scripts bundled, styles and files inlined, nothing loaded", async () => {
    const { resource } = await designs.saveMyDesign(htmlDesign());
    await designs.addMyDesignAsset(resource.id, {
      data: Buffer.from(SVG),
      fileName: "logo.svg",
      mimeType: "image/svg+xml",
      role: "design-asset",
      path: "logo.svg",
    });
    const before = installs.length;
    const started = await build.startMyDesignPreviewBuild(resource.id);
    expect(await stateOf(resource.id)).toMatchObject({ status: "building" });
    await started.done;
    const p = await stateOf(resource.id);
    expect(p).toMatchObject({ status: "ready", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(installs.length).toBe(before + 1); // it lists a dependency, so its packages were installed
    const html = await pageOf(p!.sha256!);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/type="importmap"/);
    expect(html).not.toMatch(/<link[^>]+href="\.\/src\/style\.css"/);
    expect(html).toContain("fonts.example.com"); // a network stylesheet stays; the preview's policy blocks it
    expect(html).toContain("window.CLASSIC_GLOBAL = 1"); // a classic script runs as it was, keeping its globals
    expect(html).toContain("gl_FragColor"); // a shader block is left alone
    expect(html).toContain("Hello, "); // the npm package was bundled into both module scripts
    expect(html).toContain('"production"'); // import.meta.env.MODE
    expect(html).toMatch(/\.from-main\{color:#ff8c42\}/); // CSS imported by a module
    expect(html).toMatch(/src="data:image\/svg\+xml;base64,/); // the <img> from the design's files
    expect(html).toMatch(/url\('?data:image\/svg\+xml/); // the stylesheet's url() from the design's files
    expect(html).toContain("21st-preview-ready");
    // module scripts run after the page, as modules would: they sit at the end of the body
    expect(html.indexOf("Hello, ")).toBeGreaterThan(html.indexOf('id="out"'));
    expect(fs.existsSync(installs.at(-1)!)).toBe(false);
  });

  it("installs nothing for an HTML demo without dependencies", async () => {
    const { resource } = await designs.saveMyDesign({
      name: "Plain page",
      kind: "page",
      ownership: "personal",
      files: [{ path: "demo/index.html", role: "demo", code: "<!doctype html><p>Plain</p>" }],
      usage: "Open it.",
    });
    const before = installs.length;
    await (
      await build.startMyDesignPreviewBuild(resource.id)
    ).done;
    expect(await stateOf(resource.id)).toMatchObject({ status: "ready" });
    expect(installs.length).toBe(before);
  });

  it("builds a React design like a component, with its saved versions", async () => {
    const { resource } = await designs.saveMyDesign({
      name: "Greeting card",
      kind: "component",
      ownership: "company",
      organisation: "ODIN",
      files: [
        {
          path: "Greeting.tsx",
          role: "component",
          code: 'import { greet } from "fixture-greeting";\nexport default function Greeting() {\n  return <p className="text-2xl">{greet("card")}</p>;\n}\n',
        },
      ],
      dependencies: [
        { name: "react", version: "19.2.0" },
        { name: "fixture-greeting", version: "1.0.0" },
      ],
      usage: "Render <Greeting />.",
    });
    await (
      await build.startMyDesignPreviewBuild(resource.id)
    ).done;
    const p = await stateOf(resource.id);
    expect(p).toMatchObject({ status: "ready" });
    // the saved exact versions, React included, never a range
    expect(lastPackage!.dependencies).toEqual({
      react: "19.2.0",
      "react-dom": "^19",
      "fixture-greeting": "1.0.0",
    });
    const html = await pageOf(p!.sha256!);
    expect(html).toContain("Hello, ");
    expect(html).toContain(".text-2xl");
  });

  it("fails clearly on a script from the network, keeps no page, and refuses a design it can't build", async () => {
    const { resource } = await designs.saveMyDesign(
      htmlDesign({
        name: "CDN page",
        files: [
          {
            path: "index.html",
            role: "demo",
            code: '<!doctype html><script src="https://cdn.example.com/three.js"></script>',
          },
        ],
        dependencies: [],
      }),
    );
    await (
      await build.startMyDesignPreviewBuild(resource.id)
    ).done;
    const p = await stateOf(resource.id);
    expect(p).toMatchObject({ status: "failed", error: expect.stringMatching(/from the network/) });
    expect(p!.sha256).toBeUndefined();

    const vue = await designs.saveMyDesign({
      name: "Vue card",
      kind: "component",
      ownership: "personal",
      files: [{ path: "Card.vue", role: "component", code: "<template><p>Card</p></template>\n" }],
      usage: "Use <Card />.",
    });
    await expect(build.startMyDesignPreviewBuild(vue.resource.id)).rejects.toThrow(/neither/);
    const ref = await resources.createResource({ type: "reference", title: "R", sourceUrl: "https://a.dev" });
    await expect(build.startMyDesignPreviewBuild(ref.id)).rejects.toThrow(/No such design/);
  });

  it("keeps the preview when the design is saved again or gets a file, and serves it only while it isn't trashed", async () => {
    const { resource } = await designs.saveMyDesign({
      name: "Kept page",
      kind: "page",
      ownership: "personal",
      files: [{ path: "index.html", role: "demo", code: "<!doctype html><p>Kept</p>" }],
      usage: "Open it.",
    });
    await (
      await build.startMyDesignPreviewBuild(resource.id)
    ).done;
    const sha = (await stateOf(resource.id))!.sha256!;
    await designs.saveMyDesign({
      id: resource.id,
      name: "Kept page",
      kind: "page",
      ownership: "personal",
      files: [{ path: "index.html", role: "demo", code: "<!doctype html><p>Kept</p>" }],
      usage: "Open it, then scroll.",
    });
    await designs.addMyDesignAsset(resource.id, {
      data: Buffer.from(SVG),
      fileName: "mark.svg",
      role: "design-asset",
      path: "mark.svg",
    });
    expect(await stateOf(resource.id)).toMatchObject({ status: "ready", sha256: sha });
    expect(await preview.findPreviewAsset(sha)).not.toBeNull();
    await resources.trashResources([resource.id]);
    expect(await preview.findPreviewAsset(sha)).toBeNull();
  });
});

// ---- the zip ------------------------------------------------------------------------------------------------------

/** Reads a zip's central directory and inflates each entry, checking its CRC. */
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(local + 26);
    const body = buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    expect(zlib.crc32(data) >>> 0).toBe(crc);
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

describe("download as zip", () => {
  it("writes entries any unzip reads, stored or deflated, with UTF-8 names", () => {
    const files = [
      { path: "a.txt", data: Buffer.from("x".repeat(5000)) },
      { path: "dir/ü.bin", data: Buffer.from([1, 2, 3]) },
      { path: "empty.txt", data: Buffer.alloc(0) },
    ];
    const z = zip.zipFiles(files);
    const back = unzip(z);
    for (const f of files) expect(back.get(f.path)?.equals(f.data)).toBe(true);
    const which = spawnSync("unzip", ["-v"]);
    if (which.status === 0) {
      const file = path.join(tmp, "check.zip");
      fs.writeFileSync(file, z);
      expect(spawnSync("unzip", ["-t", file]).status).toBe(0);
    }
  });

  it("holds the design's files byte for byte at their paths, and its notes and screenshots under _pivot/", async () => {
    const { resource } = await designs.saveMyDesign(
      htmlDesign({ name: "Zip me: page!", tokens: [{ name: "--x", value: "1px" }] }),
    );
    await designs.addMyDesignAsset(resource.id, {
      data: Buffer.from(SVG),
      fileName: "logo.svg",
      role: "design-asset",
      path: "logo.svg",
    });
    const png = await (
      await import("sharp")
    )
      .default({
        create: { width: 4, height: 3, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
      .png()
      .toBuffer();
    await designs.addMyDesignAsset(resource.id, {
      data: png,
      fileName: "desktop.png",
      role: "design-shot",
      viewport: "desktop",
    });
    const { fileName, data } = await designs.myDesignArchive(resource.id);
    expect(fileName).toBe("zip-me-page.zip");
    const back = unzip(data);
    const d = (await resources.getResource(resource.id))!.meta.myDesign as MyDesignMeta;
    for (const f of d.files) expect(back.get(f.path)?.toString("utf8")).toBe(f.code);
    expect(back.get("logo.svg")?.toString()).toBe(SVG);
    const notes = back.get("_pivot/USAGE.md")!.toString();
    expect(notes).toContain("# Zip me: page!");
    expect(notes).toContain("fixture-greeting@1.0.0");
    expect(notes).toContain("`--x`: `1px`");
    expect(notes).toContain("Open index.html");
    expect(back.get("_pivot/screenshots/1-desktop.png")?.equals(png)).toBe(true);
    await expect(designs.myDesignArchive("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/no saved design/);
  });
});
