import { startMyDesignPreviewBuild } from "@pivot/core/preview-build";
import { json, route, type IdParams } from "@/lib/server/http";

/**
 * Builds a saved design's live preview on this machine (Build preview on its page): a React design installs its npm
 * packages (exact versions, from registry.npmjs.org, install scripts off); an HTML demo is bundled and inlined. It
 * answers at once; the page follows `meta.myDesign.preview.status`. A write: same origin or the API token.
 */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { status } = await startMyDesignPreviewBuild((await params).id);
  return json({ status }, { status: 202 });
});
