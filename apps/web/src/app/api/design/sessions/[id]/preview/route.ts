import { z } from "zod";
import { getDesignSession } from "@pivot/core/design";
import { clearPreviewPick, openPreview, previewState } from "@pivot/core/preview-launcher";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

/** The preview window's state; a pick is dropped when it no longer names a stored version with that digest. */
async function state(id: string) {
  const s = await getDesignSession(id);
  if (!s) throw new HttpError(404, "Design session not found.");
  const p = previewState(id);
  const pick =
    p.pick && s.mockups.some((m) => m.id === p.pick!.mockupId && m.digest === p.pick!.digest) ? p.pick : null;
  return { ...p, pick };
}

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json(await state(id));
});

/**
 * Opens the interactive preview of a round in its own, network-locked window (pivot:design's preview.mjs), so the
 * owner can try every version without an agent. Writes need this origin or the API token (proxy.ts), like any write.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { round } = z.object({ round: z.number().int().min(1).max(999) }).parse(await body(req));
  const s = await getDesignSession(id);
  if (!s) throw new HttpError(404, "Design session not found.");
  if (!s.mockups.some((m) => m.round === round)) throw new HttpError(404, "That round has no mockups.");
  openPreview({ sessionId: id, round, baseUrl: new URL(req.url).origin });
  return json(await state(id), { status: 202 });
});

/** Forgets the version chosen in the preview (the owner dismissed it). */
export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  clearPreviewPick(id);
  return json(await state(id));
});
