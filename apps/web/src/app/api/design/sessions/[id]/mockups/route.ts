import { z } from "zod";
import { DesignError, getDesignSession, MOCKUP_LIMITS, saveDesignMockups } from "@pivot/core/design";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  snapshotId: z.string().uuid().optional(),
  mockups: z
    .array(
      z.object({
        title: z.string().min(1).max(MOCKUP_LIMITS.title),
        html: z.string().min(1),
        interactive: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(MOCKUP_LIMITS.versions),
});

/** Saves a round of mockup versions (self-contained HTML) for a session that is exploring. 409 once it is approved. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const parsed = input.parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    const saved = await saveDesignMockups({ sessionId: id, ...parsed });
    return json(saved, { status: saved.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
