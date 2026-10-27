import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import matter from "gray-matter";
import { skillsDir } from "./config";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { createResource, setResourceFields } from "./resources";
import type { SkillStatusDTO, SkillSyncState } from "./types";

export interface SkillMeta {
  skillName?: string;
  dirPath?: string;
  realPath?: string;
  isSymlink?: boolean;
  /** Hash of SKILL.md on disk at the last sync — the common ancestor for change detection. */
  diskHash?: string;
  files?: string[];
  syncedAt?: string;
  whenToUse?: string;
}

interface DiskSkill {
  skillName: string;
  dirPath: string;
  realPath: string;
  isSymlink: boolean;
  content: string;
  hash: string;
  files: string[];
}

export class SkillConflictError extends Error {}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const IGNORED_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv"]);

export const hashText = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

async function listFiles(root: string, rel = "", out: string[] = []): Promise<string[]> {
  if (out.length >= 200) return out;
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name.startsWith(".") || IGNORED_DIRS.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) await listFiles(root, r, out);
    else out.push(r);
  }
  return out;
}

async function readDiskSkill(skillName: string): Promise<DiskSkill | null> {
  const dirPath = path.join(skillsDir(), skillName);
  try {
    const lst = await fs.lstat(dirPath);
    const realPath = await fs.realpath(dirPath);
    const st = await fs.stat(realPath);
    if (!st.isDirectory()) return null;
    const content = await fs.readFile(path.join(realPath, "SKILL.md"), "utf8");
    return {
      skillName,
      dirPath,
      realPath,
      isSymlink: lst.isSymbolicLink(),
      content,
      hash: hashText(content),
      files: await listFiles(realPath),
    };
  } catch {
    return null;
  }
}

export async function scanDiskSkills(): Promise<DiskSkill[]> {
  const entries = await fs.readdir(skillsDir()).catch(() => [] as string[]);
  const skills = await Promise.all(
    entries.filter((n) => !n.startsWith(".") && SKILL_NAME_RE.test(n)).map((n) => readDiskSkill(n)),
  );
  return skills.filter((s): s is DiskSkill => !!s).sort((a, b) => a.skillName.localeCompare(b.skillName));
}

function computeState(appContent: string, meta: SkillMeta, disk: DiskSkill | undefined): SkillSyncState {
  if (!disk) return "missing";
  const app = hashText(appContent);
  const base = meta.diskHash;
  if (app === disk.hash) return "synced";
  const diskChanged = disk.hash !== base;
  const appChanged = app !== base;
  if (diskChanged && appChanged) return "conflict";
  return diskChanged ? "disk-changed" : "app-changed";
}

async function skillResources() {
  const db = await getDb();
  return db.select().from(resources).where(eq(resources.type, "skill"));
}

export async function skillStatuses(): Promise<SkillStatusDTO[]> {
  const [disk, rows] = await Promise.all([scanDiskSkills(), skillResources()]);
  const diskByName = new Map(disk.map((d) => [d.skillName, d]));
  const out: SkillStatusDTO[] = [];
  const tracked = new Set<string>();
  for (const row of rows) {
    const meta = (row.meta ?? {}) as SkillMeta;
    if (!meta.skillName) continue;
    tracked.add(meta.skillName);
    if (row.deletedAt) continue;
    const d = diskByName.get(meta.skillName);
    out.push({
      resourceId: row.id,
      skillName: meta.skillName,
      state: computeState(row.content, meta, d),
      dirPath: d?.dirPath ?? path.join(/* turbopackIgnore: true */ skillsDir(), meta.skillName),
      isSymlink: d?.isSymlink ?? false,
    });
  }
  for (const d of disk) {
    if (!tracked.has(d.skillName)) {
      out.push({ resourceId: null, skillName: d.skillName, state: "untracked", dirPath: d.dirPath, isSymlink: d.isSymlink });
    }
  }
  return out.sort((a, b) => a.skillName.localeCompare(b.skillName));
}

function diskMeta(d: DiskSkill): SkillMeta {
  return {
    skillName: d.skillName,
    dirPath: d.dirPath,
    realPath: d.realPath,
    isSymlink: d.isSymlink,
    diskHash: d.hash,
    files: d.files,
    syncedAt: new Date().toISOString(),
  };
}

