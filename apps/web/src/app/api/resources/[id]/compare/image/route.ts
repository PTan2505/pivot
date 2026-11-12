import { CompareError, diffAssets, originalAndLatest } from "@pivot/core/compare";
import { HttpError, route, type IdParams } from "@/lib/server/http";

/** The difference image: the newer shot dimmed, changed pixels in ember. */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const pair =
    sp.get("a") && sp.get("b") ? { original: sp.get("a")!, latest: sp.get("b")! } : await originalAndLatest(id);
  if (!pair) throw new HttpError(404, "Nothing to compare.");
  try {
    const { image } = await diffAssets(pair.original, pair.latest);
    return new Response(new Uint8Array(image), {
      headers: { "content-type": "image/png", "cache-control": "private, max-age=60" },
    });
  } catch (err) {
    if (err instanceof CompareError) throw new HttpError(400, err.message);
    throw err;
  }
});
