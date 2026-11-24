// The owner's own designs, saved to be rebuilt exactly (docs/my-designs-plan.md, Phase 1): saved with their exact code,
// usage, tokens and files when the owner asks; files that can hold secrets refused; found again by id or name; never
// made or changed by hand; company work leaving PIVOT as its name only. The code here is written for these tests.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ZodError } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MyDesignMeta, ResourceDetailDTO } from "../src/types";

let tmp: string;
let designs: typeof import("../src/my-designs");
let resources: typeof import("../src/resources");
let context: typeof import("../src/context");
let share: typeof import("../src/share");
let backup: typeof import("../src/backup");
let skills: typeof import("../src/skills");
let assets: typeof import("../src/assets");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-my-designs-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  designs = await import("../src/my-designs");
  resources = await import("../src/resources");
  context = await import("../src/context");
  share = await import("../src/share");
  backup = await import("../src/backup");
  skills = await import("../src/skills");
  assets = await import("../src/assets");
  db = await import("../src/db/client");
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

const SCENE = `import * as THREE from "three";
export function createHalo(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const glow = getComputedStyle(document.documentElement).getPropertyValue("--halo-glow");
  return { renderer, glow };
}
`;
const STYLE = `:root { --halo-glow: #3d75d8; --halo-ink: #0c0806; }\n.halo { background: var(--halo-ink); }\n`;
const DEMO = `<!doctype html><canvas class="halo"></canvas><script type="module" src="./halo.ts"></script>\n`;

const meta = (r: ResourceDetailDTO) => r.meta.myDesign as MyDesignMeta;
const input = (over: Record<string, unknown> = {}) => ({
  name: "Halo hero",
  kind: "3d",
  ownership: "personal",
  files: [
    { path: "src/halo.ts", role: "component", code: SCENE },
    { path: "src/halo.css", role: "style", code: STYLE },
    { path: "index.html", role: "demo", code: DEMO },
  ],
  dependencies: [{ name: "three", version: "0.170.0" }],
  install: ["npm install three@0.170.0"],
  usage: 'Mount on a full-width <canvas class="halo"> inside the hero; import halo.css once.',
  tokens: [{ name: "--halo-glow", value: "#3d75d8" }],
  source: { project: "halo-site", folder: "/projects/halo-site", sessionId: "11111111-1111-4111-8111-111111111111" },
  facets: [{ kind: "technology", name: "Three.js" }],
  ...over,
});
const png = (w = 8, h = 6) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .png()
    .toBuffer();

