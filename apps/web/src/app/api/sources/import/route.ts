import { enqueueCapture } from "@pivot/core/capture";
import { importBookmarks } from "@pivot/core/sources";
import { body, json, route } from "@/lib/server/http";

/** Saves the bookmarks chosen in the review list; screenshots run in the background. */
export const POST = route(async (req: Request) => {
  const result = await importBookmarks(await body(req));
  if (result.capture) for (const id of result.created) await enqueueCapture(id);
  return json({ created: result.created, skipped: result.skipped }, { status: 201 });
});
