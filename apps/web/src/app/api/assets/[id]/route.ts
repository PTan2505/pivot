import fs from "node:fs";
import { Readable } from "node:stream";
import { absoluteAssetPath, getAsset, thumbnailPath, updateAssetNotes } from "@stan-bag/core/assets";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

// Assets are user files: never let one run script on this origin (e.g. a malicious SVG opened directly).
const SAFE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, max-age=31536000, immutable",
};

function stream(path: string, start?: number, end?: number) {
  return Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream;
}

export const GET = route(async (req: Request, { params }: IdParams) => {
  const asset = await getAsset((await params).id);
  if (!asset) throw new HttpError(404, "Asset not found.");
  const sp = new URL(req.url).searchParams;

  if (sp.get("thumb") === "1" && fs.existsSync(thumbnailPath(asset.id))) {
    return new Response(stream(thumbnailPath(asset.id)), { headers: { ...SAFE_HEADERS, "Content-Type": "image/webp" } });
  }

  const file = absoluteAssetPath(asset.storagePath);
  if (!fs.existsSync(file)) throw new HttpError(404, "The file for this asset is missing on disk.");
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    ...SAFE_HEADERS,
    "Content-Type": asset.mimeType,
    "Accept-Ranges": "bytes",
  };
  if (sp.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(asset.fileName)}"`;
  }

  // Range requests let <video> seek without loading the whole file.
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(stream(file, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(stream(file), { headers: { ...headers, "Content-Length": String(size) } });
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { notes } = await body<{ notes?: string }>(req);
  await updateAssetNotes((await params).id, String(notes ?? "").slice(0, 5000));
  return json({ ok: true });
});
