import { z } from "zod";
import { BackupError, createBackup } from "@pivot/core/backup";
import { HttpError, json, route } from "@/lib/server/http";
import { rememberExport } from "@/lib/server/exports";

/** Writes a full portable backup folder (default: the exports folder). */
export const POST = route(async (req: Request) => {
  const { targetDir } = z
    .object({ targetDir: z.string().trim().min(1).optional() })
    .parse(await req.json().catch(() => ({})));
  try {
    const res = await createBackup({ targetDir });
    rememberExport(res.path);
    return json(res, { status: 201 });
  } catch (err) {
    if (err instanceof BackupError) throw new HttpError(400, err.message);
    throw err;
  }
});
