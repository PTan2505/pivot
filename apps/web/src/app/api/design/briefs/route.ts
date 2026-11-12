import { z } from "zod";
import { DesignError, saveDesignBrief } from "@pivot/core/design";
import { DESIGN_MILESTONES } from "@pivot/core/types";
import { body, HttpError, json, route } from "@/lib/server/http";

const input = z.object({
  sessionId: z.string().optional(),
  title: z.string().max(200),
  targetProject: z.string().max(200).optional(),
  surface: z.string().max(200).optional(),
  milestone: z.enum(DESIGN_MILESTONES),
  markdown: z.string().min(1).max(200_000),
  referenceIds: z.array(z.string()).max(50).optional(),
  note: z.string().max(2000).optional(),
});

/** Saves a brief snapshot; the first complete brief opens a design session. */
export const POST = route(async (req: Request) => {
  try {
    const res = await saveDesignBrief(input.parse(await body(req)));
    return json(res, { status: res.duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(400, err.message);
    throw err;
  }
});
