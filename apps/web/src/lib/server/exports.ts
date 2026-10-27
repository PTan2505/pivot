import path from "node:path";
import { dataDir } from "@stan-bag/core/config";

// Folders this server process wrote, so "Reveal in Finder" can't be pointed at arbitrary paths.
const g = globalThis as unknown as { __stanBagExports?: Set<string> };
const exported = (g.__stanBagExports ??= new Set());

export function rememberExport(p: string) {
  exported.add(path.resolve(p));
}

export function canReveal(p: string) {
  const full = path.resolve(p);
  return exported.has(full) || full.startsWith(path.resolve(dataDir()) + path.sep);
}
