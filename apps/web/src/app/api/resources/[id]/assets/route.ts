import { attachAsset, deleteOrphanAssets, saveAsset } from "@pivot/core/assets";
import { replaceScreenshot } from "@pivot/core/capture";
import { getResource, setResourceFields } from "@pivot/core/resources";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

const VISUAL = new Set(["image", "svg"]);

/**
 * Upload one or more files and attach them to the resource.
 * With `as=screenshot`, one image replaces the captured screenshots and becomes the cover.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) throw new HttpError(404, "Resource not found.");
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files uploaded.");
  const asScreenshot = form.get("as") === "screenshot";
  if (asScreenshot && files.length !== 1) throw new HttpError(400, "Choose one image to use as the screenshot.");
  const saved = [];
  for (const file of files) {
    const asset = await saveAsset({
      data: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      sourceUrl: (form.get("sourceUrl") as string) || null,
    });
    if (asScreenshot) {
      if (asset.kind !== "image") {
        await deleteOrphanAssets([asset.id]);
        throw new HttpError(400, "A screenshot has to be an image (PNG, JPEG or WebP).");
      }
      await replaceScreenshot(id, asset.id);
      return json({ assetIds: [asset.id] }, { status: 201 });
    }
    await attachAsset(id, asset.id, "attachment");
    saved.push(asset);
  }
  // First visual upload becomes the cover when there is none yet.
  const firstVisual = saved.find((a) => VISUAL.has(a.kind));
  if (!resource.coverAssetId && firstVisual) await setResourceFields(id, { coverAssetId: firstVisual.id });
  return json({ assetIds: saved.map((a) => a.id) }, { status: 201 });
});
