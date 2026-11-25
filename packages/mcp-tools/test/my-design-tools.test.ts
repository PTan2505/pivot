// My designs, Phase 2 (docs/my-designs-plan.md): save_my_design reads the files from disk under root (never retyped),
// refuses what leaves the folder or can hold secrets, and get_my_design writes them back byte for byte without ever
// overwriting a file that differs. search_references finds the owner's designs and marks them as Yours.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MyDesignMeta, ResourceDetailDTO, SearchRequest } from "@pivot/core/types";
import { ToolError, type MyDesignUploadInput, type PivotSource, type PivotWriter } from "../src/source";
import { runTool, TOOLS } from "../src/tools";
import { WRITE_TOOLS } from "../src/write-tools";

const ID = "11111111-2222-4333-8444-555555555555";
const tool = (name: string) => [...TOOLS, ...WRITE_TOOLS].find((t) => t.name === name)!;
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const textOf = (res: { content: { type: string; text?: string }[] }) => (res.content[0] as { text: string }).text;

// a three.js-style design: a component, its tokens, a demo page and an SVG, plus bytes a retype would get wrong
const HERO = [
  "import * as THREE from 'three';",
  "// “curly quotes”, a tab\there, CRLF next\r",
  "export function mountHero(el) { el.dataset.mark = '⌘'; }",
  "",
].join("\n");
const TOKENS = ":root {\r\n  --color-ember: #ff5a1f;\r\n}\r\n";
const DEMO = "<!doctype html><div id=hero></div><script type=module src=./hero.js></script>\n";
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>\n');
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

