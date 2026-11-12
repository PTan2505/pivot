import { z } from "zod";
import { createSharePackage, ShareError } from "@pivot/core/share";
import { body, HttpError, json, route } from "@/lib/server/http";
import { rememberExport } from "@/lib/server/exports";

/** A read-only share package (a folder with an index.html) of the chosen references. */
export const POST = route(async (req: Request) => {
  const input = z
    .object({
      ids: z.array(z.string()).min(1).max(500),
      targetDir: z.string().trim().min(1).optional(),
      title: z.string().trim().min(1).max(120).optional(),
      includeNotes: z.boolean().default(false),
      includePrivate: z.boolean().default(false),
    })
    .parse(await body(req));
  try {
    const res = await createSharePackage(input.ids, input);
    rememberExport(res.path);
    return json(res, { status: 201 });
  } catch (err) {
    if (err instanceof ShareError) throw new HttpError(400, err.message);
    throw err;
  }
});
