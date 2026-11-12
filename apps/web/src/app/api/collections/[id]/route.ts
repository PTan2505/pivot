import { deleteCollection, getCollection, updateCollection } from "@pivot/core/resources";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const c = await getCollection((await params).id);
  if (!c) throw new HttpError(404, "Collection not found.");
  return json(c);
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  await updateCollection((await params).id, await body(req));
  return json({ ok: true });
});

/** Deletes the collection only; its resources stay in the library. */
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteCollection((await params).id);
  return json({ ok: true });
});
