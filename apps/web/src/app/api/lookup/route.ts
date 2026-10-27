import { normalizeUrl } from "@stan-bag/core/net-guard";
import { findByUrl } from "@stan-bag/core/resources";
import { HttpError, json, route } from "@/lib/server/http";

/** Cheap duplicate check (no page fetch) used by the extension popup. */
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) throw new HttpError(400, "Missing url.");
  let url: string;
  try {
    url = normalizeUrl(raw);
  } catch {
    return json({ duplicates: [] });
  }
  const dupes = await findByUrl(url);
  return json({ duplicates: dupes.map((d) => ({ id: d.id, title: d.title, type: d.type })) });
});
