import { z } from "zod";
import { exportBundle } from "@stan-bag/core/context";
import { body, json, route } from "@/lib/server/http";
import { rememberExport } from "@/lib/server/exports";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  targetDir: z.string().trim().min(1),
  bundleName: z.string().trim().min(1).max(80),
  resizeImages: z.boolean().default(true),
  includeFullScreenshots: z.boolean().default(true),
});

export const POST = route(async (req: Request) => {
  const input = schema.parse(await body(req));
  const result = await exportBundle({ ...input, resourceIds: input.ids });
  rememberExport(result.path);
  return json(result);
});
