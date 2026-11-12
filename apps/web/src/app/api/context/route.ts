import { z } from "zod";
import { buildClipboardContext } from "@pivot/core/context";
import { body, json, route } from "@/lib/server/http";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  includeFullScreenshots: z.boolean().optional(),
});

export const POST = route(async (req: Request) => {
  const { ids, includeFullScreenshots } = schema.parse(await body(req));
  return json(await buildClipboardContext(ids, { includeFullScreenshots }));
});
