import { z } from "zod";
import { DesignError, getDesignSession } from "@pivot/core/design";
import { selectCandidates } from "@pivot/core/design-candidates";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

const input = z.object({
  numbers: z.array(z.number().int().min(1).max(1000)).min(1).max(30),
  userWords: z.string().min(1).max(2000),
});

/** Records the user's pick of proposed references (gate 1), with their own words. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const parsed = input.parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  try {
    return json({ selected: await selectCandidates(id, parsed) });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
});
