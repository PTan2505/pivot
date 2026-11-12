import { normalizeUrl } from "@pivot/core/net-guard";
import { findByUrl } from "@pivot/core/resources";
import { HttpError, json, route } from "@/lib/server/http";

/**
 * Cheap duplicate check (no page fetch) used by the extension popup: the newest 3 saves of the same page, with a
 * thumbnail when they have a cover, and how many there are in all.
 */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) throw new HttpError(400, "Missing url.");
  let url: string;
  try {
    url = normalizeUrl(raw);
  } catch {
    return json({ duplicates: [], total: 0 });
  }
  const dupes = (await findByUrl(url)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({
    total: dupes.length,
    duplicates: dupes.slice(0, 3).map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      createdAt: d.createdAt,
      thumbnail: d.coverAssetId ? `/api/assets/${d.coverAssetId}?thumb=1` : null,
    })),
  });
});
