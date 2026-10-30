import { getFavicon } from "@pivot/core/favicons";
import { route } from "@/lib/server/http";

/** A saved site's icon, by host (`?host=attio.com`). Fetched from the site the first time, then kept in storage. */
export const GET = route(async (req: Request) => {
  const icon = await getFavicon(new URL(req.url).searchParams.get("host") ?? "");
  if (!icon) {
    // cards fall back to a letter; don't ask again for an hour
    return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=3600" } });
  }
  return new Response(new Uint8Array(icon.data), {
    headers: {
      "Content-Type": icon.contentType,
      "Content-Length": String(icon.data.length),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=604800",
    },
  });
});
