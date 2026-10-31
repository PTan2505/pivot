import { normalizeUrl } from "@pivot/core/net-guard";
import { checkVisibility, looksLikeAppUrl } from "@pivot/core/visibility";
import { HttpError, json, route } from "@/lib/server/http";

/**
 * Guesses whether a page is private by asking for it without cookies. The extension uses it, with what it sees in the
 * tab, to decide whether a screenshot needs your approval before upload.
 */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) throw new HttpError(400, "Missing url.");
  let url: string;
  try {
    url = normalizeUrl(raw);
  } catch {
    throw new HttpError(400, "Not a URL.");
  }
  return json({ ...(await checkVisibility(url)), appUrl: looksLikeAppUrl(url) });
});
