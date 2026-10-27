import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let skills: typeof import("../src/skills");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

const skillMd = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n\n# ${name}\n`;

async function writeSkill(dir: string, content: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), content);
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "stan-bag-packs-"));
  const skillsDir = path.join(tmp, "skills");
  const pluginsDir = path.join(tmp, "plugins");
  Object.assign(process.env, {
    STAN_BAG_DATA_DIR: path.join(tmp, "data"),
    STAN_BAG_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
    CLAUDE_SKILLS_DIR: skillsDir,
    CLAUDE_PLUGINS_DIR: pluginsDir,
    AGENTS_SKILL_LOCK: path.join(tmp, "skill-lock.json"),
  });
  delete process.env.DATABASE_URL;

  // Installed with the `skills` CLI: the lock file names the repo.
  await writeSkill(path.join(skillsDir, "animate"), skillMd("animate"));
  await fs.writeFile(
    process.env.AGENTS_SKILL_LOCK!,
    JSON.stringify({
      skills: {
        animate: {
          source: "emilkowalski/skill",
          sourceType: "github",
          sourceUrl: "https://github.com/emilkowalski/skill.git",
          skillPath: "skills/animate/SKILL.md",
        },
      },
    }),
  );
  // Copied by hand, but the frontmatter names an author.
  await writeSkill(path.join(skillsDir, "brand"), skillMd("brand", "metadata:\n  author: claudekit\n"));
  // No source at all.
  await writeSkill(path.join(skillsDir, "mine"), skillMd("mine"));
  // A plugin with one skill.
  const pluginRoot = path.join(pluginsDir, "cache", "impeccable", "impeccable", "4.6.0");
  await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
  await fs.writeFile(
    path.join(pluginRoot, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "impeccable",
      author: { name: "Paul Bakaus" },
      repository: "https://github.com/pbakaus/impeccable",
      skills: "./skills/",
    }),
  );
  await writeSkill(path.join(pluginRoot, "skills", "impeccable"), skillMd("impeccable"));
  await fs.writeFile(
    path.join(pluginsDir, "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "impeccable@impeccable": [{ scope: "user", installPath: pluginRoot }] } }),
  );

  skills = await import("../src/skills");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("skill packs", () => {
  it("detects packs from the lock file, frontmatter author and plugins", async () => {
    const result = await skills.syncSkills();
    expect(result.created).toBe(4);

    const packs = await skills.listSkillPacks();
    const byId = Object.fromEntries(packs.map((p) => [p.id, p]));
    expect(byId["emilkowalski/skill"]).toMatchObject({
      kind: "repo",
      author: "emilkowalski",
      repoUrl: "https://github.com/emilkowalski/skill",
      count: 1,
    });
    expect(byId["author:claudekit"]).toMatchObject({ kind: "author", count: 1 });
    expect(byId["plugin:impeccable"]).toMatchObject({
      kind: "plugin",
      author: "Paul Bakaus",
      repoUrl: "https://github.com/pbakaus/impeccable",
      count: 1,
    });
    expect(byId.local).toMatchObject({ count: 1 });
    expect(packs.at(-1)!.id).toBe("local");

    const all = await resources.listResources({ type: "skill" });
    const animate = all.find((r) => r.title === "animate")!;
    expect(animate.sourceUrl).toBe("https://github.com/emilkowalski/skill/blob/HEAD/skills/animate/SKILL.md");
    expect(animate.meta).toMatchObject({ invocation: "/animate", origin: "global", packId: "emilkowalski/skill" });

    const plugin = all.find((r) => (r.meta as { skillName?: string }).skillName === "impeccable:impeccable")!;
    expect(plugin.meta).toMatchObject({ origin: "plugin", readonly: true, invocation: "/impeccable:impeccable" });
    await expect(skills.writeSkillToDisk(plugin.id)).rejects.toThrow(/belongs to a plugin/);
  });

  it("imports guides, moves skills between packs and survives a re-sync", async () => {
    const res = await skills.importSkillGuides({
      packs: [
        {
          id: "nextlevelbuilder/ui-ux-pro-max-skill",
          name: "UI UX Pro Max",
          author: "ClaudeKit",
          repoUrl: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
        },
      ],
      skills: {
        brand: {
          pack: "nextlevelbuilder/ui-ux-pro-max-skill",
          usage: "Brand voice and identity.",
          examples: ["/brand review this copy"],
        },
        animate: {
          invocation: "/animate",
          usage: "Build animations.",
          examples: ["/animate the modal", "/animate the toast"],
          sourceUrl: "https://github.com/emilkowalski/skills/blob/main/skills/animate/SKILL.md",
        },
        nope: { usage: "x" },
      },
    });
    expect(res).toEqual({ updated: 2, unknown: ["nope"] });

    const packs = Object.fromEntries((await skills.listSkillPacks()).map((p) => [p.id, p]));
    expect(packs["nextlevelbuilder/ui-ux-pro-max-skill"].count).toBe(1);
    expect(packs["author:claudekit"].count).toBe(0);

    await skills.syncSkills();
    const animate = (await resources.listResources({ type: "skill" })).find((r) => r.title === "animate")!;
    expect(animate.meta).toMatchObject({
      usage: "Build animations.",
      examples: ["/animate the modal", "/animate the toast"],
    });
    expect(animate.sourceUrl).toContain("emilkowalski/skills/blob/main");
  });

  it("keeps hand-edited pack details when sync runs again", async () => {
    await skills.updateSkillPack("plugin:impeccable", { name: "Impeccable", description: "Design fluency." });
    await skills.syncSkills();
    const pack = (await skills.listSkillPacks()).find((p) => p.id === "plugin:impeccable")!;
    expect(pack).toMatchObject({ name: "Impeccable", description: "Design fluency." });
  });
});
