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

/** PIVOT's pictures of a build (record-page.ts), as files. */
export interface PreviewRecording {
  desktop: Buffer;
  mobile: Buffer;
  video: Buffer;
}

const RECORDING_ROLES = ["preview-shot", "preview-video"] as const;

/**
 * Stores a preview for a component or a saved design (replacing the one it had) and records it in
 * `meta.component.preview` or `meta.myDesign.preview`. With a `recording` (added 2026-11-28), PIVOT's screenshots and
 * video of it are stored too (roles `preview-shot` and `preview-video`) and the desktop screenshot becomes the card's
 * cover unless the owner chose another; a build without one drops the pictures of the earlier build.
 */
export async function setComponentPreview(
  resourceId: string,
  html: string | Buffer,
  opts: {
    builtFrom?: string;
    runner?: PreviewState["runner"];
    recording?: PreviewRecording;
    recordError?: string;
  } = {},
) {
  const data = Buffer.isBuffer(html) ? html : Buffer.from(html, "utf8");
  if (data.byteLength > MAX_PREVIEW_BYTES) throw new PreviewError("A preview holds at most 5 MB.");
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const holder = row && previewHolder(row);
  if (!row || !holder) throw new PreviewError("No such component or design.");
  const c = holder.value;
  const asset = await saveAsset({ data, fileName: "preview.html", mimeType: "text/plain" });
  let recording: PreviewState["recording"];
  if (opts.recording) {
    const r = opts.recording;
    const [desktop, mobile, video] = [
      await saveAsset({ data: r.desktop, fileName: "preview-desktop.png", mimeType: "image/png" }),
      await saveAsset({ data: r.mobile, fileName: "preview-mobile.png", mimeType: "image/png" }),
      await saveAsset({ data: r.video, fileName: "preview.webm", mimeType: "video/webm" }),
    ];
    recording = { desktop: desktop.id, mobile: mobile.id, video: video.id };
  }
  const keep = new Set([asset.id, ...Object.values(recording ?? {})]);
  const old = await db
    .select({ assetId: resourceAssets.assetId })
    .from(resourceAssets)
    .where(
      and(
        eq(resourceAssets.resourceId, resourceId),
        inArray(resourceAssets.role, ["component-preview", ...RECORDING_ROLES]),
      ),
    );
  for (const o of old.filter((o) => !keep.has(o.assetId))) {
    await db
      .delete(resourceAssets)
      .where(and(eq(resourceAssets.resourceId, resourceId), eq(resourceAssets.assetId, o.assetId)));
  }
  await attachAsset(resourceId, asset.id, "component-preview");
  if (recording) {
    await attachAsset(resourceId, recording.desktop, "preview-shot");
    await attachAsset(resourceId, recording.mobile, "preview-shot");
    await attachAsset(resourceId, recording.video, "preview-video");
  }
  // the cover follows PIVOT's latest desktop screenshot, unless the owner picked a cover of their own
  const coverWasOurs = !row.coverAssetId || old.some((o) => o.assetId === row.coverAssetId);
  const coverAssetId = coverWasOurs ? (recording?.desktop ?? null) : row.coverAssetId;
  const preview: PreviewState = {
    status: "ready",
    assetId: asset.id,
    sha256: asset.sha256,
    builtFrom: opts.builtFrom ?? c.codeSha256,
    builtAt: new Date().toISOString(),
    ...(opts.runner ? { runner: opts.runner } : {}),
    ...(recording ? { recording } : {}),
    ...(opts.recordError ? { recordError: opts.recordError.slice(0, 600) } : {}),
  };
  await db
    .update(resources)
    .set({ meta: { ...(row.meta ?? {}), [holder.key]: { ...c, preview } }, coverAssetId })
    .where(eq(resources.id, resourceId));
  await deleteOrphanAssets(old.map((o) => o.assetId).filter((id) => !keep.has(id)));
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
