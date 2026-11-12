import { z } from "zod";
import { BackupError, previewRestore } from "@pivot/core/backup";
import { body, HttpError, json, route } from "@/lib/server/http";

/** What restoring a backup folder would do, before anything is written. */
export const POST = route(async (req: Request) => {
  const { dir } = z.object({ dir: z.string().trim().min(1) }).parse(await body(req));
  try {
    return json(await previewRestore(dir));
  } catch (err) {
    if (err instanceof BackupError || err instanceof SyntaxError) throw new HttpError(400, err.message);
    throw err;
  }
});
