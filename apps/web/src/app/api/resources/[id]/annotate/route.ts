import { z } from "zod";
import { annotateReference, SuggestionError } from "@pivot/core/suggestions";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

/** Appends an agent's note to the reference's notes, marked and dated; your own notes are never changed. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { note } = z.object({ note: z.string().min(1).max(2000) }).parse(await body(req));
  try {
    return json({ line: await annotateReference(id, note) });
  } catch (err) {
    if (err instanceof SuggestionError) throw new HttpError(404, err.message);
    throw err;
  }
});
