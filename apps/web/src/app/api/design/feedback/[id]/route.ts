import { getFeedback } from "@pivot/core/design-feedback";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** One piece of the owner's feedback (MCP `get_feedback_images` reads it before fetching its pins). */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const fb = await getFeedback((await params).id);
  if (!fb) throw new HttpError(404, "No such feedback.");
  return json(fb);
});
