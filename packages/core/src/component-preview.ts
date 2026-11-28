// A component's or a saved design's preview (docs/component-store-plan.md, Phases 4–5; docs/my-designs-plan.md,
// Phase 3): one self-contained HTML file, stored as an asset with role `component-preview` and served only from the
// preview origin (preview-server.ts). The file is stored as text/plain, so PIVOT's own asset route never serves it as a
// page.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { attachAsset, deleteOrphanAssets, saveAsset, type AssetRow } from "./assets";
import { componentOf } from "./components";
import { getDb } from "./db/client";
import { MAX_PAGE_BYTES } from "./build-page";
import { PreviewError } from "./preview-error";
import { assets, resourceAssets, resources } from "./db/schema";
import type { PreviewState } from "./types";

/** The resource types that can have a preview, and where each keeps its state in `meta`. */
export const PREVIEW_META_KEY = { component: "component", my_design: "myDesign" } as const;
export type PreviewType = keyof typeof PREVIEW_META_KEY;

/** The part of `meta` holding the preview state (`meta.component` or `meta.myDesign`), or null. */
export function previewHolder(row: { type: string; meta: Record<string, unknown> | null }) {
  const key = PREVIEW_META_KEY[row.type as PreviewType];
  if (!key) return null;
  if (row.type === "component") {
    const c = componentOf(row as { meta: Record<string, unknown> });
    return c ? { key, value: c as { preview?: PreviewState; codeSha256: string } } : null;
  }
  const v = row.meta?.[key] as { preview?: PreviewState; codeSha256: string } | undefined;
  return v ? { key, value: v } : null;
}

/** At most this big: a bundle with React and compiled CSS inlined is a few hundred KB. */
export const MAX_PREVIEW_BYTES = MAX_PAGE_BYTES;

export { PreviewError };

/**
 * Stores a preview for a component or a saved design (replacing the one it had) and records it in
 * `meta.component.preview` or `meta.myDesign.preview`.
 */
export async function setComponentPreview(
  resourceId: string,
  html: string | Buffer,
  opts: { builtFrom?: string; runner?: PreviewState["runner"] } = {},
) {
  const data = Buffer.isBuffer(html) ? html : Buffer.from(html, "utf8");
  if (data.byteLength > MAX_PREVIEW_BYTES) throw new PreviewError("A preview holds at most 5 MB.");
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const holder = row && previewHolder(row);
  if (!row || !holder) throw new PreviewError("No such component or design.");
  const c = holder.value;
  const asset = await saveAsset({ data, fileName: "preview.html", mimeType: "text/plain" });
  const old = await db
    .select({ assetId: resourceAssets.assetId })
    .from(resourceAssets)
    .where(and(eq(resourceAssets.resourceId, resourceId), eq(resourceAssets.role, "component-preview")));
  for (const o of old.filter((o) => o.assetId !== asset.id)) {
    await db
      .delete(resourceAssets)
      .where(and(eq(resourceAssets.resourceId, resourceId), eq(resourceAssets.assetId, o.assetId)));
  }
  await attachAsset(resourceId, asset.id, "component-preview");
  await deleteOrphanAssets(old.map((o) => o.assetId).filter((id) => id !== asset.id));
  const preview: PreviewState = {
    status: "ready",
    assetId: asset.id,
    sha256: asset.sha256,
    builtFrom: opts.builtFrom ?? c.codeSha256,
    builtAt: new Date().toISOString(),
    ...(opts.runner ? { runner: opts.runner } : {}),
  };
  await db
    .update(resources)
    .set({ meta: { ...(row.meta ?? {}), [holder.key]: { ...c, preview } } })
    .where(eq(resources.id, resourceId));
  return preview;
}

/**
 * The asset behind `/p/<sha256>.html`: only a file attached with role `component-preview` to a component or a saved
 * design that isn't in the Trash. Anything else, even a file with that hash under another role, is not served.
 */
export async function findPreviewAsset(sha256: string): Promise<AssetRow | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const db = await getDb();
  const [row] = await db
    .select({ asset: assets })
    .from(assets)
    .innerJoin(resourceAssets, eq(resourceAssets.assetId, assets.id))
    .innerJoin(resources, eq(resources.id, resourceAssets.resourceId))
    .where(
      and(
        eq(assets.sha256, sha256),
        eq(resourceAssets.role, "component-preview"),
        inArray(resources.type, Object.keys(PREVIEW_META_KEY)),
        isNull(resources.deletedAt),
      ),
    )
    .limit(1);
  return row?.asset ?? null;
}
