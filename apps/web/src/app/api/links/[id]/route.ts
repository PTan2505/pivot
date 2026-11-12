import { confirmLink, deleteLink } from "@pivot/core/links";
import { json, route, type IdParams } from "@/lib/server/http";

/** Accepts a suggested link. */
export const PATCH = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await confirmLink(id);
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  await deleteLink(id);
  return json({ ok: true });
});
