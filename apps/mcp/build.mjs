// Bundles the MCP server into one self-contained file (MCP SDK and zod included, no native modules): apps/mcp/dist
// for a hand-added server, and plugin/server for the Claude Code plugin, which ships the file as committed.
// packages/mcp-tools/test/plugin.test.ts rebuilds it in memory and fails when the committed copy is stale.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUTS = [path.join(here, "dist/server.js"), path.join(here, "../../plugin/server/server.js")];

/** The same options every time, from this folder, so the output only changes when the code does. */
export const buildOptions = {
  absWorkingDir: here,
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  legalComments: "eof",
  logLevel: "warning",
};

/** The bundle as text, without writing it. */
export async function bundle() {
  const out = await build({ ...buildOptions, write: false, outfile: "server.js" });
  return out.outputFiles[0].text;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await bundle();
  for (const file of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`Wrote ${path.relative(process.cwd(), file)} (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
  }
}
