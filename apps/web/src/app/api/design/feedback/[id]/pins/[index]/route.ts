import { pinImage } from "@pivot/core/design-feedback";
import { HttpError, route } from "@/lib/server/http";

/**
 * For an agent (MCP `get_feedback_images`): the area around one feedback pin on the version's render, with the pin's
 * number drawn on its spot. JPEG; `X-Region` gives the part of the page shown (left,top,width,height in render pixels).
 */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string; index: string }> }) => {
  const { id, index } = await params;
  const img = await pinImage(id, Number(index));
  if (!img) throw new HttpError(404, "No such pin.");
  const r = img.region;
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mimeType,
      "Content-Length": String(img.data.length),
      "X-Image-Width": String(img.width),
      "X-Image-Height": String(img.height),
      "X-Region": `${r.left},${r.top},${r.width},${r.height}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
