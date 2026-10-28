import { getResource, trashResources, updateResource } from "@pivot/core/resources";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const r = await getResource((await params).id);
  if (!r) throw new HttpError(404, "Resource not found.");
  return json(r);
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const r = await updateResource((await params).id, await body(req));
  if (!r) throw new HttpError(404, "Resource not found.");
  return json(r);
});

/** Moves to trash; permanent deletion goes through /api/resources/bulk. */
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await trashResources([(await params).id]);
  return json({ ok: true });
});
