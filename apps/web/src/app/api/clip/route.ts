import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { attachAsset, saveAsset } from "@pivot/core/assets";
import { enqueueCapture } from "@pivot/core/capture";
import { fetchUrlMetadata } from "@pivot/core/metadata";
import { normalizeUrl, safeFetch } from "@pivot/core/net-guard";
import { addToCollection, createResource, findByUrl, setResourceFields } from "@pivot/core/resources";
import { knownSourceFor } from "@pivot/core/source-match";
import { RESOURCE_TYPES, TAG_KINDS } from "@pivot/core/types";
import { HttpError, json, route } from "@/lib/server/http";

const fields = z.object({
  kind: z.enum(["page", "image", "selection"]),
  url: z.string().min(1),
  type: z.enum(RESOURCE_TYPES).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(5000).optional(),
  notes: z.string().max(100_000).optional(),
  text: z.string().max(2_000_000).optional(),
  imageUrl: z.string().optional(),
  tags: z.array(z.object({ kind: z.enum(TAG_KINDS), name: z.string().trim().min(1) })).optional(),
  collectionId: z.string().optional(),
  serverCapture: z.boolean().optional(),
  /** Page saves without a form to review (quick-save, context menu): keep the saved one instead of a duplicate. */
  ifExists: z.enum(["create", "skip"]).default("create"),
});

function hostOf(url: string) {
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * One endpoint for everything the browser extension saves:
 * - page: the current tab, optionally with the screenshot the extension took of what you see
 * - image: an image from the page (uploaded by the extension, or downloaded here from its URL)
 * - selection: selected text, saved as a snippet / prompt / rule…
 */
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const raw = form.get("data");
  if (typeof raw !== "string") throw new HttpError(400, "Missing data.");
  const input = fields.parse(JSON.parse(raw));
  const pageUrl = normalizeUrl(input.url);
  let id: string;

  if (input.kind === "page") {
    if (input.ifExists === "skip") {
      const existing = (await findByUrl(pageUrl)).find((r) => r.type === (input.type ?? "reference"));
      if (existing) {
        if (input.collectionId) await addToCollection(input.collectionId, [existing.id]);
        return json({ id: existing.id, path: `/r/${existing.id}`, existing: true, title: existing.title });
      }
    }
    let { title, description } = input;
    // A known source brings its own description (see createResource); otherwise read the page's.
    const wantsDescription = !description?.trim() && !(input.type === "source" && knownSourceFor(pageUrl));
    if (!title?.trim() || wantsDescription) {
      const meta = await fetchUrlMetadata(pageUrl).catch(() => null);
      if (!title?.trim()) title = meta?.title || hostOf(pageUrl);
      if (wantsDescription) description = meta?.description;
    }
    const r = await createResource({
      type: input.type ?? "reference",
      title,
      description: description ?? "",
      notes: input.notes ?? "",
      sourceUrl: pageUrl,
      tags: input.tags,
    });
    id = r.id;
    const shot = form.get("screenshot");
    if (shot instanceof File && shot.size > 0) {
      const webp = await sharp(Buffer.from(await shot.arrayBuffer()))
        .webp({ quality: 85 })
        .toBuffer();
      const stamp = new Date().toISOString().slice(0, 10);
      const asset = await saveAsset({
        data: webp,
        fileName: `${hostOf(pageUrl)}-${stamp}-view.webp`,
        sourceUrl: pageUrl,
      });
      await attachAsset(id, asset.id, "attachment");
      await setResourceFields(id, { coverAssetId: asset.id });
    }
    if (input.serverCapture) await enqueueCapture(id);
  } else if (input.kind === "image") {
    const upload = form.get("image");
    let data: Buffer;
    let fileName: string;
    if (upload instanceof File && upload.size > 0) {
      data = Buffer.from(await upload.arrayBuffer());
      fileName = upload.name || "image.png";
    } else if (input.imageUrl) {
      const { response, body } = await safeFetch(input.imageUrl, { accept: "image/*", maxBytes: 50 * 1024 * 1024 });
      if (!response.ok) throw new HttpError(400, `Could not download the image (${response.status}).`);
      const type = response.headers.get("content-type") ?? "";
      const ext = type.includes("svg") ? "svg" : type.split("/")[1]?.split(";")[0] || "png";
      const base = path.basename(new URL(input.imageUrl).pathname) || "image";
      fileName = path.extname(base) ? base : `${base}.${ext === "jpeg" ? "jpg" : ext}`;
      data = body;
    } else {
      throw new HttpError(400, "No image to save.");
    }
    const asset = await saveAsset({ data, fileName, sourceUrl: input.imageUrl ?? null });
    const r = await createResource({
      type: input.type ?? (asset.kind === "svg" ? "icon" : "media"),
      title: input.title?.trim() || path.parse(fileName).name.replace(/[-_]+/g, " ") || hostOf(pageUrl),
      description: input.description ?? "",
      notes: input.notes ?? "",
      sourceUrl: pageUrl,
      tags: input.tags,
    });
    id = r.id;
    await attachAsset(id, asset.id, "attachment");
    if (asset.kind === "image" || asset.kind === "svg") await setResourceFields(id, { coverAssetId: asset.id });
  } else {
    const text = input.text?.trim();
    if (!text) throw new HttpError(400, "No text selected.");
    const firstLine =
      text
        .split("\n")
        .find((l) => l.trim())
        ?.trim() ?? "Selection";
    const r = await createResource({
      type: input.type ?? "snippet",
      title: input.title?.trim() || (firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine),
      content: text,
      notes: input.notes ?? "",
      sourceUrl: pageUrl,
      tags: input.tags,
    });
    id = r.id;
  }

  if (input.collectionId) await addToCollection(input.collectionId, [id]);
  return json({ id, path: `/r/${id}` }, { status: 201 });
});
