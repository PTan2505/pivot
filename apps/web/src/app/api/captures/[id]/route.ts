import { cancelDeferredCapture } from "@pivot/core/capture";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Drops a "capture later" request. */
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await cancelDeferredCapture(id))) throw new HttpError(404, "No waiting request with this id.");
  return json({ ok: true });
});
