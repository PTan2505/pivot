import { z } from "zod";
import { isDirectProviderId, listDirectProviders } from "@pivot/core/external-search";
import { setProviderEnabled } from "@pivot/core/settings";
import { body, json, route } from "@/lib/server/http";

/** The direct search providers with their switch and catalog state (nothing is downloaded here). */
export const GET = route(async () => json(await listDirectProviders()));

const patch = z.object({ id: z.string().refine(isDirectProviderId, "unknown provider"), enabled: z.boolean() });

/** Turns one provider on or off: `{ id, enabled }`. */
export const PATCH = route(async (req: Request) => {
  const { id, enabled } = patch.parse(await body(req));
  await setProviderEnabled(id as Parameters<typeof setProviderEnabled>[0], enabled);
  return json(await listDirectProviders());
});
