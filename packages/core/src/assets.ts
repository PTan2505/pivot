import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { dataDir, paths } from "./config";
import { getDb } from "./db/client";
import { assets, resourceAssets, resources } from "./db/schema";
import { LocalStore, storeFor, writeStore, type StorageKind } from "./storage";
import type { AssetDTO, AssetKind, AssetRole } from "./types";

export type AssetRow = typeof assets.$inferSelect;

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  json: "application/json",
  lottie: "application/zip",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain",
  md: "text/markdown",
  css: "text/css",
  ts: "text/plain",
  tsx: "text/plain",
  js: "text/plain",
  jsx: "text/plain",
  html: "text/plain",
};

const MIME_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_MIME)
    .filter(([ext]) => !["jpeg", "ts", "tsx", "js", "jsx", "html", "lottie"].includes(ext))
    .map(([ext, mime]) => [mime, ext]),
);

export class AssetError extends Error {}

export function extensionOf(fileName: string) {
  return path.extname(fileName).slice(1).toLowerCase();
}

/** Resolve the stored MIME type from the extension; the browser-provided type is only a fallback. */
export function resolveMime(fileName: string, reported?: string): string {
  const ext = extensionOf(fileName);
  if (EXT_MIME[ext]) return EXT_MIME[ext];
  if (reported && Object.values(EXT_MIME).includes(reported)) return reported;
  throw new AssetError(`Unsupported file type: ${fileName}`);
}

function detectKind(mime: string, fileName: string, data: Buffer): AssetKind {
  if (mime === "image/svg+xml") return "svg";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("font/")) return "font";
  if (extensionOf(fileName) === "lottie") return "lottie";
  if (mime === "application/json") {
    try {
      const json = JSON.parse(data.toString("utf8"));
      if (json && typeof json === "object" && "layers" in json && "v" in json) return "lottie";
    } catch {}
    return "text";
  }
  if (mime.startsWith("text/")) return "text";
  return "other";
}

/** Absolute path of a key in the local data folder (local storage only). */
export function absoluteAssetPath(storagePath: string) {
  const full = path.resolve(dataDir(), storagePath);
  if (!full.startsWith(path.resolve(dataDir()) + path.sep)) throw new AssetError("Invalid asset path.");
  return full;
}

/** Object key of an asset's thumbnail, in the same store as the asset. */
export function thumbnailKey(assetId: string) {
  return `thumbnails/${assetId}.webp`;
}

const storeOf = (row: Pick<AssetRow, "storage">) => storeFor(row.storage as StorageKind);

export interface SaveAssetInput {
  data: Buffer;
  fileName: string;
  mimeType?: string;
  sourceUrl?: string | null;
}