function frontmatter(content: string): { name?: string; description?: string } {
  try {
    const data = matter(content).data as Record<string, unknown>;
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Imports new skills from ~/.claude/skills and pulls changes made on disk.
 * Skills edited in the app (or in conflict) are left untouched. Trashed skills are not re-imported.
 */
export async function syncSkills() {
  const [disk, rows] = await Promise.all([scanDiskSkills(), skillResources()]);
  const byName = new Map(rows.filter((r) => (r.meta as SkillMeta)?.skillName).map((r) => [(r.meta as SkillMeta).skillName!, r]));
  let created = 0;
  let updated = 0;
  let conflicts = 0;

  for (const d of disk) {
    const row = byName.get(d.skillName);
    if (!row) {
      const fm = frontmatter(d.content);
      await createResource({
        type: "skill",
        title: fm.name ?? d.skillName,
        description: fm.description ?? "",
        content: d.content,
        meta: { ...diskMeta(d) },
      });
      created++;
      continue;
    }
    if (row.deletedAt) continue;
    const meta = (row.meta ?? {}) as SkillMeta;
    const state = computeState(row.content, meta, d);
    if (state === "disk-changed") {
      const fm = frontmatter(d.content);
      await setResourceFields(row.id, {
        content: d.content,
        title: fm.name ?? row.title,
        description: fm.description ?? row.description,
        meta: { ...meta, ...diskMeta(d) },
        updatedAt: new Date(),
      });
      updated++;
    } else if (state === "synced") {
      await setResourceFields(row.id, { meta: { ...meta, ...diskMeta(d) } });
    } else if (state === "conflict") {
      conflicts++;
    }
  }
  return { created, updated, conflicts, total: disk.length };
}

export function validateSkillContent(content: string): string[] {
  const problems: string[] = [];
  const fm = frontmatter(content);
  if (!/^---\r?\n/.test(content)) problems.push("SKILL.md must start with YAML frontmatter (---).");
  if (!fm.name) problems.push("Frontmatter needs a `name`.");
  if (!fm.description) problems.push("Frontmatter needs a `description` — Claude uses it to decide when to load the skill.");
  return problems;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Writes the app's version of a skill to ~/.claude/skills/<name>/SKILL.md. */
export async function writeSkillToDisk(resourceId: string, { force = false } = {}) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!row || row.type !== "skill") throw new Error("Skill not found.");
  const problems = validateSkillContent(row.content);
  if (problems.length) throw new Error(problems.join(" "));

  const meta = (row.meta ?? {}) as SkillMeta;
  const skillName = meta.skillName ?? slugify(frontmatter(row.content).name ?? row.title);
  if (!SKILL_NAME_RE.test(skillName)) throw new Error(`"${skillName}" is not a valid skill folder name.`);

  const existing = await readDiskSkill(skillName);
  if (existing && !force && meta.diskHash && existing.hash !== meta.diskHash && existing.hash !== hashText(row.content)) {
    throw new SkillConflictError("SKILL.md changed on disk since the last sync. Choose which version to keep.");
  }
  if (existing && !meta.skillName && !force) {
    throw new SkillConflictError(`A skill named "${skillName}" already exists on disk.`);
  }

  const dir = existing?.realPath ?? path.join(/* turbopackIgnore: true */ skillsDir(), skillName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), row.content, "utf8");
  const d = (await readDiskSkill(skillName))!;
  await setResourceFields(resourceId, { meta: { ...meta, ...diskMeta(d) } });
  return { path: path.join(d.dirPath, "SKILL.md") };
}

/** Replaces the app's copy with what is on disk (resolves a conflict in favour of disk). */
export async function pullSkillFromDisk(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const meta = (row?.meta ?? {}) as SkillMeta;
  if (!row || !meta.skillName) throw new Error("Skill not found.");
  const d = await readDiskSkill(meta.skillName);
  if (!d) throw new Error("This skill no longer exists on disk.");
  const fm = frontmatter(d.content);
  await setResourceFields(resourceId, {
    content: d.content,
    title: fm.name ?? row.title,
    description: fm.description ?? row.description,
    meta: { ...meta, ...diskMeta(d) },
    updatedAt: new Date(),
  });
}

export async function readSkillDir(skillName: string) {
  return readDiskSkill(skillName);
}
