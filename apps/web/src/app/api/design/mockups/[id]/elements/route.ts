import { DesignError } from "@pivot/core/design";
import { mockupElements } from "@pivot/core/design-feedback";
import { HttpError, json, route, type IdParams } from "@/lib/server/http";

/**
 * The element map of a version's render at `?width=` (1440, 834 or 390): every element the owner's Select tool can
 * pick, with its box on the render, its tag, id, classes, own text and a selector that finds it. Made with the render,
 * once per content and width.
 */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const q = new URL(req.url).searchParams;
  const width = Number(q.get("width") ?? 1440);
  // the viewport height `100vh` resolves against (the owner's frame), 900 when not given
  const height = Number(q.get("height") ?? 900);
  try {
    const elements = await mockupElements((await params).id, width, height);
    if (!elements) throw new HttpError(404, "Mockup not found.");
    return json({ width, elements }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    if (err instanceof DesignError) throw new HttpError(400, err.message);
    throw err;
  }
});
