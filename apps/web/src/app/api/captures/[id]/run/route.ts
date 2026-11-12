import { runDeferredCapture } from "@pivot/core/capture";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Starts a "capture later" request now. */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await runDeferredCapture(id)))
    throw new HttpError(409, "This request isn't waiting, or the page is already being captured.");
  return json({ ok: true });
});
