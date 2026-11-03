import { getDesignMockupHtml } from "@pivot/core/design";
import { HttpError, route, type IdParams } from "@/lib/server/http";

// Mockups are written by an agent: served sandboxed, with no scripts, no other hosts and no access to the app.
const SAFE_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, max-age=31536000, immutable",
};

/** One mockup version's HTML, for the session page's iframe or "Open alone". */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const m = await getDesignMockupHtml((await params).id);
  if (!m) throw new HttpError(404, "Mockup not found.");
  return new Response(m.html, { headers: { ...SAFE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
});
