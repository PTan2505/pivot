import { enqueueCapture } from "@stan-bag/core/capture";
import { getResource } from "@stan-bag/core/resources";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const r = await getResource(id);
  if (!r) throw new HttpError(404, "Resource not found.");
  if (!r.sourceUrl) throw new HttpError(400, "This resource has no URL to capture.");
  await enqueueCapture(id);
  return json({ ok: true });
});
