import { CompareError, diffAssets, originalAndLatest, REDESIGN_HINT } from "@pivot/core/compare";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/** How much changed between two screenshots (Original and Latest by default), with each one's capture context. */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const pair =
    sp.get("a") && sp.get("b") ? { original: sp.get("a")!, latest: sp.get("b")! } : await originalAndLatest(id);
  if (!pair) throw new HttpError(404, "This reference has no Original and Latest to compare yet.");
  try {
    const diff = await diffAssets(pair.original, pair.latest);
    return json({
      changedRatio: diff.changedRatio,
      width: diff.width,
      height: diff.height,
      a: diff.a,
      b: diff.b,
      redesignHint: diff.changedRatio >= REDESIGN_HINT,
    });
  } catch (err) {
    if (err instanceof CompareError) throw new HttpError(400, err.message);
    throw err;
  }
});
