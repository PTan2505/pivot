import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let core: {
  resources: typeof import("../src/resources");
  assets: typeof import("../src/assets");
  context: typeof import("../src/context");
  skills: typeof import("../src/skills");
  db: typeof import("../src/db/client");
};

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "stan-bag-test-"));
  process.env.STAN_BAG_DATA_DIR = path.join(tmp, "data");
  process.env.CLAUDE_SKILLS_DIR = path.join(tmp, "skills");
  process.env.CLAUDE_PLUGINS_DIR = path.join(tmp, "plugins");
  process.env.AGENTS_SKILL_LOCK = path.join(tmp, "skill-lock.json");
  process.env.STAN_BAG_MIGRATIONS_DIR = path.resolve(__dirname, "../src/db/migrations");
  delete process.env.DATABASE_URL;
  core = {
    resources: await import("../src/resources"),
    assets: await import("../src/assets"),
    context: await import("../src/context"),
    skills: await import("../src/skills"),
    db: await import("../src/db/client"),
  };
});

afterAll(async () => {
  await core.db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("resources", () => {
  it("creates, searches and filters with AND tag semantics", async () => {
    const { createResource, listResources } = core.resources;
    const a = await createResource({
      type: "reference",
      title: "Linear dashboard",
      sourceUrl: "linear.app",
      tags: [
        { kind: "pageType", name: "Dashboard" },
        { kind: "technology", name: "React" },
      ],
    });
    await createResource({
      type: "reference",
      title: "Stripe pricing",
      sourceUrl: "https://stripe.com/pricing",
      tags: [
        { kind: "pageType", name: "Pricing" },
        { kind: "technology", name: "react" },
      ],
    });
    await createResource({ type: "prompt", title: "Dashboard brief", content: "Build a {{thing}} dashboard" });

    expect(a.sourceUrl).toBe("https://linear.app/");
    // Tag names are matched case-insensitively, so "react" reuses "React".
    const react = a.tags.find((t) => t.kind === "technology")!;
    const dashboard = a.tags.find((t) => t.kind === "pageType")!;
    expect((await listResources({ tagIds: [react.id] })).length).toBe(2);
    expect((await listResources({ tagIds: [react.id, dashboard.id] })).map((r) => r.title)).toEqual([
      "Linear dashboard",
    ]);
    expect((await listResources({ q: "dashboard" })).length).toBe(2);
    expect((await listResources({ q: "dashboard", type: "prompt" })).length).toBe(1);
    // Title matches rank above newer content-only matches.
    await createResource({ type: "rule", title: "Pricing copy", content: "Keep it short like stripe does." });
    expect((await listResources({ q: "stripe" })).map((r) => r.title)).toEqual(["Stripe pricing", "Pricing copy"]);
    // Searching by tag name works too.
    expect((await listResources({ q: "pricing", type: "reference" })).map((r) => r.title)).toEqual(["Stripe pricing"]);
  });

  it("keeps skills out of All but lists them in their own tab", async () => {
    const { createResource, listResources, typeCounts } = core.resources;
    const before = await typeCounts();
    await createResource({ type: "skill", title: "dashboard-skill", content: "---\nname: dashboard-skill\n---\nBody" });
    const all = await listResources({ q: "dashboard", excludeTypes: ["skill"] });
    expect(all.map((r) => r.type)).not.toContain("skill");
    expect((await listResources({ q: "dashboard" })).map((r) => r.type)).toContain("skill");
    expect((await listResources({ type: "skill", excludeTypes: ["skill"] })).length).toBe(1);
    const after = await typeCounts();
    expect(after.all).toBe(before.all);
    expect(after.skill).toBe((before.skill ?? 0) + 1);
  });

  it("detects duplicate URLs", async () => {
    const dupes = await core.resources.findByUrl("http://www.linear.app");
    expect(dupes.map((d) => d.title)).toEqual(["Linear dashboard"]);
  });

  it("moves to trash, restores and purges with asset cleanup", async () => {
    const { createResource, trashResources, restoreResources, purgeResources, listResources, getResource } =
      core.resources;
    const { saveAsset, attachAsset, absoluteAssetPath } = core.assets;
    const r = await createResource({ type: "media", title: "Hero shot" });
    const png = await sharp({ create: { width: 64, height: 40, channels: 3, background: "#ff6363" } })
      .png()
      .toBuffer();
    const asset = await saveAsset({ data: png, fileName: "hero.png" });
    expect(asset.width).toBe(64);
    await attachAsset(r.id, asset.id);

    // A second resource sharing the same file keeps it alive.
    const other = await createResource({ type: "media", title: "Hero copy" });
    const same = await saveAsset({ data: png, fileName: "hero-again.png" });
    expect(same.id).toBe(asset.id);
    await attachAsset(other.id, same.id);

    await trashResources([r.id]);
    expect((await listResources()).some((x) => x.id === r.id)).toBe(false);
    expect((await listResources({ trash: true })).map((x) => x.id)).toContain(r.id);
    await restoreResources([r.id]);
    expect((await getResource(r.id))!.deletedAt).toBeNull();

    const file = absoluteAssetPath(asset.storagePath);
    await purgeResources([r.id]);
    await expect(fs.access(file)).resolves.toBeUndefined();
    await purgeResources([other.id]);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("manages collections", async () => {
    const { createCollection, addToCollection, collectionResourceIds, listResources, listCollections } = core.resources;
    const all = await listResources();
    const c = await createCollection({ name: "SaaS Dashboard" });
    await addToCollection(
      c.id,
      all.map((r) => r.id),
    );
    await addToCollection(c.id, [all[0].id]); // idempotent
    expect(await collectionResourceIds(c.id)).toEqual(all.map((r) => r.id));
    expect((await listCollections()).find((x) => x.id === c.id)!.count).toBe(all.length);
  });
});

describe("context & export", () => {
  it("builds clipboard markdown and exports a bundle", async () => {
    const { createResource } = core.resources;
    const { saveAsset, attachAsset } = core.assets;
    const ref = await createResource({
      type: "reference",
      title: "Vercel home",
      sourceUrl: "https://vercel.com",
      notes: "Look at the hero grid.",
      tags: [{ kind: "uiPattern", name: "Hero" }],
    });
    const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: "#111" } })
      .png()
      .toBuffer();
    const shot = await saveAsset({ data: big, fileName: "vercel.png" });
    await attachAsset(ref.id, shot.id, "screenshot");
    const prompt = await createResource({ type: "prompt", title: "Hero brief", content: "Make a hero." });

    const clip = await core.context.buildClipboardContext([ref.id, prompt.id]);
    expect(clip.markdown).toContain("## 1. Vercel home — Reference");
    expect(clip.markdown).toContain("**Pattern:** Hero");
    expect(clip.markdown).toContain("Make a hero.");
    expect(clip.tokens.imageCount).toBe(1);
    // 3200×2000 is scaled to 1568×980 before estimating.
    expect(clip.tokens.images).toBe(Math.ceil((1568 * 980) / 750));

    const out = await core.context.exportBundle({
      resourceIds: [ref.id, prompt.id],
      targetDir: path.join(tmp, "out"),
      bundleName: "Hero bundle",
      resizeImages: true,
    });
    expect(path.basename(out.path)).toBe("hero-bundle");
    const context = await fs.readFile(path.join(out.path, "context.md"), "utf8");
    expect(context).toContain("assets/vercel-home.png");
    expect(context).toContain("prompts/hero-brief.md");
    const meta = await sharp(path.join(out.path, "assets/vercel-home.png")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);

    // Exporting again never overwrites: a new folder is created.
    const again = await core.context.exportBundle({
      resourceIds: [prompt.id],
      targetDir: path.join(tmp, "out"),
      bundleName: "Hero bundle",
    });
    expect(path.basename(again.path)).toBe("hero-bundle-2");
  });
});

describe("skills", () => {
  const skillMd = (desc: string) => `---\nname: demo-skill\ndescription: ${desc}\n---\n\n# Demo\n`;

  it("imports, detects changes on both sides and writes back", async () => {
    const { syncSkills, skillStatuses, writeSkillToDisk, pullSkillFromDisk } = core.skills;
    const dir = path.join(process.env.CLAUDE_SKILLS_DIR!, "demo-skill");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), skillMd("v1"));
    await fs.mkdir(path.join(process.env.CLAUDE_SKILLS_DIR!, "not-a-skill"), { recursive: true });

    expect((await syncSkills()).created).toBe(1);
    let [status] = await skillStatuses();
    expect(status.state).toBe("synced");
    const id = status.resourceId!;
    const r = (await core.resources.getResource(id))!;
    expect(r.title).toBe("demo-skill");
    expect(r.description).toBe("v1");

    // Disk edit is pulled on the next sync.
    await fs.writeFile(path.join(dir, "SKILL.md"), skillMd("v2"));
    expect((await skillStatuses())[0].state).toBe("disk-changed");
    expect((await syncSkills()).updated).toBe(1);
    expect((await core.resources.getResource(id))!.description).toBe("v2");

    // App edit is written back on request.
    await core.resources.updateResource(id, { content: skillMd("v3") });
    expect((await skillStatuses())[0].state).toBe("app-changed");
    await writeSkillToDisk(id);
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toContain("v3");
    expect((await skillStatuses())[0].state).toBe("synced");

    // Both sides changed → conflict; writing requires force, pulling resolves it.
    await core.resources.updateResource(id, { content: skillMd("app") });
    await fs.writeFile(path.join(dir, "SKILL.md"), skillMd("disk"));
    [status] = await skillStatuses();
    expect(status.state).toBe("conflict");
    await expect(writeSkillToDisk(id)).rejects.toThrow(/changed on disk/);
    await pullSkillFromDisk(id);
    expect((await core.resources.getResource(id))!.description).toBe("disk");
  });

  it("validates frontmatter before writing", () => {
    expect(core.skills.validateSkillContent("# no frontmatter")).toHaveLength(3);
    expect(core.skills.validateSkillContent(skillMd("ok"))).toEqual([]);
  });
});
