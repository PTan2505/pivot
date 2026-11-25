import { myDesignArchive } from "@pivot/core/my-designs";
import { route, type IdParams } from "@/lib/server/http";

/** Download as zip: the design's files at their paths, byte for byte, with `_pivot/` holding its notes and screenshots. */
export const GET = route(async (_req: Request, { params }: IdParams) => {
  const { fileName, data } = await myDesignArchive((await params).id);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "no-store",
    },
  });
});
