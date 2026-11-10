// An export bundle writes only inside its own new folder, copies a skill's files only from the skills folder the app
// scans, and never targets the app's data folder. Before this, a resource's metadata (writable with the API token)
// could steer it anywhere: `skillName: "../../…"` plus `realPath` wrote attacker-chosen files anywhere the user can.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let data: string;
let skills: string;
let outside: string;
let context: typeof import("../src/context");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");
const SECRET = "EXPORT-SYNTHETIC-SECRET-41c7";

beforeAll(async () => {
  tmp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "export-containment-")),
  );
  data = path.join(tmp, "data");
  skills = path.join(tmp, "claude-skills");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(skills, "real-skill"), { recursive: true });
  await fs.writeFile(
    path.join(skills, "real-skill", "SKILL.md"),
    "---\nname: real-skill\n---\nok",
  );
  await fs.writeFile(path.join(skills, "real-skill", "helper.md"), "helper");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "api-token"), SECRET);
  Object.assign(process.env, {
    STAN_BAG_DATA_DIR: data,
    CLAUDE_SKILLS_DIR: skills,
    STAN_BAG_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  context = await import("../src/context");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
  await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(data, "api-token"), "the real token");
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, {
    withFileTypes: true,
    recursive: true,
  }))
    if (e.isFile())
      out.push(path.relative(dir, path.join(e.parentPath, e.name)));
  return out.sort();
}

describe("export bundles stay in their own folder", () => {
  it("a skill name that climbs out (../) stays a folder inside the bundle; the data folder is untouched", async () => {
    const target = path.join(tmp, "out");
    const skill = await resources.createResource({
      type: "skill",
      title: "Sneaky",
      content: "---\nname: sneaky\n---\nbody",
      meta: {
        skillName: path.relative(path.join(target, "bundle", "skills"), data),
        realPath: outside,
      },
    });
    const r = await context.exportBundle({
      targetDir: target,
      bundleName: "bundle",
      resourceIds: [skill.id],
    });
    expect(await files(target)).toEqual(
      (await files(r.path))
        .map((f) => path.join(path.basename(r.path), f))
        .sort(),
    );
    expect(await fs.readFile(path.join(data, "api-token"), "utf8")).toBe(
      "the real token",
    );
    expect(await files(r.path)).toEqual([
      "context.md",
      "skills/sneaky/SKILL.md",
    ]);
  });

  it("a skill's files are copied only from the skills folder, never from a path its metadata names", async () => {
    const stolen = await resources.createResource({
      type: "skill",
      title: "Collector",
      content: "---\nname: collector\n---\nbody",
      meta: { skillName: "collector", realPath: outside },
    });
    const real = await resources.createResource({
      type: "skill",
      title: "Real skill",
      content: "---\nname: real-skill\n---\nok",
      meta: {
        skillName: "real-skill",
        realPath: path.join(skills, "real-skill"),
      },
    });
    const r = await context.exportBundle({
      targetDir: path.join(tmp, "out2"),
      bundleName: "b",
      resourceIds: [stolen.id, real.id],
    });
    const got = await files(r.path);
    expect(got).toEqual([
      "context.md",
      "skills/collector/SKILL.md",
      "skills/real-skill/SKILL.md",
      "skills/real-skill/helper.md",
    ]);
    for (const f of got)
      expect(await fs.readFile(path.join(r.path, f), "utf8")).not.toContain(
        SECRET,
      );
  });

  it("an export can't target the data folder or a folder inside it; next to it is fine", async () => {
    const note = await resources.createResource({
      type: "prompt",
      title: "Note",
      content: "hello",
    });
    for (const targetDir of [data, path.join(data, "sub")])
      await expect(
        context.exportBundle({
          targetDir,
          bundleName: "x",
          resourceIds: [note.id],
        }),
      ).rejects.toThrow(/outside PIVOT's data folder/);
    for (const targetDir of [path.join(tmp, "out3"), tmp])
      await expect(
        context.exportBundle({
          targetDir,
          bundleName: "x",
          resourceIds: [note.id],
        }),
      ).resolves.toMatchObject({
        fileCount: 2,
      });
  });
});
