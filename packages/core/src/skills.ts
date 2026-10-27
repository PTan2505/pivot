import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import matter from "gray-matter";
import { z } from "zod";
import { pluginsDir, skillLockPath, skillsDir } from "./config";
import { getDb } from "./db/client";
import { resources, skillPacks } from "./db/schema";
import { createResource, setResourceFields } from "./resources";
import type { SkillPackDTO, SkillStatusDTO, SkillSyncState } from "./types";

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
  /** Where the skill was found: ~/.claude/skills ("global") or inside an installed plugin ("plugin"). */
  origin?: "global" | "plugin";
  /** Plugin skills are owned by the plugin and get overwritten on update, so the app never writes them. */
  readonly?: boolean;
  /** Pack detected on disk (lock file, plugin, frontmatter author). */
  packId?: string;
  /** Pack chosen by hand; wins over packId. */
  packOverride?: string;
  /** How to call it in Claude Code, e.g. "/animate" or "/figma:figma-use". */
  invocation?: string;
  /** Markdown: what it does, when to use it, what it needs. */
  usage?: string;
  /** Example prompts. */
  examples?: string[];
}

export interface DetectedPack {
  id: string;
  name: string;
  author: string | null;
  kind: "repo" | "plugin" | "author" | "local";
  repoUrl: string | null;
  homepage: string | null;
  description: string;
}

interface DiskSkill {
  skillName: string;
  dirPath: string;
  realPath: string;
  isSymlink: boolean;
  content: string;
  hash: string;
  files: string[];
  origin: "global" | "plugin";
  pack: DetectedPack;
  /** GitHub URL of SKILL.md when the source repo is known. */
  sourceUrl: string | null;
}

export class SkillConflictError extends Error {}

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const IGNORED_DIRS = new Set(["node_modules", ".git", "__pycache__", ".venv"]);
export const LOCAL_PACK_ID = "local";

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

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function frontmatter(content: string): { name?: string; description?: string; author?: string } {
  try {
    const data = matter(content).data as Record<string, unknown>;
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const author =
      typeof meta.author === "string" ? meta.author : typeof data.author === "string" ? data.author : undefined;
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      author,
    };
  } catch {
    return {};
  }
}

const repoUrlOf = (url: string) => url.replace(/\.git$/, "").replace(/\/+$/, "");

// ---- Pack detection --------------------------------------------------------

interface LockEntry {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
}

async function readSkillLock(): Promise<Record<string, LockEntry>> {
  const lock = await readJson<{ skills?: Record<string, LockEntry> }>(skillLockPath());
  return lock?.skills ?? {};
}

function packForGlobal(
  name: string,
  content: string,
  lock: Record<string, LockEntry>,
): { pack: DetectedPack; sourceUrl: string | null } {
  const entry = lock[name];
  if (entry?.source) {
    const repoUrl = entry.sourceUrl
      ? repoUrlOf(entry.sourceUrl)
      : entry.sourceType === "github"
        ? `https://github.com/${entry.source}`
        : null;
    const [owner, repo] = entry.source.split("/");
    return {
      pack: {
        id: entry.source,
        name: repo ?? entry.source,
        author: owner ?? null,
        kind: "repo",
        repoUrl,
        homepage: null,
        description: "",
      },
      sourceUrl:
        repoUrl && entry.skillPath && repoUrl.includes("github.com") ? `${repoUrl}/blob/HEAD/${entry.skillPath}` : null,
    };
  }
  const author = frontmatter(content).author;
  if (author) {
    return {
      pack: {
        id: `author:${author.toLowerCase()}`,
        name: author,
        author,
        kind: "author",
        repoUrl: null,
        homepage: null,
        description: "",
      },
      sourceUrl: null,
    };
  }
  return {
    pack: {
      id: LOCAL_PACK_ID,
      name: "Your skills",
      author: null,
      kind: "local",
      repoUrl: null,
      homepage: null,
      description: "Skills with no known source.",
    },
    sourceUrl: null,
  };
}

async function readSkillDir(
  dirPath: string,
): Promise<{ realPath: string; isSymlink: boolean; content: string; files: string[] } | null> {
  try {
    const lst = await fs.lstat(dirPath);
    const realPath = await fs.realpath(dirPath);
    if (!(await fs.stat(realPath)).isDirectory()) return null;
    const content = await fs.readFile(path.join(realPath, "SKILL.md"), "utf8");
    return { realPath, isSymlink: lst.isSymbolicLink(), content, files: await listFiles(realPath) };
  } catch {
    return null;
  }
}

