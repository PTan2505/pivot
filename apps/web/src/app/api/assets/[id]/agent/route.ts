import { fitForAgent, sliceForAgent } from "@pivot/core/agent-images";
import { getAsset, readAssetBytes } from "@pivot/core/assets";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * A screenshot prepared for an agent (MCP `get_reference_images`), so the MCP server needs no image library.
 * `?slices=1&from=&count=`: a full page cut into 960px-wide slices (JSON, base64 JPEG). Otherwise the image shrunk to
 * fit 1568px (JPEG, with its size in `X-Image-Width` / `X-Image-Height`).
 */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const asset = await getAsset((await params).id);
  if (!asset || !asset.mimeType.startsWith("image/")) throw new HttpError(404, "Image not found.");
  const data = await readAssetBytes(asset);
  if (!data) throw new HttpError(404, "The file for this asset is missing from storage.");
  const sp = new URL(req.url).searchParams;
  if (sp.get("slices") === "1") {
    const from = Math.max(0, Math.min(50, Number(sp.get("from")) || 0));
    const count = Math.max(1, Math.min(4, Number(sp.get("count")) || 1));
    const page = await sliceForAgent(data, from, count);
    return json({ ...page, slices: page.slices.map((s) => ({ ...s, data: s.data.toString("base64") })) });
  }
  const img = await fitForAgent(data);
  return new Response(new Uint8Array(img.data), {
    headers: {
      "Content-Type": img.mimeType,
      "Content-Length": String(img.data.length),
      "X-Image-Width": String(img.width),
      "X-Image-Height": String(img.height),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
});
