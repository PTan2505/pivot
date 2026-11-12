import { candidatePreview } from "@pivot/core/design-candidates";
import { HttpError, route, type IdParams } from "@/lib/server/http";

/** PIVOT's own capture of an external reference proposed for a session (a WebP image). */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const image = await candidatePreview((await params).id);
  if (!image) throw new HttpError(404, "No preview.");
  return new Response(new Uint8Array(image), {
    headers: {
      "content-type": "image/webp",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
});
