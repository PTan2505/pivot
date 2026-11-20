import { DesignError } from "@pivot/core/design";
import { renderMockup } from "@pivot/core/design-feedback";
import { HttpError, route, type IdParams } from "@/lib/server/http";

/**
 * A version's full-page render at `?width=` (1440, 834 or 390), JavaScript off, as JPEG with its size in
 * `X-Image-Width` / `X-Image-Height`: what the owner places feedback pins on. Made once per content and width.
 */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const width = Number(new URL(req.url).searchParams.get("width") ?? 1440);
  try {
    const img = await renderMockup((await params).id, width);
    if (!img) throw new HttpError(404, "Mockup not found.");
    return new Response(new Uint8Array(img.data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(img.data.length),
        "X-Image-Width": String(img.width),
        "X-Image-Height": String(img.height),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(400, err.message);
    throw err;
  }
});
