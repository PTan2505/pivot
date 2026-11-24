import { findMyDesign } from "@pivot/core/my-designs";
import { HttpError, json, route } from "@/lib/server/http";

/** A saved design by `id` (its PIVOT id) or `name` (exact, any case); 404 when PIVOT doesn't hold it. */
export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const found = await findMyDesign({ id: sp.get("id") ?? undefined, name: sp.get("name") ?? undefined });
  if (!found) throw new HttpError(404, "PIVOT has no saved design for that.");
  return json(found);
});
