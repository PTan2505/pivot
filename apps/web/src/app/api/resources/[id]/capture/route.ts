import { cancelCapture, enqueueCapture, listCaptureAttempts } from "@pivot/core/capture";
import { getResource } from "@pivot/core/resources";
import { cleanCaptureOptions } from "@pivot/core/settings";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * Queues a capture. The JSON body may override the capture settings and ask for extras:
 * `{ expandContent?, theme?, viewports?: ["tablet", "mobile"], motion?, defer? }`. `defer` only records a
 * "capture later" request, which runs when you start it from the capture queue.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const r = await getResource(id);
  if (!r) throw new HttpError(404, "Resource not found.");
  if (!r.sourceUrl) throw new HttpError(400, "This resource has no URL to capture.");
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const attemptId = await enqueueCapture(id, cleanCaptureOptions(input), { defer: input.defer === true });
  return json({ ok: true, attemptId, deferred: input.defer === true });
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
