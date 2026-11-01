import { z } from "zod";
import { isDirectProviderId, refreshCatalog } from "@pivot/core/external-search";
import { body, HttpError, json, route } from "@/lib/server/http";

const schema = z.object({ id: z.string().refine(isDirectProviderId, "unknown provider") });

/** Downloads one provider's catalog again now (at most once a minute): `{ id }`. */
export const POST = route(async (req: Request) => {
  const { id } = schema.parse(await body(req));
  try {
    return json(await refreshCatalog(id as Parameters<typeof refreshCatalog>[0]));
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "The catalog couldn't be downloaded.");
  }
});
