import { saveMyDesign } from "@pivot/core/my-designs";
import { body, json, route } from "@/lib/server/http";

/**
 * Saves one of the owner's designs with its exact code (the agent's `save_my_design`), or updates the one with `id`.
 * A write: the app's own page or the API token (`src/proxy.ts`).
 */
export const POST = route(async (req: Request) => {
  const { outcome, resource } = await saveMyDesign(await body(req));
  return json({ outcome, resource }, { status: outcome === "created" ? 201 : 200 });
});
