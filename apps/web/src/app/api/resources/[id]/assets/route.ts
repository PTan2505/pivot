import { attachAsset, saveAsset } from "@stan-bag/core/assets";
import { getResource, setResourceFields } from "@stan-bag/core/resources";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Upload one or more files and attach them to the resource. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const resource = await getResource(id);
  if (!resource) throw new HttpError(404, "Resource not found.");
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files uploaded.");
  const saved = [];
  for (const file of files) {
    const asset = await saveAsset({
      data: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      mimeType: file.type,
      sourceUrl: (form.get("sourceUrl") as string) || null,
    });
    await attachAsset(id, asset.id, "attachment");
    saved.push(asset.id);
  }
  // First visual upload becomes the cover when there is none yet.
  if (!resource.coverAssetId) await setResourceFields(id, { coverAssetId: saved[0] });
  return json({ assetIds: saved }, { status: 201 });
});
