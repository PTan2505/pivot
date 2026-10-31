import { z } from "zod";
import { BackupError, restoreBackup } from "@pivot/core/backup";
import { body, HttpError, json, route } from "@/lib/server/http";

const choice = z.enum(["keep", "new", "merge"]);

/** Restores a backup folder; conflicts default to keeping what you have. */
export const POST = route(async (req: Request) => {
  const input = z
    .object({
      dir: z.string().trim().min(1),
      conflicts: choice.default("keep"),
      overrides: z.record(z.string(), choice).optional(),
    })
    .parse(await body(req));
  try {
    return json(await restoreBackup(input.dir, { conflicts: input.conflicts, overrides: input.overrides }));
  } catch (err) {
    if (err instanceof BackupError || err instanceof SyntaxError) throw new HttpError(400, err.message);
    throw err;
  }
});
