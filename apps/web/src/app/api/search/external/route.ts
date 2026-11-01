import { z } from "zod";
import { externalSearch, ExternalSearchInputError, isDirectProviderId } from "@pivot/core/external-search";
import { SOURCE_CATEGORIES, type SourceCategory } from "@pivot/core/types";
import { HttpError, json, route } from "@/lib/server/http";

// Only the words to look for and filters: there is no field for context (a brief, notes, a project), by design.
const schema = z.object({
  q: z.string().trim().min(1).max(120),
  providers: z
    .string()
    .optional()
    .transform((v) => v?.split(",").filter(isDirectProviderId)),
  category: z.enum(SOURCE_CATEGORIES.map((c) => c.value) as [SourceCategory, ...SourceCategory[]]).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * Hybrid search, external side: real results from the free catalogs PIVOT searches directly, plus search links for the
 * other sites. Nothing is saved; the catalogs are searched on this machine.
 */
export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const input = schema.parse(Object.fromEntries(sp));
  try {
    return json(
      await externalSearch({
        query: input.q,
        providers: input.providers,
        category: input.category,
        limit: input.limit,
      }),
    );
  } catch (err) {
    if (err instanceof ExternalSearchInputError) throw new HttpError(400, err.message);
    throw err;
  }
});
