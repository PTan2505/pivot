import { z } from "zod";
import { BackupError, restoreBackup } from "@pivot/core/backup";
import { authorizeOwner, OwnerAuthError } from "@pivot/core/owner-approval";
import { body, HttpError, json, route } from "@/lib/server/http";

const choice = z.enum(["keep", "new", "merge"]);

/**
 * Restores a backup folder; conflicts default to keeping what you have. Owner only (no API token, the owner
 * passphrase): a backup carries design approvals and statuses, so restoring one is approving by other means.
 */
export const POST = route(async (req: Request) => {
  const input = z
    .object({
      dir: z.string().trim().min(1),
      conflicts: choice.default("keep"),
      overrides: z.record(z.string(), choice).optional(),
      passphrase: z.string().max(1000).optional(),
    })
    .parse(await body(req));
  try {
    authorizeOwner({ bearer: req.headers.get("authorization"), passphrase: input.passphrase });
  } catch (err) {
    if (err instanceof OwnerAuthError) throw new HttpError(err.status, err.message);
    throw err;
  }
  try {
    return json(await restoreBackup(input.dir, { conflicts: input.conflicts, overrides: input.overrides }));
  } catch (err) {
    if (err instanceof BackupError || err instanceof SyntaxError) throw new HttpError(400, err.message);
    throw err;
  }
});