async function scanGlobalSkills(): Promise<DiskSkill[]> {
  const lock = await readSkillLock();
  const entries = await fs.readdir(skillsDir()).catch(() => [] as string[]);
  const out: DiskSkill[] = [];
  for (const name of entries) {
    if (name.startsWith(".") || !SKILL_NAME_RE.test(name)) continue;
    const dirPath = path.join(skillsDir(), name);
    const dir = await readSkillDir(dirPath);
    if (!dir) continue;
    const { pack, sourceUrl } = packForGlobal(name, dir.content, lock);
    out.push({ skillName: name, dirPath, ...dir, hash: hashText(dir.content), origin: "global", pack, sourceUrl });
  }
  return out;
}

interface InstalledPlugins {
  plugins?: Record<string, { scope?: string; installPath?: string }[]>;
}

interface PluginManifest {
  name?: string;
  description?: string;
  author?: { name?: string } | string;
  homepage?: string;
  repository?: string | { url?: string };
  skills?: string | string[];
}

/** Skills shipped inside installed Claude Code plugins (~/.claude/plugins), invoked as `<plugin>:<skill>`. */
async function scanPluginSkills(): Promise<DiskSkill[]> {
  const installed = await readJson<InstalledPlugins>(path.join(pluginsDir(), "installed_plugins.json"));
  const seen = new Set<string>();
  const out: DiskSkill[] = [];
  for (const [key, installs] of Object.entries(installed?.plugins ?? {})) {
    const install = installs.find((i) => i.scope === "user") ?? installs[0];
    if (!install?.installPath || seen.has(install.installPath)) continue;
    seen.add(install.installPath);
    const manifest =
      (await readJson<PluginManifest>(path.join(install.installPath, ".claude-plugin", "plugin.json"))) ?? {};
    const pluginName = manifest.name ?? key.split("@")[0];
    const author = typeof manifest.author === "string" ? manifest.author : (manifest.author?.name ?? null);
    const repo = typeof manifest.repository === "string" ? manifest.repository : (manifest.repository?.url ?? null);
    const pack: DetectedPack = {
      id: `plugin:${pluginName}`,
      name: pluginName,
      author,
      kind: "plugin",
      repoUrl: repo ? repoUrlOf(repo) : null,
      homepage: manifest.homepage ?? null,
      description: manifest.description ?? "",
    };
    const skillRoots = manifest.skills
      ? Array.isArray(manifest.skills)
        ? manifest.skills
        : [manifest.skills]
      : ["./skills"];
    for (const root of skillRoots) {
      const base = path.resolve(install.installPath, root);
      if (!base.startsWith(path.resolve(install.installPath))) continue;
      const dirs = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDirectory() || d.name.startsWith(".")) continue;
        const dir = await readSkillDir(path.join(base, d.name));
        if (!dir) continue;
        out.push({
          skillName: `${pluginName}:${d.name}`,
          dirPath: path.join(base, d.name),
          ...dir,
          hash: hashText(dir.content),
          origin: "plugin",
          pack,
          sourceUrl: null,
        });
      }
    }
  }
  return out;
}

export async function scanDiskSkills(): Promise<DiskSkill[]> {
  const [global, plugin] = await Promise.all([scanGlobalSkills(), scanPluginSkills()]);
  return [...global, ...plugin].sort((a, b) => a.skillName.localeCompare(b.skillName));
}

async function findDiskSkill(skillName: string): Promise<DiskSkill | null> {
  if (!skillName.includes(":")) {
    const dirPath = path.join(skillsDir(), skillName);
    const dir = await readSkillDir(dirPath);
    if (!dir) return null;
    const { pack, sourceUrl } = packForGlobal(skillName, dir.content, await readSkillLock());
    return { skillName, dirPath, ...dir, hash: hashText(dir.content), origin: "global", pack, sourceUrl };
  }
  return (await scanPluginSkills()).find((s) => s.skillName === skillName) ?? null;
}

// ---- Sync ------------------------------------------------------------------

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
      dirPath: d?.dirPath ?? meta.dirPath ?? path.join(/* turbopackIgnore: true */ skillsDir(), meta.skillName),
      isSymlink: d?.isSymlink ?? false,
      readonly: !!meta.readonly,
    });
  }
  for (const d of disk) {
    if (!tracked.has(d.skillName)) {
      out.push({
        resourceId: null,
        skillName: d.skillName,
        state: "untracked",
        dirPath: d.dirPath,
        isSymlink: d.isSymlink,
        readonly: d.origin === "plugin",
      });
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
    origin: d.origin,
    readonly: d.origin === "plugin",
    packId: d.pack.id,
  };
}

