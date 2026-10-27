import { deleteTag, renameTag } from "@stan-bag/core/resources";
import { body, json, route, type IdParams } from "@/lib/server/http";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { name } = await body<{ name: string }>(req);
  await renameTag((await params).id, name);
  return json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteTag((await params).id);
  return json({ ok: true });
});
