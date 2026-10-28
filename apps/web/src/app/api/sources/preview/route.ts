import { previewBookmarkImport } from "@pivot/core/sources";
import { body, HttpError, json, route } from "@/lib/server/http";

/** Parses an exported bookmarks file and suggests which entries are sources. Nothing is saved. */
export const POST = route(async (req: Request) => {
  const { html } = await body<{ html?: unknown }>(req);
  if (typeof html !== "string" || !html.trim()) throw new HttpError(400, "Send the bookmarks file as { html }.");
  return json(await previewBookmarkImport(html));
});