/** 720px wide, and only the top 1200px of very tall (full-page) captures. */
async function makeThumbnail(img: ReturnType<typeof sharp>, width: number, height: number) {
  const scale = Math.min(1, 720 / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  let pipeline = img.clone().resize({ width: w });
  if (h > 1200) pipeline = pipeline.extract({ left: 0, top: 0, width: w, height: 1200 });
  return pipeline.webp({ quality: 78 }).toBuffer();
}

/**
 * Stores a file in the active store (Cloudflare R2 when configured, else the data folder).
 * Identical files (same sha256) are stored once.
 */
export async function saveAsset(input: SaveAssetInput) {
  if (input.data.byteLength > MAX_UPLOAD_BYTES) throw new AssetError("File is larger than 200 MB.");
  const db = await getDb();
  const mimeType = resolveMime(input.fileName, input.mimeType);
  const sha256 = crypto.createHash("sha256").update(input.data).digest("hex");

  const [existing] = await db.select().from(assets).where(eq(assets.sha256, sha256)).limit(1);
  if (existing && (await storeOf(existing).size(existing.storagePath)) !== null) return existing;

  const store = writeStore();
  const id = crypto.randomUUID();
  const ext = extensionOf(input.fileName) || MIME_EXT[mimeType] || "bin";
  const month = new Date().toISOString().slice(0, 7);
  const storagePath = path.posix.join("assets", month, `${id}.${ext}`);
  await store.put(storagePath, input.data, mimeType);

  const kind = detectKind(mimeType, input.fileName, input.data);
  let width: number | null = null;
  let height: number | null = null;
  if (kind === "image" || kind === "svg") {
    try {
      const img = sharp(input.data, { animated: false, limitInputPixels: 268_402_689 });
      const m = await img.metadata();
      width = m.width ?? null;
      height = m.height ?? null;
      if (kind === "image" && width && height) {
        await store.put(thumbnailKey(id), await makeThumbnail(img, width, height), "image/webp");
      }
    } catch {
      // Unreadable image metadata is not fatal; the original is still stored.
    }
  }

  const [row] = await db
    .insert(assets)
    .values({
      id,
      kind,
      fileName: path.basename(input.fileName),
      storagePath,
      storage: store.kind,
      mimeType,
      size: input.data.byteLength,
      width,
      height,
      sha256,
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning();
  return row;
}

export async function readAssetBytes(row: AssetRow) {
  return storeOf(row).get(row.storagePath);
}

export async function assetSize(row: AssetRow) {
  return storeOf(row).size(row.storagePath);
}

export async function streamAsset(row: AssetRow, range?: { start: number; end: number }) {
  return storeOf(row).stream(row.storagePath, range);
}

export async function streamThumbnail(row: AssetRow) {
  return storeOf(row).stream(thumbnailKey(row.id));
}

const cachePath = (row: Pick<AssetRow, "id" | "storagePath">) => path.join(paths.cache(), `${row.id}${path.extname(row.storagePath)}`);

/**
 * A path on this machine that Claude Code can open. Local files are used in place; R2 files are
 * downloaded once into the data folder's cache (pruned after a week).
 */
export async function materializeAsset(row: AssetRow): Promise<string | null> {
  if (row.storage === "local") return new LocalStore().pathOf(row.storagePath);
  const file = cachePath(row);
  const cached = await fs.stat(file).catch(() => null);
  if (cached) {
    await fs.utimes(file, new Date(), new Date()).catch(() => {});
    return file;
  }
  const bytes = await readAssetBytes(row);
  if (!bytes) return null;
  await fs.mkdir(paths.cache(), { recursive: true });
  await fs.writeFile(file, bytes);
  return file;
}

export async function pruneAssetCache(maxAgeDays = 7) {
  const dir = paths.cache();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  let removed = 0;
  for (const name of entries) {
    const file = path.join(dir, name);
    const st = await fs.stat(file).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      await fs.rm(file, { force: true });
      removed++;
    }
  }
  return removed;
}

/** Copies every locally stored asset (and thumbnail) into the active remote store, then deletes the local copies. */
export async function migrateLocalAssets(onProgress?: (done: number, total: number) => void) {
  const target = writeStore();
  if (target.kind === "local") throw new AssetError("Cloudflare R2 is not configured, so there is nowhere to move files to.");
  const db = await getDb();
  const local = new LocalStore();
  const rows = await db.select().from(assets).where(eq(assets.storage, "local"));
  let moved = 0;
  const missing: string[] = [];
  for (const row of rows) {
    const data = await local.get(row.storagePath);
    if (!data) {
      missing.push(row.fileName);
      continue;
    }
    await target.put(row.storagePath, data, row.mimeType);
    const thumb = await local.get(thumbnailKey(row.id));
    if (thumb) await target.put(thumbnailKey(row.id), thumb, "image/webp");
    await db.update(assets).set({ storage: target.kind }).where(eq(assets.id, row.id));
    await local.delete(row.storagePath);
    await local.delete(thumbnailKey(row.id));
    moved++;
    onProgress?.(moved, rows.length);
  }
  return { moved, missing, total: rows.length };
}

export async function storageSummary() {
  const db = await getDb();
  const rows = await db
    .select({ storage: assets.storage, count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${assets.size}), 0)::bigint` })
    .from(assets)
    .groupBy(assets.storage);
  return Object.fromEntries(rows.map((r) => [r.storage, { count: Number(r.count), bytes: Number(r.bytes) }])) as Partial<
    Record<StorageKind, { count: number; bytes: number }>
  >;
}

export async function attachAsset(resourceId: string, assetId: string, role: AssetRole = "attachment") {
  const db = await getDb();
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${resourceAssets.position}), -1)` })
    .from(resourceAssets)
    .where(eq(resourceAssets.resourceId, resourceId));
  await db
    .insert(resourceAssets)
    .values({ resourceId, assetId, role, position: Number(max) + 1 })
    .onConflictDoUpdate({ target: [resourceAssets.resourceId, resourceAssets.assetId], set: { role } });
}

export async function detachAsset(resourceId: string, assetId: string) {
  const db = await getDb();
  await db
    .delete(resourceAssets)
    .where(and(eq(resourceAssets.resourceId, resourceId), eq(resourceAssets.assetId, assetId)));
  await db
    .update(resources)
    .set({ coverAssetId: null })
    .where(and(eq(resources.id, resourceId), eq(resources.coverAssetId, assetId)));
  await deleteOrphanAssets([assetId]);
}

/** Deletes asset rows and files that are no longer referenced by any resource. */
export async function deleteOrphanAssets(assetIds: string[]) {
  if (assetIds.length === 0) return;
  const db = await getDb();
  const used = await db
    .select({ id: resourceAssets.assetId })
    .from(resourceAssets)
    .where(inArray(resourceAssets.assetId, assetIds));
  const usedIds = new Set(used.map((u) => u.id));
  const orphanIds = assetIds.filter((id) => !usedIds.has(id));
  if (orphanIds.length === 0) return;
  const rows = await db.delete(assets).where(inArray(assets.id, orphanIds)).returning();
  for (const row of rows) {
    const store = storeOf(row);
    await store.delete(row.storagePath).catch(() => {});
    await store.delete(thumbnailKey(row.id)).catch(() => {});
    await fs.rm(cachePath(row), { force: true });
  }
}

export async function getAsset(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return row ?? null;
}

export async function updateAssetNotes(id: string, notes: string) {
  const db = await getDb();
  await db.update(assets).set({ notes }).where(eq(assets.id, id));
}

export async function listResourceAssets(resourceId: string): Promise<AssetDTO[]> {
  const db = await getDb();
  const rows = await db
    .select({ asset: assets, role: resourceAssets.role })
    .from(resourceAssets)
    .innerJoin(assets, eq(assets.id, resourceAssets.assetId))
    .where(eq(resourceAssets.resourceId, resourceId))
    .orderBy(resourceAssets.position);
  return Promise.all(
    rows.map(async ({ asset, role }) => ({
      id: asset.id,
      kind: asset.kind as AssetKind,
      role: role as AssetRole,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      sourceUrl: asset.sourceUrl,
      notes: asset.notes,
      createdAt: asset.createdAt.toISOString(),
      // Checking R2 would cost a request per file on every page view; trust the record there.
      missing: asset.storage === "local" ? (await storeOf(asset).size(asset.storagePath)) === null : false,
    })),
  );
}
