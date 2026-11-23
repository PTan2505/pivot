import { findComponent } from "@pivot/core/components";
import { HttpError, json, route } from "@/lib/server/http";

/** A saved component by `id` (its 21st id), `url` (its 21st page) or `resourceId`; 404 when PIVOT doesn't hold it. */
export const GET = route(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const found = await findComponent({
    provider: sp.get("provider") ?? undefined,
    providerId: sp.get("id") ?? undefined,
    pageUrl: sp.get("url") ?? undefined,
    resourceId: sp.get("resourceId") ?? undefined,
  });
  if (!found) throw new HttpError(404, "PIVOT has no saved component for that.");
  return json(found);
});
