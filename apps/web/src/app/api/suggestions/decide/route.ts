import { z } from "zod";
import { decideSuggestions } from "@pivot/core/suggestions";
import { body, json, route } from "@/lib/server/http";

/** Accepts (applies) or rejects suggestions, several at once. */
export const POST = route(async (req: Request) => {
  const { ids, accept } = z
    .object({ ids: z.array(z.string()).min(1).max(500), accept: z.boolean() })
    .parse(await body(req));
  return json({ decided: await decideSuggestions(ids, accept) });
});