let tmp: string;
let root: string;
let outside: string;

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pivot-my-design-tools-")));
  root = path.join(tmp, "project");
  outside = path.join(tmp, "elsewhere");
  await fs.mkdir(path.join(root, "src/hero"), { recursive: true });
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "src/hero/hero.js"), HERO);
  await fs.writeFile(path.join(root, "src/hero/tokens.css"), TOKENS);
  await fs.writeFile(path.join(root, "src/hero/index.html"), DEMO);
  await fs.writeFile(path.join(root, "public/odin-mark.svg"), SVG);
  await fs.writeFile(path.join(root, "hero-desktop.png"), PNG);
  await fs.writeFile(path.join(tmp, "hero-mobile.png"), PNG);
  await fs.writeFile(path.join(root, ".env.local"), "TOKEN=nope\n");
  await fs.writeFile(path.join(root, "latin1.js"), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  await fs.writeFile(path.join(outside, "secret.js"), "export const x = 1;\n");
  await fs.symlink(path.join(outside, "secret.js"), path.join(root, "src/hero/linked.js"));
  await fs.symlink(path.join(root, ".env.local"), path.join(root, "src/hero/config.js"));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** An in-memory PIVOT that keeps designs the way the app does: code as text, files by asset id. */
function fakePivot() {
  const designs = new Map<string, ResourceDetailDTO>();
  const blobs = new Map<string, Buffer>();
  const saves: Record<string, unknown>[] = [];
  const uploads: MyDesignUploadInput[] = [];
  const codeSha = (files: { path: string; code: string }[]) =>
    sha(JSON.stringify([...files].sort((a, b) => a.path.localeCompare(b.path))));

  const writer: Partial<PivotWriter> = {
    appUrl: "http://127.0.0.1:4400",
    saveDesignBrief: async () => ({ sessionId: ID, snapshotId: "s", created: true, duplicate: false }),
    async saveMyDesign(input) {
      saves.push(input);
      const files = input.files as { path: string; role: string; code: string }[];
      const id = (input.id as string | undefined) ?? ID;
      const prev = designs.get(id);
      const prevMeta = prev?.meta.myDesign as MyDesignMeta | undefined;
      if (prevMeta && prevMeta.codeSha256 !== codeSha(files) && !input.replaceCode) {
        throw new ToolError(
          "conflict",
          "PIVOT already holds different code for this design (saved 2026-11-24). Pass replaceCode: true only if the owner asked to replace it.",
        );
      }
      const meta = {
        kind: input.kind,
        files: files.map((f) => ({ ...f, language: f.path.split(".").pop() })),
        dependencies: (input.dependencies as unknown[]) ?? [],
        install: (input.install as unknown[]) ?? [],
        usage: input.usage,
        tokens: (input.tokens as unknown[]) ?? [],
        source: { project: (input.source as { project?: string }).project },
        assets: prevMeta?.assets ?? [],
        codeSha256: codeSha(files),
        scan: { version: 1, codeSha256: codeSha(files), flags: [], hosts: [] },
        savedAt: "2026-11-24T01:00:00.000Z",
        codeSavedAt: "2026-11-24T01:00:00.000Z",
      } as unknown as MyDesignMeta;
      const resource = {
        id,
        type: "my_design",
        title: input.name,
        meta: { myDesign: meta },
        assets: prev?.assets ?? [],
        tags: [],
      } as unknown as ResourceDetailDTO;
      designs.set(id, resource);
      return { outcome: prev ? "updated" : "created", resource };
    },
    async addMyDesignAsset(id, upload) {
      uploads.push(upload);
      const r = designs.get(id)!;
      const assetId = `asset-${sha(upload.data).slice(0, 12)}`;
      blobs.set(assetId, upload.data);
      r.assets.push({
        id: assetId,
        role: upload.role,
        kind: upload.role === "design-video" ? "video" : "image",
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        size: upload.data.length,
        width: 1440,
        height: 900,
        meta: upload.viewport ? { viewport: upload.viewport } : {},
      } as never);
      if (upload.path) {
        const d = r.meta.myDesign as MyDesignMeta;
        d.assets = [
          ...d.assets.filter((a) => a.path !== upload.path),
          { path: upload.path, assetId, sha256: sha(upload.data), size: upload.data.length },
        ];
      }
      return r;
    },
  };
  const searches: SearchRequest[] = [];
  const source = {
    search: async (req: SearchRequest) => {
      searches.push(req);
      return {
        results: [
          {
            id: ID,
            type: "my_design",
            title: "ODIN 3D logo hero",
            host: null,
            sourceUrl: null,
            description: "",
            facets: [],
            hasScreenshot: true,
            myDesign: { kind: "3d" },
            createdAt: "",
            updatedAt: "",
          },
        ],
        total: 1,
        nextCursor: null,
        sort: "relevance",
      };
    },
    getResource: async (id: string) => designs.get(id) ?? null,
    listTags: async () => [],
    listCollections: async () => [],
    counts: async () => ({}),
    listSources: async () => [],
    agentImage: async () => ({ data: PNG, mimeType: "image/png", width: 1440, height: 900 }),
    agentSlices: async () => ({ slices: [], total: 0, pageWidth: 0, pageHeight: 0 }),
    findMyDesign: async (q: { id?: string; name?: string }) =>
      q.id
        ? (designs.get(q.id) ?? null)
        : ([...designs.values()].find((d) => d.title.toLowerCase() === q.name!.toLowerCase()) ?? null),
    assetData: async (assetId: string) => blobs.get(assetId) ?? null,
    ...writer,
  } as unknown as PivotSource & PivotWriter;
  return { source, designs, blobs, saves, uploads, searches };
}

const base = () => ({
  name: "ODIN 3D logo hero",
  kind: "3d",
  root,
  files: [
    { path: "src/hero/hero.js", role: "component" },
    { path: "src/hero/tokens.css", role: "style" },
    { path: "src/hero/index.html", role: "demo" },
  ],
  assets: ["public/odin-mark.svg"],
  screenshots: ["hero-desktop.png", path.join(tmp, "hero-mobile.png")],
  dependencies: [{ name: "three", version: "0.170.0" }],
  install: ["npm install three@0.170.0"],
  usage: "Mount with mountHero(el) on a sized element; load tokens.css first.",
  tokens: [{ name: "--color-ember", value: "#ff5a1f" }],
  sourceProject: "odin-web",
});

describe("save_my_design", () => {
  let pivot: ReturnType<typeof fakePivot>;
  beforeEach(() => {
    pivot = fakePivot();
  });

  it("reads every file from disk under root, so PIVOT keeps the original's exact text", async () => {
    const res = await runTool(tool("save_my_design"), pivot.source, base());
    expect(res.isError).toBeFalsy();
    const files = pivot.saves[0].files as { path: string; role: string; code: string }[];
    expect(files.map((f) => [f.path, f.role])).toEqual([
      ["src/hero/hero.js", "component"],
      ["src/hero/tokens.css", "style"],
      ["src/hero/index.html", "demo"],
    ]);
    expect(files[0].code).toBe(HERO);
    expect(files[1].code).toBe(TOKENS);
    expect(pivot.saves[0]).not.toHaveProperty("organisation");
    expect(pivot.saves[0]).toMatchObject({
      // an app before pivot-studio 0.7.0 still requires it; a newer one ignores it
      ownership: "personal",
      source: {
        project: "odin-web",
        folder: root,
        paths: ["src/hero/hero.js", "src/hero/tokens.css", "src/hero/index.html"],
      },
    });
    // the SVG with its path, the screenshots with their viewport from the name (relative to root, or absolute)
    expect(pivot.uploads.map((u) => [u.role, u.path ?? u.viewport, u.mimeType])).toEqual([
      ["design-asset", "public/odin-mark.svg", "image/svg+xml"],
      ["design-shot", "desktop", "image/png"],
      ["design-shot", "mobile", "image/png"],
    ]);
    expect(pivot.uploads[0].data.equals(SVG)).toBe(true);
    const t = textOf(res);
    expect(t).toContain(`Saved "ODIN 3D logo hero" in My designs: http://127.0.0.1:4400/r/${ID}`);
    expect(t).toContain(`PIVOT id ${ID} · 3d\n`);
    expect(t).toContain("- src/hero/hero.js (component, ");
    expect(t).toContain("Dependencies: three@0.170.0");
    expect(t).toContain(
      "Added: public/odin-mark.svg, screenshot hero-desktop.png (desktop), screenshot hero-mobile.png (mobile)",
    );
    expect(res.structuredContent).toMatchObject({
      outcome: "created",
      id: ID,
      files: [{ path: "src/hero/hero.js", sha256: sha(HERO) }, {}, {}],
      failed: [],
    });
    expect(tool("save_my_design").description).toMatch(/Only when the owner asks/);
    expect(tool("save_my_design").description).toMatch(/never retype or paste code/);
  });

  it("refuses a path that leaves root, a link out of it, and files that can hold secrets, before saving anything", async () => {
    const cases: [string, RegExp][] = [
      ["../elsewhere/secret.js", /must be a relative path/],
      ["/etc/hosts", /must be a relative path/],
      ["src/hero/linked.js", /is a link to .*elsewhere\/secret\.js, outside/],
      ["src/hero/config.js", /it is an environment file/],
      [".env.local", /it is an environment file/],
      ["node_modules/three/build/three.module.js", /inside node_modules/],
      ["certs/server.pem", /key or certificate/],
      ["src/hero/missing.js", /doesn't exist under/],
      ["latin1.js", /isn't UTF-8 text/],
    ];
    for (const [p, why] of cases) {
      const res = await runTool(tool("save_my_design"), pivot.source, {
        ...base(),
        files: [
          { path: "src/hero/hero.js", role: "component" },
          { path: p, role: "support" },
        ],
      });
      expect(res.isError, p).toBe(true);
      expect(textOf(res), p).toMatch(why);
      expect(textOf(res), p).toMatch(/Nothing was saved/);
    }
    // an asset is read the same way
    const asset = await runTool(tool("save_my_design"), pivot.source, {
      ...base(),
      assets: ["../elsewhere/secret.js"],
    });
    expect(textOf(asset)).toMatch(/must be a relative path/);
    const shot = await runTool(tool("save_my_design"), pivot.source, { ...base(), screenshots: [".env.local"] });
    expect(textOf(shot)).toMatch(/a screenshot is a PNG, JPEG or WebP file/);
    expect(pivot.saves).toEqual([]);
    expect(pivot.uploads).toEqual([]);
  });

  it("refuses a relative root", async () => {
    expect(textOf(await runTool(tool("save_my_design"), pivot.source, { ...base(), root: "project" }))).toMatch(
      /root must be an absolute path/,
    );
    expect(pivot.saves).toEqual([]);
  });

  it("on different code for a saved design (409), says PIVOT holds other code and that replaceCode is only for the owner's ask", async () => {
    await runTool(tool("save_my_design"), pivot.source, base());
    await fs.writeFile(path.join(root, "src/hero/tokens.css"), TOKENS.replace("#ff5a1f", "#000000"));
    try {
      const res = await runTool(tool("save_my_design"), pivot.source, { ...base(), id: ID });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/^conflict: /);
      expect(textOf(res)).toMatch(/PIVOT holds different code for this design, and nothing was changed/);
      expect(textOf(res)).toMatch(/replaceCode: true only when the owner asked/);
      const replaced = await runTool(tool("save_my_design"), pivot.source, { ...base(), id: ID, replaceCode: true });
      expect(replaced.isError).toBeFalsy();
      expect(textOf(replaced)).toMatch(/^Updated "ODIN 3D logo hero"/);
      // the same SVG at the same path isn't sent again
      expect(textOf(replaced)).toContain("Already saved, unchanged: public/odin-mark.svg");
    } finally {
      await fs.writeFile(path.join(root, "src/hero/tokens.css"), TOKENS);
    }
  });

  it("refuses on a read-only connection and on an app without My designs", async () => {
    const { saveDesignBrief: _a, saveMyDesign: _b, addMyDesignAsset: _c, ...readOnly } = pivot.source;
    expect(textOf(await runTool(tool("save_my_design"), readOnly as PivotSource, base()))).toMatch(/^read_only: /);
    const { saveMyDesign: _d, ...older } = pivot.source;
    expect(textOf(await runTool(tool("save_my_design"), older as PivotSource, base()))).toMatch(/^not_supported: /);
  });
});

describe("get_my_design", () => {
  let pivot: ReturnType<typeof fakePivot>;
  let out: string;
  beforeEach(async () => {
    pivot = fakePivot();
    await runTool(tool("save_my_design"), pivot.source, base());
    out = await fs.mkdtemp(path.join(tmp, "rebuild-"));
  });

  it("returns the files, usage, tokens, exact versions, install steps and screenshots", async () => {
    const res = await runTool(tool("get_my_design"), pivot.source, { name: "odin 3d LOGO hero" });
    const t = textOf(res);
    expect(t).toContain("ODIN 3D logo hero — 3d · saved ");
    expect(t).not.toMatch(/organisation|Company work/);
    expect(t).toContain("Dependencies (install exactly these versions): three@0.170.0");
    expect(t).toContain("1. npm install three@0.170.0");
    expect(t).toContain("- --color-ember: #ff5a1f");
    expect(t).toContain("Usage:\nMount with mountHero(el)");
    expect(t).toContain("Non-code files: public/odin-mark.svg");
    expect(t).toMatch(
      /Screenshots of the original: desktop 1440×900, mobile 1440×900\. get_reference_images .* "shots"/,
    );
    expect(t).toContain("File src/hero/hero.js (component, js):");
    expect((res.structuredContent!.myDesign as MyDesignMeta).files[1].code).toBe(TOKENS);
    const missing = await runTool(tool("get_my_design"), pivot.source, { name: "Nope" });
    expect(missing.structuredContent).toEqual({ found: false });
    expect(textOf(await runTool(tool("get_my_design"), pivot.source, {}))).toMatch(/Give id or name/);
  });

  it("writeTo writes every file and asset byte for byte (sha256 equal) at its relative path", async () => {
    const res = await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: out });
    expect(res.isError).toBeFalsy();
    for (const p of ["src/hero/hero.js", "src/hero/tokens.css", "src/hero/index.html", "public/odin-mark.svg"]) {
      expect(sha(await fs.readFile(path.join(out, p))), p).toBe(sha(await fs.readFile(path.join(root, p))));
    }
    expect(textOf(res)).toContain(`Written to ${out}, byte for byte: 4 new.`);
    expect(textOf(res)).not.toContain("File src/hero/hero.js");
    // again: everything is already identical, nothing changes
    const again = await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: out });
    expect(again.structuredContent!.written).toMatchObject({ written: [], differ: [] });
    expect((again.structuredContent!.written as { same: string[] }).same).toHaveLength(4);
  });

  it("never overwrites a file that differs: writes nothing and lists them for the owner", async () => {
    await fs.mkdir(path.join(out, "src/hero"), { recursive: true });
    await fs.writeFile(path.join(out, "src/hero/tokens.css"), ":root { --color-ember: red; }\n");
    const res = await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: out });
    expect(textOf(res)).toMatch(
      /NOTHING WAS WRITTEN to .*: these files already exist there with other content .*: src\/hero\/tokens\.css/,
    );
    expect(textOf(res)).toMatch(/never overwrite them on your own/);
    expect(await fs.readFile(path.join(out, "src/hero/tokens.css"), "utf8")).toBe(":root { --color-ember: red; }\n");
    await expect(fs.access(path.join(out, "src/hero/hero.js"))).rejects.toThrow();
    await expect(fs.access(path.join(out, "public/odin-mark.svg"))).rejects.toThrow();
  });

  it("refuses to write through a link out of writeTo, a relative writeTo, and an asset that comes back changed", async () => {
    await fs.symlink(outside, path.join(out, "src"));
    const linked = await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: out });
    expect(textOf(linked)).toMatch(/would be written through a link out of/);
    await expect(fs.access(path.join(outside, "hero/hero.js"))).rejects.toThrow();
    expect(textOf(await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: "rebuild" }))).toMatch(
      /writeTo must be an absolute path/,
    );
    const fresh = await fs.mkdtemp(path.join(tmp, "rebuild-"));
    for (const k of pivot.blobs.keys()) pivot.blobs.set(k, Buffer.from("tampered"));
    const changed = await runTool(tool("get_my_design"), pivot.source, { id: ID, writeTo: fresh });
    expect(textOf(changed)).toMatch(/came back different from what was saved \(sha256\)\. Nothing was written/);
    expect(await fs.readdir(fresh)).toEqual([]);
  });
});

