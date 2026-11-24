import { startComponentPreviewBuild } from "@pivot/core/preview-build";
import { json, route, type IdParams } from "@/lib/server/http";

/**
 * Builds a component's preview on this machine (Build preview on its page): it installs the component's npm packages
 * from registry.npmjs.org with install scripts off, bundles it, and stores one HTML file for the preview origin. It
 * answers at once; the page follows `meta.component.preview.status`. A write: same origin or the API token.
 */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { status } = await startComponentPreviewBuild((await params).id);
  return json({ status }, { status: 202 });
});
