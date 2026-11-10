// An export bundle writes only inside its own new folder, copies a skill's files only from the skill folders PIVOT
// scans, and never targets PIVOT's data folder. Before this, a resource's metadata (writable with the API token) could
// steer it anywhere: `skillName: "../../…"` and `realPath` overwrote the owner passphrase's hash in the data folder.
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
let owner: typeof import("../src/owner-approval");
let db: typeof import("../src/db/client");
const SECRET = "EXPORT-SYNTHETIC-SECRET-41c7";

beforeAll(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pivot-export-")));
  data = path.join(tmp, "data");
  skills = path.join(tmp, "claude-skills");
  outside = path.join(tmp, "outside");
  await fs.mkdir(path.join(skills, "real-skill"), { recursive: true });
  await fs.writeFile(path.join(skills, "real-skill", "SKILL.md"), "---\nname: real-skill\n---\nok");
  await fs.writeFile(path.join(skills, "real-skill", "helper.md"), "helper");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "owner-approval.json"), `{"forged":"${SECRET}"}`);
  await fs.writeFile(path.join(outside, "id_key"), SECRET);
  Object.assign(process.env, {
    PIVOT_DATA_DIR: data,
    CLAUDE_SKILLS_DIR: skills,
    CLAUDE_PLUGINS_DIR: path.join(tmp, "plugins"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  context = await import("../src/context");
  resources = await import("../src/resources");
  owner = await import("../src/owner-approval");
  db = await import("../src/db/client");
  owner.setOwnerPassphrase("the real owner passphrase");
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Every file under `dir`, as paths relative to it. */
async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true }))
    if (e.isFile()) out.push(path.relative(dir, path.join(e.parentPath, e.name)));
  return out.sort();
}

describe("export bundles stay in their own folder", () => {
  it("a skill name that climbs out (../) stays a folder inside the bundle", async () => {
    const before = await fs.readFile(path.join(data, "owner-approval.json"), "utf8");
    const skill = await resources.createResource({
      type: "skill",
      title: "Sneaky",
      content: "---\nname: sneaky\n---\nbody",
      meta: { skillName: path.relative(path.join(tmp, "out", "bundle", "skills"), data), realPath: outside },
    });
    const target = path.join(tmp, "out");
    const r = await context.exportBundle({ targetDir: target, bundleName: "bundle", resourceIds: [skill.id] });
    // everything is inside the bundle; nothing was written next to it or in the data folder
    expect(r.path.startsWith(`${target}${path.sep}`)).toBe(true);
    expect(await files(target)).toEqual((await files(r.path)).map((f) => path.join(path.basename(r.path), f)).sort());
    expect(await fs.readFile(path.join(data, "owner-approval.json"), "utf8")).toBe(before);
    expect(await files(r.path)).toEqual(["context.md", "skills/sneaky/SKILL.md"]);
  });

  it("a skill's files are copied only from the folders PIVOT scans, never from a path its metadata names", async () => {
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
      meta: { skillName: "real-skill", realPath: path.join(skills, "real-skill") },
    });
    const r = await context.exportBundle({
      targetDir: path.join(tmp, "out2"),
      bundleName: "b",
      resourceIds: [stolen.id, real.id],
    });
    const got = await files(r.path);
    // positive control: the real skill's helper file is copied; nothing from `outside` is
    expect(got).toContain("skills/real-skill/helper.md");
    expect(got).toEqual([
      "context.md",
      "skills/collector/SKILL.md",
      "skills/real-skill/SKILL.md",
      "skills/real-skill/helper.md",
    ]);
    for (const f of got) expect(await fs.readFile(path.join(r.path, f), "utf8")).not.toContain(SECRET);
  });

  it("PIVOT's own export folder (the default) works; hidden folders are refused", async () => {
    const note = await resources.createResource({ type: "prompt", title: "Default", content: "hello" });
    const { paths } = await import("../src/config");
    // positive control: the export dialog's default, inside the data folder
    await expect(
      context.exportBundle({ targetDir: paths.exports(), bundleName: "x", resourceIds: [note.id] }),
    ).resolves.toMatchObject({ fileCount: 2 });
    for (const targetDir of [path.join(tmp, ".claude"), path.join(tmp, "project", ".git", "hooks")])
      await expect(context.exportBundle({ targetDir, bundleName: "commands", resourceIds: [note.id] })).rejects.toThrow(
        /isn't hidden/,
      );
  });

  it("an export can't target PIVOT's data folder or a folder inside it", async () => {
    const note = await resources.createResource({ type: "prompt", title: "Note", content: "hello" });
    for (const targetDir of [data, path.join(data, "sub")])
      await expect(context.exportBundle({ targetDir, bundleName: "x", resourceIds: [note.id] })).rejects.toThrow(
        /outside PIVOT's data folder/,
      );
    // positive controls: a folder next to it, or one that contains it (a new bundle folder is made inside), are fine
    for (const targetDir of [path.join(tmp, "out3"), tmp])
      await expect(context.exportBundle({ targetDir, bundleName: "x", resourceIds: [note.id] })).resolves.toMatchObject(
        {
          fileCount: 2,
        },
      );
  });

  it("share and backup folders follow the same rules; `~name` isn't a path; a symlinked export folder isn't trusted", async () => {
    const note = await resources.createResource({ type: "prompt", title: "Shared", content: "hello" });
    const share = await import("../src/share");
    const backup = await import("../src/backup");
    for (const targetDir of [path.join(tmp, ".claude", "commands"), data, path.join(data, "sub"), "~nobody/x"]) {
      await expect(share.createSharePackage([note.id], { targetDir })).rejects.toThrow(/hidden|data folder|absolute/);
      await expect(backup.createBackup({ targetDir })).rejects.toThrow(/hidden|data folder|absolute/);
      await expect(context.exportBundle({ targetDir, bundleName: "x", resourceIds: [note.id] })).rejects.toThrow(
        /hidden|data folder|absolute/,
      );
    }
    // positive controls: the default (PIVOT's export folder) and an ordinary folder
    await expect(share.createSharePackage([note.id])).resolves.toBeTruthy();
    await expect(backup.createBackup({ targetDir: path.join(tmp, "backups") })).resolves.toBeTruthy();
    // a planted symlink in place of the export folder doesn't make a hidden folder writable
    const { paths } = await import("../src/config");
    const planted = path.join(tmp, ".planted");
    await fs.mkdir(planted, { recursive: true });
    await fs.rename(paths.exports(), path.join(tmp, "exports-moved"));
    await fs.symlink(planted, paths.exports());
    try {
      await expect(
        context.exportBundle({ targetDir: paths.exports(), bundleName: "x", resourceIds: [note.id] }),
      ).rejects.toThrow(/isn't hidden/);
      expect(await fs.readdir(planted)).toEqual([]);
    } finally {
      await fs.rm(paths.exports());
      await fs.rename(path.join(tmp, "exports-moved"), paths.exports());
    }
  });
});
