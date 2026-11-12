import { z } from "zod";
import { isValidApiToken } from "@pivot/core/api-token";
import { DesignError, getDesignSession, setDesignSessionStatus } from "@pivot/core/design";
import { DESIGN_STATUSES } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const s = await getDesignSession(id);
  if (!s) throw new HttpError(404, "Design session not found.");
  return json(s);
});

/**
 * Changes a session's status (building, done, abandoned…). "approved" needs a recorded approval (409 otherwise). An agent
 * (a request with the API token) marks a session done only after recording its QA; the owner's own click in PIVOT
 * doesn't need one.
 */
export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { status } = z.object({ status: z.enum(DESIGN_STATUSES) }).parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  const agent = isValidApiToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  try {
    await setDesignSessionStatus(id, status, { requireQa: agent });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(409, err.message);
    throw err;
  }
  return json(await getDesignSession(id));
});
