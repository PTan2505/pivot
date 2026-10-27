import path from "node:path";
import { attachAsset, saveAsset } from "@stan-bag/core/assets";
import { createResource, setResourceFields } from "@stan-bag/core/resources";
import { isResourceType, type ResourceType } from "@stan-bag/core/types";
import { HttpError, json, route } from "@/lib/server/http";

function typeForKind(kind: string): ResourceType {
  if (kind === "svg") return "icon";
  if (kind === "lottie") return "animation";
  if (kind === "font") return "typography";
  return "media";
}

function titleFrom(fileName: string) {
  return path.parse(fileName).name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || fileName;
}

/** Creates one resource per uploaded file (paste / drop anywhere). */
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No files uploaded.");
  const forced = form.get("type");
  const created: string[] = [];
  for (const file of files) {
    const asset = await saveAsset({ data: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type });
    const type = isResourceType(forced) ? forced : typeForKind(asset.kind);
    const r = await createResource({ type, title: titleFrom(file.name) });
    await attachAsset(r.id, asset.id, "attachment");
    if (asset.kind !== "font") await setResourceFields(r.id, { coverAssetId: asset.id });
    created.push(r.id);
  }
  return json({ created }, { status: 201 });
});
