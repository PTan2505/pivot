import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, expandHome, paths } from "./config";

/*
 * Where PIVOT may create a new export, share or backup folder. The folder is chosen by the caller, and the API token
 * (an agent's) is enough to call those routes, so a target is accepted only when it is:
 * - PIVOT's own export folder (`<data>/exports`, the dialogs' default), when that folder really is inside the data
 *   folder (not a symlink planted to lead elsewhere); or
 * - any folder that is neither in the data folder (it could shadow the database, token or owner passphrase) nor hidden
 *   (a path segment starting with "." — ~/.claude, ~/.ssh, .git/hooks…, where tools load configuration and commands).
 * The check runs on the real path, symlinks followed, and callers write into that resolved path, not the one given.
 */

export class WriteTargetError extends Error {}

/** Whether `p` is `root` or below it (path segments, never a string prefix). */
export function within(root: string, p: string) {
  const rel = path.relative(root, p);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

/** `p` with symlinks followed as far as it exists, then the rest as written (for a folder about to be created). */
export async function realish(p: string): Promise<string> {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** The real folder to create a new export, share or backup folder in; throws WriteTargetError when it isn't allowed. */
export async function resolveWriteTarget(raw: string | undefined): Promise<string> {
  const given = (raw ?? paths.exports()).trim();
  // "~" and "~/…" mean the home folder; "~name" (another user's home) is not supported, so it isn't absolute either
  if (!(given === "~" || given.startsWith("~/") || path.isAbsolute(given)))
    throw new WriteTargetError("Choose an absolute folder path.");
  const target = await realish(path.resolve(expandHome(given)));
  const data = await realish(dataDir());
  const exports = await realish(paths.exports());
  if (within(data, exports) && within(exports, target)) return target;
  if (within(data, target)) throw new WriteTargetError("Choose a folder outside PIVOT's data folder.");
  if (target.split(path.sep).some((part) => part.startsWith(".")))
    throw new WriteTargetError("Choose a folder that isn't hidden (a folder whose name starts with a dot).");
  return target;
}