/** Creates packs that don't exist yet and fills fields that are still empty; never overwrites edits. */
async function upsertDetectedPacks(packs: DetectedPack[]) {
  const db = await getDb();
  const unique = [...new Map(packs.map((p) => [p.id, p])).values()];
  for (const p of unique) {
    const [existing] = await db.select().from(skillPacks).where(eq(skillPacks.id, p.id)).limit(1);
    if (!existing) {
      await db.insert(skillPacks).values(p).onConflictDoNothing();
      continue;
    }
    const fill: Partial<typeof skillPacks.$inferInsert> = {};
    if (!existing.author && p.author) fill.author = p.author;
    if (!existing.repoUrl && p.repoUrl) fill.repoUrl = p.repoUrl;
    if (!existing.homepage && p.homepage) fill.homepage = p.homepage;
    if (!existing.description && p.description) fill.description = p.description;
    if (Object.keys(fill).length)
      await db
        .update(skillPacks)
        .set({ ...fill, updatedAt: new Date() })
        .where(eq(skillPacks.id, p.id));
  }
}

/**
 * Imports new skills from ~/.claude/skills and installed plugins, and pulls changes made on disk.
 * Skills edited in the app (or in conflict) are left untouched. Trashed skills are not re-imported.
 */
export async function syncSkills() {
  const [disk, rows] = await Promise.all([scanDiskSkills(), skillResources()]);
  await upsertDetectedPacks(disk.map((d) => d.pack));
  const byName = new Map(
    rows.filter((r) => (r.meta as SkillMeta)?.skillName).map((r) => [(r.meta as SkillMeta).skillName!, r]),
  );
  let created = 0;
  let updated = 0;
  let conflicts = 0;

  for (const d of disk) {
    const row = byName.get(d.skillName);
    if (!row) {
      const fm = frontmatter(d.content);
      await createResource({
        type: "skill",
        title: d.origin === "plugin" ? d.skillName : (fm.name ?? d.skillName),
        description: fm.description ?? "",
        content: d.content,
        sourceUrl: d.sourceUrl,
        meta: { ...diskMeta(d), invocation: `/${d.skillName}` },
      });
      created++;
      continue;
    }
    if (row.deletedAt) continue;
    const meta = (row.meta ?? {}) as SkillMeta;
    const state = computeState(row.content, meta, d);
    const extra = { sourceUrl: row.sourceUrl ?? d.sourceUrl };
    if (state === "disk-changed" || (state === "conflict" && d.origin === "plugin")) {
      // Plugin skills can't be edited here, so the disk version always wins.
      const fm = frontmatter(d.content);
      await setResourceFields(row.id, {
        ...extra,
        content: d.content,
        title: d.origin === "plugin" ? row.title : (fm.name ?? row.title),
        description: fm.description ?? row.description,
        meta: { ...meta, ...diskMeta(d) },
        updatedAt: new Date(),
      });
      updated++;
    } else if (state === "synced") {
      await setResourceFields(row.id, { ...extra, meta: { ...meta, ...diskMeta(d) } });
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
  if (!fm.description)
    problems.push("Frontmatter needs a `description` — Claude uses it to decide when to load the skill.");
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
  const meta = (row.meta ?? {}) as SkillMeta;
  if (meta.readonly) throw new Error("This skill belongs to a plugin; update the plugin instead of editing it here.");
  const problems = validateSkillContent(row.content);
  if (problems.length) throw new Error(problems.join(" "));

  const skillName = meta.skillName ?? slugify(frontmatter(row.content).name ?? row.title);
  if (!SKILL_NAME_RE.test(skillName)) throw new Error(`"${skillName}" is not a valid skill folder name.`);

  const existing = await findDiskSkill(skillName);
  if (
    existing &&
    !force &&
    meta.diskHash &&
    existing.hash !== meta.diskHash &&
    existing.hash !== hashText(row.content)
  ) {
    throw new SkillConflictError("SKILL.md changed on disk since the last sync. Choose which version to keep.");
  }
  if (existing && !meta.skillName && !force) {
    throw new SkillConflictError(`A skill named "${skillName}" already exists on disk.`);
  }

  const dir = existing?.realPath ?? path.join(/* turbopackIgnore: true */ skillsDir(), skillName);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), row.content, "utf8");
  const d = (await findDiskSkill(skillName))!;
  await setResourceFields(resourceId, { meta: { ...meta, ...diskMeta(d) } });
  return { path: path.join(d.dirPath, "SKILL.md") };
}

