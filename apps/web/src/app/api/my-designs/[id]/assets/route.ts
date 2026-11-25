import { addMyDesignAsset, MY_DESIGN_ASSET_ROLES, type MyDesignAssetRole } from "@pivot/core/my-designs";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * Adds one file to a saved design: `role` design-asset (a non-code file, with the relative `path` it goes to),
 * design-shot (a screenshot, `viewport` desktop or mobile) or design-video. A write: the app's own page or the token.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded.");
  const role = String(form.get("role") ?? "");
  if (!(MY_DESIGN_ASSET_ROLES as readonly string[]).includes(role)) {
    throw new HttpError(400, `role is one of ${MY_DESIGN_ASSET_ROLES.join(", ")}.`);
  }
  const viewport = form.get("viewport");
  const resource = await addMyDesignAsset(id, {
    data: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    role: role as MyDesignAssetRole,
    path: (form.get("path") as string | null) ?? undefined,
    viewport: viewport === "desktop" || viewport === "mobile" ? viewport : undefined,
  });
  return json(resource, { status: 201 });
});
