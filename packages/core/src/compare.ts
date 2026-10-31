import { and, desc, eq, gte, inArray } from "drizzle-orm";
import sharp from "sharp";
import { attachAsset, getAsset, readAssetBytes } from "./assets";
import { getDb } from "./db/client";
import { captureAttempts, resourceAssets, resources } from "./db/schema";
import { createLink } from "./links";
import { createResource, getResource, setResourceFields } from "./resources";
import { hostOf } from "./source-match";

export class CompareError extends Error {}

const MAX_WIDTH = 1440;
const MAX_HEIGHT = 6000;
/** A channel has to move this much for a pixel to count as changed (ignores compression noise). */
const THRESHOLD = 40;

async function load(assetId: string) {
  const row = await getAsset(assetId);
  const data = row && (await readAssetBytes(row));
  if (!row || !data) throw new CompareError("A screenshot to compare is missing.");
  return { row, data };
}

/**
 * Compares two screenshots of a reference pixel by pixel, at the same width and from the top: how much changed, and an
 * image of the second one dimmed with the changed pixels in ember. Dynamic content (dates, carousels, ads) shows up as
 * change too, so the number is a hint, not a verdict.
 */
export async function diffAssets(aId: string, bId: string) {
  const [a, b] = await Promise.all([load(aId), load(bId)]);
  const [ma, mb] = await Promise.all([sharp(a.data).metadata(), sharp(b.data).metadata()]);
  const width = Math.min(ma.width ?? MAX_WIDTH, mb.width ?? MAX_WIDTH, MAX_WIDTH);
  const scaleA = width / (ma.width ?? width);
  const scaleB = width / (mb.width ?? width);
  const height = Math.min(Math.round((ma.height ?? 0) * scaleA), Math.round((mb.height ?? 0) * scaleB), MAX_HEIGHT);
  if (height < 1) throw new CompareError("The screenshots are empty.");
  // same width, then the same top part of each
  const raw = async (data: Buffer) =>
    sharp(await sharp(data).resize({ width }).toBuffer())
      .extract({ left: 0, top: 0, width, height })
      .removeAlpha()
      .raw()
      .toBuffer();
  const [pa, pb] = await Promise.all([raw(a.data), raw(b.data)]);
  const out = Buffer.alloc(width * height * 3);
  let changed = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 3;
    const moved =
      Math.abs(pa[o] - pb[o]) > THRESHOLD ||
      Math.abs(pa[o + 1] - pb[o + 1]) > THRESHOLD ||
      Math.abs(pa[o + 2] - pb[o + 2]) > THRESHOLD;
    if (moved) {
      changed++;
      out[o] = 255;
      out[o + 1] = 106;
      out[o + 2] = 19;
    } else {
      // the newer shot, greyed and dimmed, as the background
      const grey = Math.round((pb[o] * 0.3 + pb[o + 1] * 0.59 + pb[o + 2] * 0.11) * 0.35);
      out[o] = out[o + 1] = out[o + 2] = grey;
    }
  }
  const image = await sharp(out, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const context = (meta: Record<string, unknown> | null | undefined) => ({
    capturedAt: typeof meta?.capturedAt === "string" ? meta.capturedAt : null,
    colorScheme: typeof meta?.colorScheme === "string" ? meta.colorScheme : null,
    finalUrl: typeof meta?.finalUrl === "string" ? meta.finalUrl : null,
  });
  return {
    changedRatio: changed / (width * height),
    width,
    height,
    image,
    a: { id: aId, createdAt: a.row.createdAt.toISOString(), ...context(a.row.meta) },
    b: { id: bId, createdAt: b.row.createdAt.toISOString(), ...context(b.row.meta) },
  };
}

/** Above this share of changed pixels between Original and Latest, PIVOT suggests saving a new design version. */
export const REDESIGN_HINT = 0.25;

/**
 * Saves the current Latest shots as a new reference linked "newer version of" this one, so the older design keeps its
 * own record instead of being overwritten. Only on request; nothing watches sites in the background.
 */
