import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { attachAsset, saveAsset, updateAssetNotes } from "@pivot/core/assets";
import { enqueueCapture } from "@pivot/core/capture";
import {
  claimClipRequest,
  ClipInProgressError,
  completeClipRequest,
  releaseClipRequest,
} from "@pivot/core/clip-requests";
import { fetchUrlMetadata } from "@pivot/core/metadata";
import { normalizeUrl, safeFetch } from "@pivot/core/net-guard";
import { addToCollection, createResource, findByUrl, getResource, setResourceFields } from "@pivot/core/resources";
import { autoLinkSamePage } from "@pivot/core/links";
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
  /** Several collections at once; `collectionId` still works. */
  collectionIds: z.array(z.string()).max(50).optional(),
  /** Quick saves land in the Inbox ("needs review") so they get organised later. */
  needsReview: z.boolean().optional(),
  /** A section of the page (hero, pricing…) saved as its own reference, with where it sat on the page. */
  section: z
    .object({
      type: z.string().trim().min(1).max(60),
      rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
      viewport: z.object({ width: z.number(), height: z.number() }),
      scrollY: z.number().optional(),
      /** Only a hint for finding it again: pages change. */
      selector: z.string().max(500).optional(),
      pageTitle: z.string().max(300).optional(),
      method: z.enum(["select", "crop", "list"]).optional(),
    })
    .optional(),
  /**
   * An interaction state (hover, open menu, error…) of a page already saved: the screenshot is added to that reference
   * as a `state` named here, instead of creating a new reference.
   */
  attachTo: z.string().optional(),
  /** The page looked private and its screenshot was approved (and masked) before upload: kept out of share packages. */
  privatePage: z.boolean().optional(),
  state: z.string().trim().min(1).max(60).optional(),
  /** The address bar's URL when the saved `url` is the page's canonical link (provenance: "Captured from"). */
  capturedUrl: z.string().max(2000).optional(),
  serverCapture: z.boolean().optional(),
  /** Let the server capture click "Load more" buttons; off unless asked for. */
  expandContent: z.boolean().optional(),
  /** Page saves without a form to review (quick-save, context menu): keep the saved one instead of a duplicate. */
  ifExists: z.enum(["create", "skip"]).default("create"),
  /**
   * Set by the extension's offline queue. Sending the same id again (after a lost answer) returns what the first
   * request saved instead of saving twice.
   */
  clientRequestId: z.string().uuid().optional(),
});

type ClipInput = z.infer<typeof fields>;
type Saved = { id: string; existing?: boolean; title?: string };

function collectionsOf(input: ClipInput) {
  return [...new Set([...(input.collectionIds ?? []), ...(input.collectionId ? [input.collectionId] : [])])];
}

/** Provenance: where the page was actually open when saved, when that differs from the URL it is saved under. */
function capturedFrom(input: ClipInput, pageUrl: string) {
  if (!input.capturedUrl) return undefined;
  try {
    const captured = normalizeUrl(input.capturedUrl);
    return captured !== pageUrl ? { capturedUrl: captured } : undefined;
  } catch {
    return undefined;
  }
}

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
  const requestId = input.clientRequestId;
  if (!requestId) return respond(await save(form, input));

  let earlier: string | null;
  try {
    earlier = await claimClipRequest(requestId);
  } catch (err) {
    if (err instanceof ClipInProgressError) throw new HttpError(409, err.message);
    throw err;
  }
  if (earlier) {
    const r = await getResource(earlier);
    return json({ id: earlier, path: `/r/${earlier}`, title: r?.title, replayed: true });
  }
  try {
    const saved = await save(form, input);
    await completeClipRequest(requestId, saved.id);
    return respond(saved);
  } catch (err) {
    await releaseClipRequest(requestId).catch(() => {});
    throw err;
  }
});

function respond({ id, existing, title }: Saved) {
  if (existing) return json({ id, path: `/r/${id}`, existing: true, title });
  return json({ id, path: `/r/${id}`, title }, { status: 201 });
}

async function save(form: FormData, input: ClipInput): Promise<Saved> {
  if (input.attachTo) return saveState(form, input);
  const pageUrl = normalizeUrl(input.url);
  let id: string;
  let title: string | undefined;

  if (input.kind === "page") {
    if (input.ifExists === "skip") {
      const existing = (await findByUrl(pageUrl)).find((r) => r.type === (input.type ?? "reference"));
      if (existing) {
        for (const c of collectionsOf(input)) await addToCollection(c, [existing.id]);
        return { id: existing.id, existing: true, title: existing.title };
      }
    }
    let { description } = input;
    title = input.title;
    // A section is named "[Section] — [Source]"; the page's own title stays in meta.section.pageTitle.
    if (input.section && !title?.trim()) {
      title = `${input.section.type} — ${knownSourceFor(pageUrl)?.name ?? hostOf(pageUrl)}`;
    }
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
      reviewStatus: input.needsReview ? "needs_review" : null,
      meta: {
        ...capturedFrom(input, pageUrl),
        ...(input.section ? { section: input.section } : {}),
        ...(input.privatePage ? { privatePage: true } : {}),
      },
    });
    id = r.id;
    title = r.title;
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
    if (input.serverCapture) await enqueueCapture(id, { expandContent: input.expandContent });
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
      reviewStatus: input.needsReview ? "needs_review" : null,
    });
    id = r.id;
    title = r.title;
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
      reviewStatus: input.needsReview ? "needs_review" : null,
    });
    id = r.id;
    title = r.title;
  }

  for (const c of collectionsOf(input)) await addToCollection(c, [id]);
  // Same page saved before (or a section of it): link them. Never fails the save.
  if (input.kind === "page") await autoLinkSamePage(id).catch(() => 0);
  return { id, title };
}

/** Adds the tab's screenshot to an existing reference as one of its interaction states. */
async function saveState(form: FormData, input: ClipInput): Promise<Saved> {
  const r = await getResource(input.attachTo!);
  if (!r || r.deletedAt) throw new HttpError(404, "The reference to add this state to is gone.");
  const shot = form.get("screenshot");
  if (!(shot instanceof File) || shot.size === 0) throw new HttpError(400, "A state needs the tab's screenshot.");
  const webp = await sharp(Buffer.from(await shot.arrayBuffer()))
    .webp({ quality: 85 })
    .toBuffer();
  const state = input.state ?? "State";
  const asset = await saveAsset({
    data: webp,
    fileName: `${hostOf(normalizeUrl(input.url))}-${state.toLowerCase().replace(/[^\w]+/g, "-")}.webp`,
    sourceUrl: normalizeUrl(input.url),
    meta: {
      state,
      method: "extension",
      capturedAt: new Date().toISOString(),
      ...capturedFrom(input, normalizeUrl(input.url)),
    },
  });
  await attachAsset(r.id, asset.id, "state");
  // a note about this state goes on the screenshot, not over the reference's own notes
  if (input.notes?.trim()) await updateAssetNotes(asset.id, input.notes.trim());
  return { id: r.id, title: r.title };
}