/** Replaces the app's copy with what is on disk (resolves a conflict in favour of disk). */
export async function pullSkillFromDisk(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const meta = (row?.meta ?? {}) as SkillMeta;
  if (!row || !meta.skillName) throw new Error("Skill not found.");
  const d = await findDiskSkill(meta.skillName);
  if (!d) throw new Error("This skill no longer exists on disk.");
  const fm = frontmatter(d.content);
  await setResourceFields(resourceId, {
    content: d.content,
    title: d.origin === "plugin" ? row.title : (fm.name ?? row.title),
    description: fm.description ?? row.description,
    meta: { ...meta, ...diskMeta(d) },
    updatedAt: new Date(),
  });
}

// ---- Packs -----------------------------------------------------------------

export const packInput = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  author: z.string().trim().max(120).nullable().optional(),
  repoUrl: z.string().trim().url().nullable().optional(),
  homepage: z.string().trim().url().nullable().optional(),
  description: z.string().max(2000).optional(),
});

const effectivePack = (meta: SkillMeta) => meta.packOverride || meta.packId || LOCAL_PACK_ID;

export async function listSkillPacks(): Promise<SkillPackDTO[]> {
  const db = await getDb();
  const [packs, rows] = await Promise.all([
    db.select().from(skillPacks),
    db
      .select({ meta: resources.meta })
      .from(resources)
      .where(sql`${resources.type} = 'skill' and ${resources.deletedAt} is null`),
  ]);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = effectivePack((r.meta ?? {}) as SkillMeta);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const list: SkillPackDTO[] = packs.map((p) => ({
    id: p.id,
    name: p.name,
    author: p.author,
    kind: p.kind as SkillPackDTO["kind"],
    repoUrl: p.repoUrl,
    homepage: p.homepage,
    description: p.description,
    count: counts.get(p.id) ?? 0,
  }));
  // Skills pointing at a pack that has no row yet still need a group.
  for (const [id, count] of counts) {
    if (!list.some((p) => p.id === id)) {
      list.push({
        id,
        name: id === LOCAL_PACK_ID ? "Your skills" : id,
        author: null,
        kind: "local",
        repoUrl: null,
        homepage: null,
        description: "",
        count,
      });
    }
  }
  return list.sort((a, b) => (a.id === LOCAL_PACK_ID ? 1 : b.id === LOCAL_PACK_ID ? -1 : a.name.localeCompare(b.name)));
}

export async function updateSkillPack(id: string, patch: Partial<z.infer<typeof packInput>>) {
  const data = packInput.partial().parse(patch);
  const db = await getDb();
  const [existing] = await db.select().from(skillPacks).where(eq(skillPacks.id, id)).limit(1);
  if (!existing) {
    await db.insert(skillPacks).values({ kind: "repo", name: data.name ?? id, ...data, id });
    return;
  }
  const { id: _ignored, ...rest } = data;
  void _ignored;
  await db
    .update(skillPacks)
    .set({ ...rest, updatedAt: new Date() })
    .where(eq(skillPacks.id, id));
}

export const guideImport = z.object({
  packs: z.array(packInput).default([]),
  skills: z.record(
    z.string(),
    z.object({
      pack: z.string().optional(),
      invocation: z.string().max(200).optional(),
      usage: z.string().max(20_000).optional(),
      examples: z.array(z.string().max(2000)).max(20).optional(),
      sourceUrl: z.string().url().nullable().optional(),
    }),
  ),
});

/**
 * Loads usage guides (pack info, invocation, how-to, example prompts) for skills by name.
 * Packs are upserted; a skill whose guide names a different pack than the detected one is
 * moved there (packOverride). Unknown skill names are reported, not created.
 */
export async function importSkillGuides(input: z.infer<typeof guideImport>) {
  const data = guideImport.parse(input);
  for (const p of data.packs) await updateSkillPack(p.id, p);
  const rows = await skillResources();
  const byName = new Map(
    rows.filter((r) => (r.meta as SkillMeta)?.skillName).map((r) => [(r.meta as SkillMeta).skillName!, r]),
  );
  const updated: string[] = [];
  const unknown: string[] = [];
  for (const [name, guide] of Object.entries(data.skills)) {
    const row = byName.get(name);
    if (!row) {
      unknown.push(name);
      continue;
    }
    const meta = (row.meta ?? {}) as SkillMeta;
    const next: SkillMeta = { ...meta };
    if (guide.invocation) next.invocation = guide.invocation;
    if (guide.usage) next.usage = guide.usage;
    if (guide.examples) next.examples = guide.examples;
    if (guide.pack && guide.pack !== meta.packId) next.packOverride = guide.pack;
    await setResourceFields(row.id, {
      meta: { ...next },
      sourceUrl: guide.sourceUrl ?? row.sourceUrl,
    });
    updated.push(name);
  }
  return { updated: updated.length, unknown };
}
