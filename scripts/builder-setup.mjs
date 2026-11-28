#!/usr/bin/env node
// `pnpm builder:setup --repo <owner>/<name>` in a checkout: the same as `pivot-studio builder setup`, with this
// checkout's builder/ files, writing PIVOT_BUILD_REPO into the checkout's .env (the one `npm start` reads).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../apps/cli/lib/args.mjs";
import { setupBuilder } from "../apps/cli/lib/builder.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
try {
  const opts = parseArgs(args[0] === "setup" ? args.slice(1) : args, "builder");
  if (opts.dataDir) throw new Error("A checkout reads its own .env: --data-dir doesn't apply here.");
  process.exitCode = await setupBuilder({
    repo: opts.repo,
    builderDir: path.join(root, "builder"),
    envFile: path.join(root, ".env"),
  });
} catch (err) {
  console.error(`› ${err.message}`);
  process.exitCode = 1;
}