describe("the owner's designs in search and in the reference tools", () => {
  it("search_references searches the owner's designs and marks them as Yours", async () => {
    const pivot = fakePivot();
    const res = await runTool(tool("search_references"), pivot.source, { query: "logo", types: ["my_design"] });
    expect(pivot.searches.at(-1)).toMatchObject({ query: "logo", types: ["my_design"] });
    expect(textOf(res)).toContain("ODIN 3D logo hero — My design — Yours (3d)");
    expect(tool("search_references").inputSchema).not.toHaveProperty("organisation");
  });

  it("get_reference on a saved design points to get_my_design, and get_reference_images shows its shots", async () => {
    const pivot = fakePivot();
    await runTool(tool("save_my_design"), pivot.source, base());
    const r = pivot.designs.get(ID)!;
    Object.assign(r, { description: "", notes: "", content: "", collections: [], annotations: [], sourceUrl: null });
    const ref = await runTool(tool("get_reference"), pivot.source, { id: ID });
    expect(textOf(ref)).toMatch(/get_my_design \(id .*\) gives its files/);
    expect(textOf(ref)).not.toMatch(/organisation/);
    const shots = await runTool(tool("get_reference_images"), pivot.source, { id: ID, which: "shots" });
    expect(shots.isError).toBeFalsy();
    expect(shots.content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(textOf(shots)).toMatch(/Screenshot 1 of 2 \(desktop\).*\nScreenshot 2 of 2 \(mobile\)/);
  });

  it("save_reference can't make one", async () => {
    const pivot = fakePivot();
    const res = await runTool(tool("save_reference"), pivot.source, { url: "https://odin.ai", type: "my_design" });
    expect(res.isError).toBe(true);
    expect(
      tool("save_reference").description +
        String((tool("save_reference").inputSchema.type as { description?: string }).description),
    ).toMatch(/save_my_design/);
  });
});
