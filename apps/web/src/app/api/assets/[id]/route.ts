import {
  assetSize,
  getAsset,
  streamAsset,
  streamScrollPreview,
  streamThumbnail,
  updateAssetNotes,
} from "@pivot/core/assets";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

// Assets are user files: never let one run script on this origin (e.g. a malicious SVG opened directly).
const SAFE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=31536000, immutable",
};

/** Serves an asset from wherever it is stored (data folder or Cloudflare R2); the bucket stays private. */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const asset = await getAsset((await params).id);
  if (!asset) throw new HttpError(404, "Asset not found.");
  const sp = new URL(req.url).searchParams;

  if (sp.get("preview") === "1") {
    const preview = await streamScrollPreview(asset);
    if (preview) {
      return new Response(preview.body, {
        headers: { ...SAFE_HEADERS, "Content-Type": "image/webp", "Content-Length": String(preview.length) },
      });
    }
  }
  if (sp.get("thumb") === "1") {
    const thumb = await streamThumbnail(asset);
    if (thumb) {
      return new Response(thumb.body, {
        headers: { ...SAFE_HEADERS, "Content-Type": "image/webp", "Content-Length": String(thumb.length) },
      });
    }
  }

  const headers: Record<string, string> = { ...SAFE_HEADERS, "Content-Type": asset.mimeType, "Accept-Ranges": "bytes" };
  if (sp.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(asset.fileName)}"`;
  }

  // Range requests let <video> seek without loading the whole file.
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const size = await assetSize(asset);
    if (size === null) throw new HttpError(404, "The file for this asset is missing from storage.");
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const part = await streamAsset(asset, { start, end });
    if (!part) throw new HttpError(404, "The file for this asset is missing from storage.");
    return new Response(part.body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(part.length) },
    });
  }

  const whole = await streamAsset(asset);
  if (!whole) throw new HttpError(404, "The file for this asset is missing from storage.");
  return new Response(whole.body, { headers: { ...headers, "Content-Length": String(whole.length) } });
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { notes } = await body<{ notes?: string }>(req);
  await updateAssetNotes((await params).id, String(notes ?? "").slice(0, 5000));
  return json({ ok: true });
});
