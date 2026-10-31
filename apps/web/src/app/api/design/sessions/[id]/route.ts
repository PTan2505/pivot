import { z } from "zod";
import { getDesignSession, setDesignSessionStatus } from "@pivot/core/design";
import { DESIGN_STATUSES } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const s = await getDesignSession(id);
  if (!s) throw new HttpError(404, "Design session not found.");
  return json(s);
});

/** Changes a session's status (building, done, abandoned…). */
export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { status } = z.object({ status: z.enum(DESIGN_STATUSES) }).parse(await body(req));
  if (!(await getDesignSession(id))) throw new HttpError(404, "Design session not found.");
  await setDesignSessionStatus(id, status);
  return json(await getDesignSession(id));
});
