import { z } from "zod";
import { DesignError, recordDesignDecision } from "@pivot/core/design";
import { DESIGN_DECISION_KINDS } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  kind: z.enum(DESIGN_DECISION_KINDS),
  summary: z.string().min(1).max(2000),
  direction: z.string().max(2000).optional(),
  details: z.string().max(50_000).optional(),
});

/** Records an approval, a change after approval, or a deviation found in QA. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  try {
    return json(
      { id: await recordDesignDecision({ sessionId: id, ...input.parse(await body(req)) }) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(404, err.message);
    throw err;
  }
});
