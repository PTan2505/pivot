import { execFile } from "node:child_process";
import { body, HttpError, json, route } from "@/lib/server/http";
import { canReveal } from "@/lib/server/exports";

/** Shows an exported bundle (or a file in the data folder) in Finder. */
export const POST = route(async (req: Request) => {
  const { path } = await body<{ path: string }>(req);
  if (typeof path !== "string" || !canReveal(path)) throw new HttpError(403, "Only exported bundles can be revealed.");
  if (process.platform !== "darwin") throw new HttpError(400, "Reveal is only available on macOS.");
  await new Promise<void>((resolve, reject) => execFile("open", ["-R", path], (err) => (err ? reject(err) : resolve())));
  return json({ ok: true });
});
