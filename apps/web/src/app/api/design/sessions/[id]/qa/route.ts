import { z } from "zod";
import { DesignError, getDesignSession, recordDesignQa } from "@pivot/core/design";
import { DESIGN_QA_DETECTOR, DESIGN_QA_LEVELS, SPECIALIST_PHASES, SPECIALIST_RUN_LABELS } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const text = (max: number) => z.string().max(max);
const input = z.object({
  level: z.enum(DESIGN_QA_LEVELS),
  summary: text(2000),
  slopCheck: z.object({
    detector: z.object({ status: z.enum(DESIGN_QA_DETECTOR), result: text(10_000) }),
    checklist: text(10_000),
    critique: text(10_000).optional(),
  }),
  specialists: z
    .array(
      z.object({
        name: text(200),
        phase: z.enum(SPECIALIST_PHASES),
        run: z.enum(SPECIALIST_RUN_LABELS),
        outcome: text(2000),
      }),
    )
    .max(20),
  unverified: z.array(text(2000)).max(50).default([]),
});

/**
 * Records a session's QA report (the slop check, the specialist ledger, what stayed unverified) while it is building.
 * An agent needs one before it marks the session done. A refused report says what is missing (409).
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    return json({ id: await recordDesignQa(id, input.parse(await body(req))) }, { status: 201 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
