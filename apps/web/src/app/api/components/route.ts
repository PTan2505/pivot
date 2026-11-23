import { saveComponent } from "@pivot/core/components";
import { body, json, route } from "@/lib/server/http";

/**
 * Saves a component with its code (the agent's `save_component`): right after it is fetched from 21st.dev, and again
 * once it is built. A write: the app's own page or the API token (`src/proxy.ts`).
 */
export const POST = route(async (req: Request) => {
  const { outcome, resource } = await saveComponent(await body(req));
  return json({ outcome, resource }, { status: outcome === "created" ? 201 : 200 });
});
