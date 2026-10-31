import { cancelCapture, enqueueCapture, listCaptureAttempts } from "@pivot/core/capture";
import { getResource } from "@pivot/core/resources";
import { cleanCaptureSettings } from "@pivot/core/settings";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Queues a capture. The JSON body may override the capture settings: `{ expandContent?, theme? }`. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const r = await getResource(id);
  if (!r) throw new HttpError(404, "Resource not found.");
  if (!r.sourceUrl) throw new HttpError(400, "This resource has no URL to capture.");
  const options = cleanCaptureSettings(await req.json().catch(() => ({})));
  const attemptId = await enqueueCapture(id, options);
  return json({ ok: true, attemptId });
});

/** The resource's capture history, newest first. */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json({ attempts: await listCaptureAttempts(id) });
});

/** Cancels a queued, waiting or running capture; shots already saved stay. */
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json({ cancelled: await cancelCapture(id) });
});
