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
    const brief = await design.saveDesignBrief({ title: "Pricing", milestone: "initial", markdown: "## Brief" });
    await design.saveDesignMockups({ sessionId: brief.sessionId, mockups: [{ title: "Tiers", html: "<p>1</p>" }] });

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
    const data = JSON.parse(await fs.readFile(path.join(made.path, "data.json"), "utf8"));
    expect(JSON.stringify(data)).not.toMatch(/api-token/);
    expect(data.designMockups.map((m: { title: string; html: string }) => [m.title, m.html])).toEqual([
      ["Tiers", "<p>1</p>"],
    ]);

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

  it("restores mockups with digests recomputed from their HTML, so a bound approval still says what changed", async () => {
    const brief = await design.saveDesignBrief({ title: "Bound", milestone: "initial", markdown: "## Bound" });
    const { ids } = await design.saveDesignMockups({
      sessionId: brief.sessionId,
      mockups: [{ title: "One", html: "<p>bound</p>" }],
    });
    await design.approveDesignMockup(ids[0], "", design.mockupDigest("<p>bound</p>"));
    const made = await backup.createBackup({ targetDir: path.join(tmp, "bound") });
    const file = path.join(made.path, "data.json");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const { designSessions } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const drop = async () => (await db.getDb()).delete(designSessions).where(eq(designSessions.id, brief.sessionId));

    // a backup made before binding has no digest or interactive flag: both are filled in on restore
    const mockup = data.designMockups.find((m: { id: string }) => m.id === ids[0]);
    delete mockup.digest;
    delete mockup.interactive;
    await fs.writeFile(file, JSON.stringify(data));
    await drop();
    await backup.restoreBackup(made.path);
    let s = (await design.getDesignSession(brief.sessionId))!;
    expect(s.mockups[0]).toMatchObject({ digest: design.mockupDigest("<p>bound</p>"), interactive: false });
    expect(s.decisions.at(-1)!.binding!.status).toBe("bound");

    // a backup whose HTML was edited: the stored digest isn't trusted, and the approval shows the change
    mockup.html = "<p>edited in the backup</p>";
    mockup.digest = design.mockupDigest("<p>bound</p>");
    await fs.writeFile(file, JSON.stringify(data));
    await drop();
    await backup.restoreBackup(made.path);
    s = (await design.getDesignSession(brief.sessionId))!;
    expect(s.mockups[0].digest).toBe(design.mockupDigest("<p>edited in the backup</p>"));
    expect(s.decisions.at(-1)!.binding!.status).toBe("changed");
  });

  it("keeps a session's approval reset through backup and restore, and never lets missing or bad reset data revive an approval", async () => {
    const { designSessions, designMockups } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const sessionRow = async (id: string) =>
      (await (await db.getDb()).select().from(designSessions).where(eq(designSessions.id, id)))[0];
    const drop = async (id: string) => (await db.getDb()).delete(designSessions).where(eq(designSessions.id, id));
    const approved = async (title: string, html: string) => {
      const brief = await design.saveDesignBrief({ title, milestone: "initial", markdown: `## ${title}` });
      const { ids } = await design.saveDesignMockups({ sessionId: brief.sessionId, mockups: [{ title, html }] });
      await design.approveDesignMockup(ids[0], "", design.mockupDigest(html));
      return { sessionId: brief.sessionId, mockupId: ids[0] };
    };

    // reopened, then backed up and restored: still needs approving again
    const re = await approved("Reset kept", "<p>rk</p>");
    await design.setDesignSessionStatus(re.sessionId, "exploring");
    const resetAt = (await sessionRow(re.sessionId)).approvalResetAt!;
    const made = await backup.createBackup({ targetDir: path.join(tmp, "reset") });
    const file = path.join(made.path, "data.json");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    await drop(re.sessionId);
    await backup.restoreBackup(made.path);
    expect((await sessionRow(re.sessionId)).approvalResetAt!.toISOString()).toBe(resetAt.toISOString());
    expect((await design.getDesignSession(re.sessionId))!.currentApprovalId).toBeNull();
    await design.setDesignSessionStatus(re.sessionId, "abandoned");
    await expect(design.setDesignSessionStatus(re.sessionId, "approved")).rejects.toThrow(/needs approving again/);

    // a backup made before resets were recorded (no field), or a malformed one: the restore resets the approval
    const entry = data.designSessions.find((x: { id: string }) => x.id === re.sessionId);
    for (const bad of [undefined, "not a date"]) {
      entry.status = "abandoned";
      if (bad === undefined) delete entry.approvalResetAt;
      else entry.approvalResetAt = bad;
      await fs.writeFile(file, JSON.stringify(data));
      await drop(re.sessionId);
      await backup.restoreBackup(made.path);
      expect((await sessionRow(re.sessionId)).approvalResetAt, String(bad)).not.toBeNull();
      await expect(design.setDesignSessionStatus(re.sessionId, "approved"), String(bad)).rejects.toThrow(
        /needs approving again/,
      );
    }

    // an approval whose version was already changed before the backup is still refused after the restore
    const inv = await approved("Invalid before", "<p>ib</p>");
    await (
      await db.getDb()
    )
      .update(designMockups)
      .set({ html: "<p>changed before the backup</p>" })
      .where(eq(designMockups.id, inv.mockupId));
    const made2 = await backup.createBackup({ targetDir: path.join(tmp, "invalid") });
    await drop(inv.sessionId);
    await backup.restoreBackup(made2.path);
    expect((await design.getDesignSession(inv.sessionId))!.decisions.at(-1)!.binding!.status).toBe("changed");
    await expect(design.setDesignSessionStatus(inv.sessionId, "building")).rejects.toThrow(/Ask for approval again/);
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
