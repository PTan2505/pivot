import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getAsset, readAssetBytes, saveAsset } from "./assets";
import { expandHome, paths } from "./config";
import { getDb } from "./db/client";
import {
  appSettings,
  assetAnnotations,
  assets,
  collectionItems,
  collections,
  designDecisions,
  designSessions,
  designSnapshots,
  resourceAssets,
  resourceLinks,
  resources,
  resourceSuggestions,
  resourceTags,
  tags,
} from "./db/schema";
import { urlKey } from "./net-guard";

export class BackupError extends Error {}

export const BACKUP_FORMAT = "pivot-backup";
export const BACKUP_VERSION = 1;
const MAX_DATA_BYTES = 200 * 1024 * 1024;
const ASSET_FILE = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

type Rows<T extends { $inferSelect: unknown }> = T["$inferSelect"][];

/** Everything a backup holds besides the files. Ids are kept, so links between rows stay valid. */
export interface BackupData {
  resources: Rows<typeof resources>;
  tags: Rows<typeof tags>;
  resourceTags: Rows<typeof resourceTags>;
  collections: Rows<typeof collections>;
  collectionItems: Rows<typeof collectionItems>;
  assets: (Omit<Rows<typeof assets>[number], "storagePath" | "storage"> & { file: string })[];
  resourceAssets: Rows<typeof resourceAssets>;
  links: Rows<typeof resourceLinks>;
  annotations: Rows<typeof assetAnnotations>;
  designSessions: Rows<typeof designSessions>;
  designSnapshots: Rows<typeof designSnapshots>;
  designDecisions: Rows<typeof designDecisions>;
  suggestions: Rows<typeof resourceSuggestions>;
  settings: Rows<typeof appSettings>;
}

function folderFor(targetDir: string | undefined) {
  const raw = (targetDir ?? paths.exports()).trim();
  if (!raw.startsWith("~") && !path.isAbsolute(raw)) throw new BackupError("Choose an absolute folder path.");
  return path.resolve(expandHome(raw));
}

const extOf = (fileName: string, mime: string) =>
  (path.extname(fileName).slice(1) || mime.split("/")[1]?.split(/[+;]/)[0] || "bin").toLowerCase().slice(0, 8);

/**
 * A full, portable copy of the library: every live reference with its facets, collections, links, notes on
 * screenshots, design sessions and pending suggestions, and the files (named by their sha256). The API token, cookies
 * and passwords are never in it. Trashed items are left out.
 */
