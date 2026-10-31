import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let backup: typeof import("../src/backup");
let share: typeof import("../src/share");
let resources: typeof import("../src/resources");
let assets: typeof import("../src/assets");
let links: typeof import("../src/links");
let annotations: typeof import("../src/annotations");
let design: typeof import("../src/design");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-backup-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  backup = await import("../src/backup");
  share = await import("../src/share");
  resources = await import("../src/resources");
  assets = await import("../src/assets");
  links = await import("../src/links");
  annotations = await import("../src/annotations");
  design = await import("../src/design");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("backup and restore", () => {
  it("restores a lost reference with everything around it, keeps existing ones, and never adds twice", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#f60" } })
      .png()
      .toBuffer();
    const a = await resources.createResource({
      type: "reference",
      title: "Pricing A",
      description: "Three tiers",
      sourceUrl: "https://a.dev/pricing",
      tags: [{ kind: "pageType", name: "Pricing" }],
    });
    const b = await resources.createResource({
      type: "reference",
      title: "Pricing B",
      sourceUrl: "https://b.dev/pricing",
    });
    const shot = await assets.saveAsset({ data: png, fileName: "a.png" });
    await assets.attachAsset(a.id, shot.id, "screenshot");
    await resources.setResourceFields(a.id, { coverAssetId: shot.id });
    const col = await resources.createCollection({ name: "Pricing pages" });
    await resources.addToCollection(col.id, [a.id, b.id]);
    await links.createLink({ fromId: a.id, toId: b.id, kind: "related_to" });
    await annotations.addAnnotation(a.id, { assetId: shot.id, x: 0.1, y: 0.1, width: 0.2, height: 0.2, note: "Tiers" });
    await design.saveDesignBrief({ title: "Pricing", milestone: "initial", markdown: "## Brief" });

    const made = await backup.createBackup({ targetDir: path.join(tmp, "out") });
    expect(made.counts).toMatchObject({
      resources: 2,
      assets: 1,
      links: 1,
      annotations: 1,
      designSessions: 1,
      missingFiles: 0,
    });
    const manifest = JSON.parse(await fs.readFile(path.join(made.path, "manifest.json"), "utf8"));
    expect(manifest.format).toBe("pivot-backup");
    expect(await fs.readFile(path.join(made.path, "data.json"), "utf8")).not.toMatch(/api-token/);

    // lose A for good, then restore
    await resources.trashResources([a.id]);
    await resources.purgeResources([a.id]);
    const preview = await backup.previewRestore(made.path);
    expect(preview.counts).toMatchObject({ resources: 2, new: 1, conflicts: 1 });
    const first = await backup.restoreBackup(made.path);
    expect(first).toMatchObject({ imported: 1, kept: 1 });
    const back = (await resources.getResource(a.id))!;
    expect(back.title).toBe("Pricing A");
    expect(back.tags.map((t) => t.name)).toEqual(["Pricing"]);
    expect(back.collections.map((c) => c.name)).toEqual(["Pricing pages"]);
    expect(back.assets.map((x) => x.role)).toEqual(["screenshot"]);
    expect(back.coverAssetId).toBe(back.assets[0].id);
    expect(back.annotations!.map((n) => n.note)).toEqual(["Tiers"]);
    expect((await links.listLinks(a.id)).map((l) => l.kind)).toEqual(["related_to"]);

    // again: nothing new
    expect(await backup.restoreBackup(made.path)).toMatchObject({ imported: 0, kept: 2 });
    expect((await resources.listResources({ q: "Pricing" })).length).toBe(2);
  });

  it("merges by filling only empty fields, and makes separate copies once", async () => {
    const r = await resources.createResource({
      type: "reference",
      title: "Merge me",
      description: "Original text",
      sourceUrl: "https://m.dev/",
    });
    const made = await backup.createBackup({ targetDir: path.join(tmp, "out2") });
    await resources.updateResource(r.id, { title: "Renamed by me", description: "" });
    await backup.restoreBackup(made.path, { conflicts: "merge" });
    const merged = (await resources.getResource(r.id))!;
    expect(merged.title).toBe("Renamed by me");
    expect(merged.description).toBe("Original text");

    const before = (await resources.listResources({})).length;
    await backup.restoreBackup(made.path, { conflicts: "keep", overrides: { [r.id]: "new" } });
    await backup.restoreBackup(made.path, { conflicts: "keep", overrides: { [r.id]: "new" } });
    expect((await resources.listResources({})).length).toBe(before + 1);
  });

  it("refuses unsafe or foreign folders", async () => {
    const made = await backup.createBackup({ targetDir: path.join(tmp, "out3") });
    const dataPath = path.join(made.path, "data.json");
    const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
    data.assets[0].file = "../../escape.png";
    await fs.writeFile(dataPath, JSON.stringify(data));
    await expect(backup.previewRestore(made.path)).rejects.toThrow(/Unsafe file name/);
    await expect(backup.previewRestore(tmp)).rejects.toThrow(/isn't a PIVOT backup/);
    await expect(backup.previewRestore("relative/path")).rejects.toThrow(/absolute/);
  });
});

describe("share package", () => {
  it("shares the chosen references without notes or private pages, as a readable folder", async () => {
    const pub = await resources.createResource({
      type: "reference",
      title: "<Public> pricing",
      notes: "my private thoughts",
      sourceUrl: "https://p.dev/",
    });
    const priv = await resources.createResource({
      type: "reference",
      title: "Billing settings",
      sourceUrl: "https://app.p.dev/billing",
      meta: { privatePage: true },
    });
    const res = await share.createSharePackage([pub.id, priv.id], {
      targetDir: path.join(tmp, "share"),
      title: "For Sam",
    });
    expect(res.shared).toBe(1);
    expect(res.left).toEqual([{ id: priv.id, title: "Billing settings", why: "saved from a private page" }]);
    const json = await fs.readFile(path.join(res.path, "share.json"), "utf8");
    expect(json).not.toMatch(/private thoughts/);
    const html = await fs.readFile(path.join(res.path, "index.html"), "utf8");
    expect(html).toMatch(/&lt;Public&gt; pricing/);
    expect(html).not.toMatch(/Billing settings/);
  });
});
