import { fetchUrlMetadata } from "@stan-bag/core/metadata";
import { normalizeUrl } from "@stan-bag/core/net-guard";
import { findByUrl } from "@stan-bag/core/resources";
import { HttpError, json, route } from "@/lib/server/http";

/** Preview for the "Add from URL" dialog. Metadata failures are reported, not thrown, so manual entry still works. */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) throw new HttpError(400, "Missing url.");
  let url: string;
  try {
    url = normalizeUrl(raw);
  } catch {
    throw new HttpError(400, "That doesn't look like a valid URL.");
  }
  const duplicates = await findByUrl(url);
  try {
    const metadata = await fetchUrlMetadata(url);
    return json({ url, metadata, duplicates, error: null });
  } catch (err) {
    return json({ url, metadata: null, duplicates, error: err instanceof Error ? err.message : "Could not fetch the page." });
  }
});