describe("saving a design", () => {
  it("keeps the exact code with its language, usage, tokens, dependencies, source and a scan", async () => {
    const { outcome, resource } = await designs.saveMyDesign(input());
    expect(outcome).toBe("created");
    expect(resource.type).toBe("my_design");
    expect(resource.title).toBe("Halo hero");
    expect(resource.content).toBe(SCENE);
    const m = meta(resource);
    expect(m.files.map((f) => [f.path, f.role, f.language])).toEqual([
      ["src/halo.ts", "component", "ts"],
      ["src/halo.css", "style", "css"],
      ["index.html", "demo", "html"],
    ]);
    expect(m.files[0].code).toBe(SCENE);
    expect(m).toMatchObject({
      kind: "3d",
      ownership: "personal",
      dependencies: [{ name: "three", version: "0.170.0" }],
      tokens: [{ name: "--halo-glow", value: "#3d75d8" }],
      source: { project: "halo-site", sessionIds: ["11111111-1111-4111-8111-111111111111"] },
      assets: [],
    });
    expect(m.organisation).toBeUndefined();
    expect(m.codeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.scan.flags).toEqual([]);
    expect(resource.tags.map((t) => t.name)).toContain("Three.js");
  });

  it("refuses files that can hold secrets, paths out of the folder, code holding a key, and company work with no organisation", async () => {
    const withFile = (p: string, code = "x") => input({ files: [{ path: p, role: "component", code }] });
    for (const p of [
      ".env",
      "config/.env.local",
      "certs/site.pem",
      "node_modules/three/index.js",
      ".git/config",
      ".npmrc",
    ]) {
      await expect(designs.saveMyDesign(withFile(p)), p).rejects.toBeInstanceOf(ZodError);
    }
    for (const p of ["../outside.ts", "/etc/passwd", "a\\b.ts", "a//b.ts"]) {
      await expect(designs.saveMyDesign(withFile(p)), p).rejects.toBeInstanceOf(ZodError);
    }
    const leaky = withFile("src/pay.ts", `const key = "sk_live_${"a".repeat(24)}";\n`);
    await expect(designs.saveMyDesign(leaky)).rejects.toThrow(/src\/pay.ts line 1 seems to hold a credential/);
    await expect(designs.saveMyDesign(leaky)).rejects.not.toThrow(/sk_live/);
    await expect(designs.saveMyDesign(input({ ownership: "company" }))).rejects.toBeInstanceOf(ZodError);
    await expect(
      designs.saveMyDesign(input({ files: [{ path: "a.css", role: "style", code: STYLE }] })),
    ).rejects.toThrow(/role "component" or "demo"/);
    await expect(
      designs.saveMyDesign(
        input({
          files: [
            { path: "a.ts", role: "component", code: "a" },
            { path: "a.ts", role: "support", code: "b" },
          ],
        }),
      ),
    ).rejects.toThrow(/listed twice/);
    const big = "x".repeat(900_000);
    await expect(
      designs.saveMyDesign(
        input({ files: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts`, role: "component", code: big })) }),
      ),
    ).rejects.toThrow(/at most 4 MB/);
  });
});

describe("saving it again", () => {
  it("updates usage and sessions, keeps the owner's title, and refuses different code unless replaceCode", async () => {
    const { resource } = await designs.saveMyDesign(input({ name: "Halo again" }));
    await resources.updateResource(resource.id, { title: "Halo (renamed by owner)" });
    const same = await designs.saveMyDesign(
      input({
        id: resource.id,
        name: "Other name",
        usage: "New usage notes.",
        source: { sessionId: "22222222-2222-4222-8222-222222222222" },
      }),
    );
    expect(same.outcome).toBe("updated");
    expect(same.resource.title).toBe("Halo (renamed by owner)");
    expect(meta(same.resource).usage).toBe("New usage notes.");
    expect(meta(same.resource).source.sessionIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(meta(same.resource).source.project).toBe("halo-site");
    expect((await designs.saveMyDesign(input({ id: resource.id, usage: "New usage notes." }))).outcome).toBe(
      "unchanged",
    );

    const changed = input({ id: resource.id, files: [{ path: "src/halo.ts", role: "component", code: "// v2\n" }] });
    await expect(designs.saveMyDesign(changed)).rejects.toBeInstanceOf(designs.MyDesignConflictError);
    const replaced = await designs.saveMyDesign({ ...changed, replaceCode: true });
    expect(replaced.outcome).toBe("updated");
    expect(meta(replaced.resource).files).toEqual([
      { path: "src/halo.ts", role: "component", language: "ts", code: "// v2\n" },
    ]);
    expect(replaced.resource.content).toBe("// v2\n");
    await expect(designs.saveMyDesign(input({ id: "33333333-3333-4333-8333-333333333333" }))).rejects.toThrow(
      /no saved design/,
    );
  });
});

describe("its files, screenshots and videos", () => {
  it("keeps a non-code file at its path, replaces it there, and makes the first screenshot the cover", async () => {
    const { resource } = await designs.saveMyDesign(input({ name: "Halo with files" }));
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
    let r = await designs.addMyDesignAsset(resource.id, {
      data: svg,
      fileName: "logo.svg",
      role: "design-asset",
      path: "public/logo.svg",
    });
    expect(meta(r).assets).toMatchObject([{ path: "public/logo.svg", size: svg.byteLength }]);
    const first = meta(r).assets[0].assetId;

    const svg2 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    r = await designs.addMyDesignAsset(resource.id, {
      data: svg2,
      fileName: "logo.svg",
      role: "design-asset",
      path: "public/logo.svg",
    });
    expect(meta(r).assets).toHaveLength(1);
    expect(meta(r).assets[0].assetId).not.toBe(first);
    expect(r.assets.some((a) => a.id === first)).toBe(false);
    expect(await assets.getAsset(first)).toBeNull();

    expect(r.coverAssetId).toBeNull();
    r = await designs.addMyDesignAsset(resource.id, {
      data: await png(),
      fileName: "desktop.png",
      role: "design-shot",
      viewport: "desktop",
    });
    const shot = r.assets.find((a) => a.role === "design-shot")!;
    expect(r.coverAssetId).toBe(shot.id);
    expect(shot.meta).toMatchObject({ viewport: "desktop" });
  });

  it("refuses a file with no path or a secret's path, a screenshot that isn't an image, and a file over 25 MB", async () => {
    const { resource } = await designs.saveMyDesign(input({ name: "Halo refusals" }));
    const add = (over: Partial<Parameters<typeof designs.addMyDesignAsset>[1]>) =>
      designs.addMyDesignAsset(resource.id, {
        data: Buffer.from("x"),
        fileName: "a.bin",
        role: "design-asset",
        ...over,
      });
    await expect(add({})).rejects.toThrow(/relative path it goes to/);
    await expect(add({ path: ".env" })).rejects.toThrow(/never stores/);
    await expect(add({ path: "../up.bin" })).rejects.toThrow(/relative path/);
    await expect(add({ role: "design-shot", fileName: "shot.txt", mimeType: "text/plain" })).rejects.toThrow(
      /has to be an image/,
    );
    await expect(add({ path: "big.bin", data: Buffer.alloc(25 * 1024 * 1024 + 1) })).rejects.toThrow(/25 MB/);
    await expect(
      designs.addMyDesignAsset("44444444-4444-4444-8444-444444444444", {
        data: Buffer.from("x"),
        fileName: "a",
        role: "design-shot",
      }),
    ).rejects.toThrow(/no saved design/);
  });
});

describe("finding a saved design", () => {
  it("by id and by name (any case); not once it is in the Trash", async () => {
    const { resource } = await designs.saveMyDesign(input({ name: "Findable Halo" }));
    expect((await designs.findMyDesign({ id: resource.id }))?.id).toBe(resource.id);
    expect((await designs.findMyDesign({ name: "findable halo" }))?.id).toBe(resource.id);
    expect(await designs.findMyDesign({ name: "No such design" })).toBeNull();
    expect(() => designs.myDesignLookup.parse({})).toThrow();
    await resources.trashResources([resource.id]);
    expect(await designs.findMyDesign({ id: resource.id })).toBeNull();
    expect(await designs.findMyDesign({ name: "Findable Halo" })).toBeNull();
  });
});

describe("only PIVOT makes and changes saved designs", () => {
  it("refuses one made by hand, a type change, and an edit of its code; strips meta.myDesign", async () => {
    await expect(resources.createResource({ type: "my_design", title: "By hand" })).rejects.toThrow(/save_my_design/);
    const { resource } = await designs.saveMyDesign(input({ name: "Halo locked" }));
    await expect(resources.updateResource(resource.id, { type: "snippet" })).rejects.toBeInstanceOf(
      resources.ResourceRuleError,
    );
    await expect(resources.updateResource(resource.id, { content: "changed" })).rejects.toThrow(
      /kept exactly as it was saved/,
    );
    const patch = skills.withoutServerOwnedMeta({
      title: "Renamed",
      content: resource.content,
      meta: { myDesign: { ownership: "company" }, other: 1 },
    });
    expect(patch.meta).toEqual({ other: 1 });
    const after = (await resources.updateResource(resource.id, patch))!;
    expect(meta(after).ownership).toBe("personal");
  });
});

describe("what leaves PIVOT", () => {
  const walk = async (d: string, out: string[] = []): Promise<string[]> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, out);
      else out.push(p);
    }
    return out;
  };

  it("company work: its name, kind and organisation only, in Export, copied context and Share", async () => {
    const { resource } = await designs.saveMyDesign(
      input({ name: "Company Halo", ownership: "company", organisation: "Acme", notes: "secret plans" }),
    );
    await designs.addMyDesignAsset(resource.id, {
      data: await png(),
      fileName: "shot.png",
      role: "design-shot",
    });
    const out = await context.exportBundle({
      targetDir: path.join(tmp, "exports"),
      bundleName: "company",
      resourceIds: [resource.id],
    });
    const files = await walk(out.path);
    expect(files.map((f) => path.basename(f))).toEqual(["context.md"]);
    const md = await fs.readFile(files[0], "utf8");
    expect(md).toContain("Company Halo");
    expect(md).toContain("Company work (Acme)");
    for (const leak of ["WebGLRenderer", "secret plans", "Mount on a full-width", "halo-site"]) {
      expect(md).not.toContain(leak);
    }
    const clip = await context.buildClipboardContext([resource.id]);
    expect(clip.markdown).not.toContain("WebGLRenderer");
    expect(clip.markdown).not.toContain("Mount on a full-width");

    const pack = await share.createSharePackage([resource.id], {
      targetDir: path.join(tmp, "shares"),
      includeNotes: true,
    });
    const shared = await walk(pack.path);
    expect(shared.some((f) => f.includes(`${path.sep}images${path.sep}`))).toBe(false);
    const json = await fs.readFile(path.join(pack.path, "share.json"), "utf8");
    expect(JSON.parse(json).items[0]).toMatchObject({
      title: "Company Halo",
      owner: "Company work (Acme)",
      images: [],
    });
    expect(json).not.toContain("secret plans");
  });

  it("personal work: its usage and screenshots, never the code", async () => {
    const { resource } = await designs.saveMyDesign(input({ name: "Personal Halo" }));
    await designs.addMyDesignAsset(resource.id, {
      data: await png(10, 7),
      fileName: "shot.png",
      role: "design-shot",
    });
    const out = await context.exportBundle({
      targetDir: path.join(tmp, "exports"),
      bundleName: "personal",
      resourceIds: [resource.id],
    });
    const files = await walk(out.path);
    expect(files.some((f) => f.includes(`${path.sep}assets${path.sep}`))).toBe(true);
    const md = await fs.readFile(path.join(out.path, "context.md"), "utf8");
    expect(md).toContain("Mount on a full-width");
    expect(md).toContain("get_my_design");
    expect(md).not.toContain("WebGLRenderer");
    for (const f of files) expect(await fs.readFile(f, "latin1")).not.toContain("WebGLRenderer");
  });

  it("a backup keeps everything, company work included", async () => {
    const { resource } = await designs.saveMyDesign(
      input({ name: "Backed-up Halo", ownership: "company", organisation: "Acme" }),
    );
    await designs.addMyDesignAsset(resource.id, {
      data: Buffer.from("font-bytes"),
      fileName: "brand.woff2",
      role: "design-asset",
      path: "public/fonts/brand.woff2",
    });
    const made = await backup.createBackup({ targetDir: path.join(tmp, "backups") });
    await resources.purgeResources([resource.id]);
    expect(await designs.findMyDesign({ id: resource.id })).toBeNull();
    await backup.restoreBackup(made.path);
    const back = (await designs.findMyDesign({ name: "Backed-up Halo" }))!;
    expect(back.content).toBe(SCENE);
    expect(meta(back).organisation).toBe("Acme");
    expect(meta(back).assets.map((a) => a.path)).toEqual(["public/fonts/brand.woff2"]);
    const row = await assets.getAsset(meta(back).assets[0].assetId);
    expect((await assets.readAssetBytes(row!))?.toString()).toBe("font-bytes");
  });
});
