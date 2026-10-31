import { deleteAnnotation, updateAnnotation } from "@pivot/core/annotations";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const updated = await updateAnnotation(id, await body(req));
  if (!updated) throw new HttpError(404, "Annotation not found.");
  return json(updated);
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await deleteAnnotation(id);
  return json({ ok: true });
});
