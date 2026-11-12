import { z } from "zod";
import { DesignError, getDesignSession } from "@pivot/core/design";
import { addCandidates, CANDIDATE_LIMITS, listCandidates } from "@pivot/core/design-candidates";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const text = z.string().max(CANDIDATE_LIMITS.text);
const input = z.object({
  candidates: z
    .array(
      z.object({
        resourceId: z.string().uuid().optional(),
        url: z.string().url().max(2000).optional(),
        title: z.string().max(CANDIDATE_LIMITS.title).optional(),
        source: z.string().max(120).optional(),
        why: text.min(1),
        take: text.optional(),
        avoid: text.optional(),
      }),
    )
    .min(1)
    .max(CANDIDATE_LIMITS.perCall),
});

/** The references proposed for a session (gate 1), by number. */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  return json({ candidates: await listCandidates(id) });
});

/**
 * Proposes references: library ones by id, external pages by URL. PIVOT captures a preview of each external page in the
 * background (`previewStatus: "pending"` until then). External pages are not added to the library.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const parsed = input.parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    return json({ candidates: await addCandidates(id, parsed.candidates) }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
