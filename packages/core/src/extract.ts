import path from "node:path";
import { attachAsset, saveAsset } from "./assets";
import { safeFetch } from "./net-guard";
import { getResource, updateResource } from "./resources";

export class ExtractError extends Error {}

/** At most this many files per request: picking assets is selective, never a bulk download or a site copy. */
export const MAX_EXTRACT = 20;

export interface ExtractInput {
  /** Images and SVG files by URL; downloaded by the server, so only public ones work. */
  images?: { url: string }[];
  /** Inline SVG markup from the page. */
  svgs?: { markup: string; name?: string }[];
  /** Font metadata only: family, weight, style and where it is served from. No font files are downloaded. */
  fonts?: { family: string; weight?: string; style?: string; src?: string }[];
  /** CSS gradients as written on the page. */
  gradients?: string[];
}

/**
 * Saves the assets you picked from a page onto its reference: image and SVG files (each keeps the URL it came from),
 * font names (metadata, not files) and gradients (CSS text). Errors on one item don't stop the others.
 */
export async function extractAssets(resourceId: string, input: ExtractInput) {
  const r = await getResource(resourceId);
  if (!r || r.deletedAt) throw new ExtractError("No such reference.");
  const files = (input.images?.length ?? 0) + (input.svgs?.length ?? 0);
  if (files > MAX_EXTRACT) throw new ExtractError(`Pick at most ${MAX_EXTRACT} files at a time.`);
  const saved: string[] = [];
  const failed: { item: string; error: string }[] = [];

  for (const { url } of input.images ?? []) {
    try {
      const { response, body } = await safeFetch(url, { accept: "image/*", maxBytes: 20 * 1024 * 1024 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (!/^image\//.test(type)) throw new Error(`not an image (${type || "unknown type"})`);
      const base = path.basename(new URL(url).pathname) || "image";
      const ext = type.includes("svg") ? "svg" : (type.split("/")[1]?.split(";")[0] ?? "png").replace("jpeg", "jpg");
      const asset = await saveAsset({
        data: body,
        fileName: path.extname(base) ? base : `${base}.${ext}`,
        sourceUrl: url,
        meta: { extractedFrom: r.sourceUrl, extractedAt: new Date().toISOString() },
      });
      await attachAsset(resourceId, asset.id, "attachment");
      saved.push(asset.id);
    } catch (err) {
      failed.push({ item: url, error: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const [i, { markup, name }] of (input.svgs ?? []).entries()) {
    if (!/^\s*<svg[\s>]/i.test(markup) || markup.length > 500_000) {
      failed.push({ item: name ?? `svg ${i + 1}`, error: "not an inline SVG, or too big" });
      continue;
    }
    const asset = await saveAsset({
      data: Buffer.from(markup, "utf8"),
      fileName: `${(name ?? `icon-${i + 1}`).replace(/[^\w.-]+/g, "-").slice(0, 60)}.svg`,
      mimeType: "image/svg+xml",
      sourceUrl: r.sourceUrl,
      meta: { extractedFrom: r.sourceUrl, extractedAt: new Date().toISOString() },
    });
    await attachAsset(resourceId, asset.id, "attachment");
    saved.push(asset.id);
  }

  const meta: Record<string, unknown> = {};
  if (input.fonts?.length) {
    const known = (Array.isArray(r.meta.fonts) ? (r.meta.fonts as string[]) : []).map(String);
    meta.fonts = [...new Set([...known, ...input.fonts.map((f) => f.family.trim()).filter(Boolean)])];
    meta.fontSources = input.fonts.slice(0, 30);
  }
  if (input.gradients?.length) {
    const known = Array.isArray(r.meta.gradients) ? (r.meta.gradients as string[]) : [];
    meta.gradients = [...new Set([...known, ...input.gradients.map((g) => g.trim()).filter(Boolean)])].slice(0, 30);
  }
  if (Object.keys(meta).length) await updateResource(resourceId, { meta });
  return { saved, failed, fonts: input.fonts?.length ?? 0, gradients: input.gradients?.length ?? 0 };
}