export async function createDesignVersion(resourceId: string) {
  const r = await getResource(resourceId);
  if (!r || r.deletedAt) throw new CompareError("No such reference.");
  const latest = r.assets.filter((a) => a.role === "screenshot" || a.role === "screenshot-full");
  if (!latest.length) throw new CompareError("There is no screenshot to save as a new version yet.");
  const month = new Date().toISOString().slice(0, 7);
  const next = await createResource({
    type: r.type,
    title: `${r.title.replace(/ \(\d{4}-\d{2}\)$/, "")} (${month})`,
    description: r.description,
    sourceUrl: r.sourceUrl,
    tags: r.tags.map((t) => ({ kind: t.kind, name: t.name })),
    meta: { versionOf: r.id },
  });
  for (const a of latest) await attachAsset(next.id, a.id, a.role);
  const cover = latest.find((a) => a.role === "screenshot") ?? latest[0];
  await setResourceFields(next.id, { coverAssetId: cover.id, captureStatus: "done" });
  await createLink({ fromId: next.id, toId: r.id, kind: "newer_version_of", origin: "user" });
  return next.id;
}

/**
 * Patterns worth a look in the capture history, without a notification for each: sites that failed three times or
 * more this week with no success since, and references whose newest capture looks wrong while an earlier one was fine.
 */
export async function captureHealth({ days = 7 } = {}) {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      attempt: captureAttempts,
      sourceUrl: resources.sourceUrl,
      title: resources.title,
      deletedAt: resources.deletedAt,
    })
    .from(captureAttempts)
    .innerJoin(resources, eq(resources.id, captureAttempts.resourceId))
    .where(
      and(gte(captureAttempts.requestedAt, since), inArray(captureAttempts.status, ["completed", "partial", "failed"])),
    )
    .orderBy(desc(captureAttempts.requestedAt));
  const byHost = new Map<string, { failures: number; lastError: string | null; succeededAfter: boolean }>();
  const byResource = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.deletedAt) continue;
    const host = hostOf(r.sourceUrl) ?? "unknown";
    const h = byHost.get(host) ?? { failures: 0, lastError: null, succeededAfter: false };
    if (r.attempt.status === "failed") {
      if (!h.succeededAfter) {
        h.failures++;
        h.lastError ??= r.attempt.error;
      }
    } else if (h.failures === 0) {
      // rows are newest first: a success before any failure means the site works now
      h.succeededAfter = true;
    }
    byHost.set(host, h);
    byResource.set(r.attempt.resourceId, [...(byResource.get(r.attempt.resourceId) ?? []), r]);
  }
  const failingSites = [...byHost.entries()]
    .filter(([, h]) => h.failures >= 3 && !h.succeededAfter)
    .map(([host, h]) => ({ host, failures: h.failures, lastError: h.lastError }));
  const regressions = [...byResource.entries()]
    .filter(([, list]) => {
      const done = list.filter((x) => x.attempt.status !== "failed");
      return (
        done[0]?.attempt.quality === "needs_review" && done.slice(1).some((x) => x.attempt.quality === "looks_good")
      );
    })
    .map(([resourceId, list]) => ({
      resourceId,
      title: list[0].title,
      reasons: list[0].attempt.qualityReasons ?? [],
    }));
  return { failingSites, regressions };
}

/** The Original and Latest viewport shots of a reference, when it has both. */
export async function originalAndLatest(resourceId: string) {
  const db = await getDb();
  const rows = await db
    .select({ assetId: resourceAssets.assetId, role: resourceAssets.role })
    .from(resourceAssets)
    .where(
      and(
        eq(resourceAssets.resourceId, resourceId),
        inArray(resourceAssets.role, ["screenshot", "screenshot-original"]),
      ),
    );
  const original = rows.find((r) => r.role === "screenshot-original")?.assetId;
  const latest = rows.find((r) => r.role === "screenshot")?.assetId;
  return original && latest ? { original, latest } : null;
}