export async function createBackup({ targetDir }: { targetDir?: string } = {}) {
  const db = await getDb();
  const live = await db.select().from(resources).where(isNull(resources.deletedAt));
  const ids = live.map((r) => r.id);
  const inIds = <T extends { resourceId: string }>(rows: T[]) => rows.filter((r) => ids.includes(r.resourceId));
  const ra = inIds(await db.select().from(resourceAssets));
  const assetIds = [...new Set(ra.map((r) => r.assetId))];
  const assetRows = assetIds.length ? await db.select().from(assets).where(inArray(assets.id, assetIds)) : [];

  const root = path.join(folderFor(targetDir), `pivot-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await fs.mkdir(path.join(root, "assets"), { recursive: true });
  const data: BackupData = {
    resources: live,
    tags: await db.select().from(tags),
    resourceTags: inIds(await db.select().from(resourceTags)),
    collections: await db.select().from(collections),
    collectionItems: inIds(await db.select().from(collectionItems)),
    assets: [],
    resourceAssets: ra,
    links: (await db.select().from(resourceLinks)).filter((l) => ids.includes(l.fromId) && ids.includes(l.toId)),
    annotations: inIds(await db.select().from(assetAnnotations)),
    designSessions: await db.select().from(designSessions),
    designSnapshots: await db.select().from(designSnapshots),
    designDecisions: await db.select().from(designDecisions),
    suggestions: inIds(await db.select().from(resourceSuggestions).where(eq(resourceSuggestions.status, "pending"))),
    settings: await db.select().from(appSettings),
  };
  let missing = 0;
  for (const row of assetRows) {
    const bytes = await readAssetBytes(row);
    if (!bytes) {
      missing++;
      continue;
    }
    const file = `${row.sha256}.${extOf(row.fileName, row.mimeType)}`;
    await fs.writeFile(path.join(root, "assets", file), bytes);
    const { storagePath: _p, storage: _s, ...rest } = row;
    data.assets.push({ ...rest, file });
  }
  const counts = {
    resources: data.resources.length,
    collections: data.collections.length,
    assets: data.assets.length,
    links: data.links.length,
    annotations: data.annotations.length,
    designSessions: data.designSessions.length,
    missingFiles: missing,
  };
  await fs.writeFile(path.join(root, "data.json"), JSON.stringify(data));
  await fs.writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(
      { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), counts },
      null,
      2,
    ),
  );
  return { path: root, counts };
}

/** Reads and checks a backup folder: the format, the size, and every file name, so nothing outside it is touched. */
async function readBackup(dir: string) {
  const root = folderFor(dir);
  const stat = await fs.lstat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new BackupError("That folder doesn't exist.");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8").catch(() => "{}")) as {
    format?: string;
    version?: number;
  };
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError("This folder isn't a PIVOT backup (no manifest).");
  if ((manifest.version ?? 0) > BACKUP_VERSION) {
    throw new BackupError("This backup was made by a newer PIVOT. Update PIVOT, then restore it.");
  }
  const dataStat = await fs.lstat(path.join(root, "data.json")).catch(() => null);
  if (!dataStat?.isFile() || dataStat.size > MAX_DATA_BYTES)
    throw new BackupError("The backup's data file is missing or too big.");
  const data = JSON.parse(await fs.readFile(path.join(root, "data.json"), "utf8")) as BackupData;
  for (const a of data.assets ?? []) {
    if (!ASSET_FILE.test(a.file) || !a.file.startsWith(a.sha256))
      throw new BackupError(`Unsafe file name in the backup: ${a.file}`);
  }
  return { root, data };
}

/** Reads one file of a backup, refusing links and checking its sha256. */
async function backupFile(root: string, a: BackupData["assets"][number]) {
  const file = path.join(root, "assets", a.file);
  if (path.dirname(file) !== path.join(root, "assets")) return null;
  const s = await fs.lstat(file).catch(() => null);
  if (!s?.isFile()) return null;
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex") === a.sha256 ? bytes : null;
}

export type RestoreChoice = "keep" | "new" | "merge";

export interface RestorePlanItem {
  id: string;
  title: string;
  type: string;
  /** new: not in this library. same_id: this very reference is here. same_url: another reference has its URL. */
  status: "new" | "same_id" | "same_url";
  /** What happens unless you choose otherwise: import new ones, keep what you have for the rest. */
  defaultChoice: RestoreChoice | "import";
}

/** What a restore would do, before anything is written. */
export async function previewRestore(dir: string) {
  const { data } = await readBackup(dir);
  const db = await getDb();
  const ids = data.resources.map((r) => r.id);
  const existing = ids.length
    ? await db.select({ id: resources.id }).from(resources).where(inArray(resources.id, ids))
    : [];
  const here = new Set(existing.map((e) => e.id));
  const live = await db
    .select({ id: resources.id, sourceUrl: resources.sourceUrl, type: resources.type, meta: resources.meta })
    .from(resources)
    .where(isNull(resources.deletedAt));
  const byUrl = new Set(live.filter((r) => r.sourceUrl).map((r) => `${r.type}|${urlKey(r.sourceUrl!)}`));
  const imported = new Set(live.map((r) => (r.meta as Record<string, unknown>)?.importedFrom).filter(Boolean));
  const items: RestorePlanItem[] = data.resources.map((r) => {
    const status =
      here.has(r.id) || imported.has(r.id)
        ? "same_id"
        : r.sourceUrl && byUrl.has(`${r.type}|${urlKey(r.sourceUrl)}`)
          ? "same_url"
          : "new";
    return { id: r.id, title: r.title, type: r.type, status, defaultChoice: status === "new" ? "import" : "keep" };
  });
  return {
    items,
    counts: {
      resources: items.length,
      new: items.filter((i) => i.status === "new").length,
      conflicts: items.filter((i) => i.status !== "new").length,
      assets: data.assets.length,
      collections: data.collections.length,
      designSessions: data.designSessions.length,
    },
  };
}

/**
 * Restores a backup. New references come in with their ids. For one that is already here (same id, or the same URL),
 * the choice is: keep (default; nothing changes), new (a separate copy), or merge (fills only empty fields and adds
 * missing facets, collections, files and notes; never overwrites what you have). Running it twice adds nothing twice.
 */
export async function restoreBackup(
  dir: string,
  { conflicts = "keep", overrides = {} }: { conflicts?: RestoreChoice; overrides?: Record<string, RestoreChoice> } = {},
) {
  const { root, data } = await readBackup(dir);
  const plan = await previewRestore(dir);
  const db = await getDb();
  const summary = { imported: 0, copied: 0, merged: 0, kept: 0, files: 0, skippedFiles: 0 };

  // files first: by sha256, so a file already here is reused
  const assetMap = new Map<string, string>();
  const neededAssets = new Set(data.resourceAssets.map((r) => r.assetId));
  for (const a of data.assets) {
    if (!neededAssets.has(a.id)) continue;
    const [same] = await db.select({ id: assets.id }).from(assets).where(eq(assets.sha256, a.sha256)).limit(1);
    if (same && (await getAsset(same.id))) {
      assetMap.set(a.id, same.id);
      continue;
    }
    const bytes = await backupFile(root, a);
    if (!bytes) {
      summary.skippedFiles++;
      continue;
    }
    const saved = await saveAsset({
      data: bytes,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sourceUrl: a.sourceUrl,
      meta: a.meta,
    });
    if (a.notes) await db.update(assets).set({ notes: a.notes }).where(eq(assets.id, saved.id));
    assetMap.set(a.id, saved.id);
    summary.files++;
  }

  // facets and collections by name/id, so they are shared, not duplicated
  const tagMap = new Map<string, string>();
  for (const t of data.tags) {
    const [hit] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.kind, t.kind), eq(tags.name, t.name)))
      .limit(1);
    if (hit) tagMap.set(t.id, hit.id);
    else {
      const [row] = await db
        .insert(tags)
        .values({ kind: t.kind, name: t.name })
        .onConflictDoNothing()
        .returning({ id: tags.id });
      const id =
        row?.id ??
        (
          await db
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.kind, t.kind), eq(tags.name, t.name)))
            .limit(1)
        )[0]?.id;
      if (id) tagMap.set(t.id, id);
    }
  }
  for (const c of data.collections) {
    await db
      .insert(collections)
      .values({ ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) })
      .onConflictDoNothing();
  }

  const resourceMap = new Map<string, string>();
  for (const item of plan.items) {
    const r = data.resources.find((x) => x.id === item.id)!;
    const choice = item.status === "new" ? "import" : (overrides[item.id] ?? conflicts);
    if (choice === "keep") {
      summary.kept++;
      continue;
    }
    const fields = {
      type: r.type,
      title: r.title,
      description: r.description,
      sourceUrl: r.sourceUrl,
      notes: r.notes,
      content: r.content,
      coverAssetId: r.coverAssetId ? (assetMap.get(r.coverAssetId) ?? null) : null,
      captureStatus: r.captureStatus,
      captureQuality: r.captureQuality,
      reviewStatus: r.reviewStatus,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    };
    if (choice === "import") {
      await db
        .insert(resources)
        .values({ id: r.id, ...fields, meta: r.meta ?? {} })
        .onConflictDoNothing();
      resourceMap.set(r.id, r.id);
      summary.imported++;
    } else if (choice === "new") {
      const [already] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(sql`${resources.meta}->>'importedFrom' = ${r.id}`)
        .limit(1);
      if (already) {
        resourceMap.set(r.id, already.id);
        continue;
      }
      const [row] = await db
        .insert(resources)
        .values({ ...fields, meta: { ...(r.meta ?? {}), importedFrom: r.id } })
        .returning({ id: resources.id });
      resourceMap.set(r.id, row.id);
      summary.copied++;
    } else {
      // merge: into this very reference, or the one with the same URL
      const target =
        item.status === "same_id"
          ? (await db.select().from(resources).where(eq(resources.id, r.id)).limit(1))[0]
          : (await db.select().from(resources).where(isNull(resources.deletedAt))).find(
              (x) => x.type === r.type && x.sourceUrl && r.sourceUrl && urlKey(x.sourceUrl) === urlKey(r.sourceUrl),
            );
      if (!target) continue;
      await db
        .update(resources)
        .set({
          description: target.description || r.description,
          notes: target.notes || r.notes,
          content: target.content || r.content,
          meta: { ...(r.meta ?? {}), ...(target.meta ?? {}) },
          coverAssetId: target.coverAssetId ?? fields.coverAssetId,
        })
        .where(eq(resources.id, target.id));
      resourceMap.set(r.id, target.id);
      summary.merged++;
    }
  }

  // what hangs off the references that came in or were merged
  const mapped = (id: string) => resourceMap.get(id);
  for (const rt of data.resourceTags) {
    const rid = mapped(rt.resourceId);
    const tid = tagMap.get(rt.tagId);
    if (rid && tid) await db.insert(resourceTags).values({ resourceId: rid, tagId: tid }).onConflictDoNothing();
  }
  for (const ci of data.collectionItems) {
    const rid = mapped(ci.resourceId);
    if (rid) {
      await db
        .insert(collectionItems)
        .values({ ...ci, resourceId: rid, addedAt: new Date(ci.addedAt) })
        .onConflictDoNothing();
    }
  }
  for (const ra of data.resourceAssets) {
    const rid = mapped(ra.resourceId);
    const aid = assetMap.get(ra.assetId);
    if (!rid || !aid) continue;
    // merged references keep their own Latest and Original: what the backup adds comes in as attachments
    const merged = rid !== ra.resourceId || plan.items.find((i) => i.id === ra.resourceId)?.status !== "new";
    const role = merged && ra.role !== "attachment" && ra.role !== "state" ? "attachment" : ra.role;
    await db
      .insert(resourceAssets)
      .values({ resourceId: rid, assetId: aid, role, position: ra.position })
      .onConflictDoNothing();
  }
  for (const l of data.links) {
    const from = mapped(l.fromId);
    const to = mapped(l.toId) ?? l.toId;
    const toExists = (await db.select({ id: resources.id }).from(resources).where(eq(resources.id, to)).limit(1))
      .length;
    if (from && toExists && from !== to) {
      await db
        .insert(resourceLinks)
        .values({ ...l, id: crypto.randomUUID(), fromId: from, toId: to, createdAt: new Date(l.createdAt) })
        .onConflictDoNothing();
    }
  }
  for (const a of data.annotations) {
    const rid = mapped(a.resourceId);
    const aid = assetMap.get(a.assetId);
    if (rid && aid) {
      await db
        .insert(assetAnnotations)
        .values({ ...a, resourceId: rid, assetId: aid, createdAt: new Date(a.createdAt) })
        .onConflictDoNothing();
    }
  }
  for (const s of data.suggestions) {
    const rid = mapped(s.resourceId);
    if (rid) {
      await db
        .insert(resourceSuggestions)
        .values({ ...s, resourceId: rid, createdAt: new Date(s.createdAt), decidedAt: null })
        .onConflictDoNothing();
    }
  }
  for (const s of data.designSessions) {
    await db
      .insert(designSessions)
      .values({ ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) })
      .onConflictDoNothing();
  }
  for (const s of data.designSnapshots) {
    await db
      .insert(designSnapshots)
      .values({ ...s, createdAt: new Date(s.createdAt) })
      .onConflictDoNothing();
  }
  for (const d of data.designDecisions) {
    await db
      .insert(designDecisions)
      .values({ ...d, createdAt: new Date(d.createdAt) })
      .onConflictDoNothing();
  }
  return summary;
}
