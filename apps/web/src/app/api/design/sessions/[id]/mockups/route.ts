import { z } from "zod";
import {
  DESIGN_SYSTEM_LIMITS,
  DesignError,
  getDesignSession,
  MOCKUP_LIMITS,
  saveDesignMockups,
} from "@pivot/core/design";
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
  /** The owner's feedback this round answers. */
  addressesFeedback: z.array(z.string().uuid()).max(100).optional(),
  /** A DESIGN.md change the round proposes, written into the project only after the owner approves a version. */
  designSystemChange: z
    .object({
      summary: z.string().min(1).max(DESIGN_SYSTEM_LIMITS.summary),
      markdown: z.string().min(1).max(DESIGN_SYSTEM_LIMITS.markdown),
    })
    .optional(),
});

/**
 * Saves a round of mockup versions (self-contained HTML) for a session that is exploring, with the feedback it answers
 * and the DESIGN.md change it proposes, if any. 409 once it is approved.
 */
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
