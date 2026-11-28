import { saveComponent } from "@pivot/core/components";
import { autoBuildComponent } from "@pivot/core/preview-build";
import { getResource } from "@pivot/core/resources";
import { body, json, route } from "@/lib/server/http";

/**
 * Saves a component with its code (the agent's `save_component`): right after it is fetched from 21st.dev, and again
 * once it is built. A save that brings code with no build yet starts its preview build (in the cloud when it is set
 * up); `build` says whether it did. A write: the app's own page or the API token (`src/proxy.ts`).
 */
export const POST = route(async (req: Request) => {
  const saved = await saveComponent(await body(req));
  let build: "started" | "skipped" = "skipped";
  if (saved.outcome !== "unchanged") {
    // the save stands even when its build can't start; a failed start is recorded on the component
    build = await autoBuildComponent(saved.resource.id).catch((err) => {
      console.error("[pivot] the preview build after a save didn't start:", err instanceof Error ? err.message : err);
      return "skipped" as const;
    });
  }
  const resource = build === "started" ? ((await getResource(saved.resource.id)) ?? saved.resource) : saved.resource;
  return json({ outcome: saved.outcome, resource, build }, { status: saved.outcome === "created" ? 201 : 200 });
});
