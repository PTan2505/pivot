import { z } from "zod";
import { DesignError, getDesignSession, recordDesignDecision } from "@pivot/core/design";
import { DESIGN_DECISION_KINDS } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  kind: z.enum(DESIGN_DECISION_KINDS),
  summary: z.string().min(1).max(2000),
  direction: z.string().max(2000).optional(),
  details: z.string().max(50_000).optional(),
  mockupId: z.string().max(100).optional(),
  mockupDigest: z
    .string()
    .regex(/^[0-9a-f]{12,64}$/i)
    .optional(),
});

/**
 * Records an approval, a change after approval, or a deviation found in QA. 404 only for an unknown session; a refused
 * decision (an approval without its version, a stale digest…) is a 409 with the reason, so the agent can act on it.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    return json(
      { id: await recordDesignDecision({ sessionId: id, ...input.parse(await body(req)) }) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
