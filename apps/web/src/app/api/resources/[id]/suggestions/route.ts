import { z } from "zod";
import { addSuggestions, listSuggestions, SuggestionError } from "@pivot/core/suggestions";
import { SUGGESTION_KINDS } from "@pivot/core/types";
import { body, HttpError, json, route, type IdParams } from "@/lib/server/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  return json({ suggestions: await listSuggestions({ resourceId: id }) });
});

const input = z.object({
  suggestions: z
    .array(
      z.object({
        kind: z.enum(SUGGESTION_KINDS),
        value: z.record(z.string(), z.unknown()),
        reason: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
  source: z.string().max(60).optional(),
});

/** An agent's suggestions for this reference, kept pending until you accept them in the Inbox. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const { suggestions, source } = input.parse(await body(req));
  try {
    return json(await addSuggestions(id, suggestions, source), { status: 201 });
  } catch (err) {
    if (err instanceof SuggestionError) throw new HttpError(404, err.message);
    throw err;
  }
});
