#!/usr/bin/env node
// Sets the owner passphrase: pnpm owner:passphrase   (run it yourself, in your own terminal, in the PIVOT folder)
// The same as `pivot-studio passphrase`; the rules and the stored format are in apps/cli/lib/passphrase.mjs.
//   --replace   replace a passphrase that is already set
//   --stdin     read the passphrase from standard input (one line), for scripted setups such as tests
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setPassphrase } from "../apps/cli/lib/passphrase.mjs";
import { loadEnvFile, resolveDataDir } from "../apps/cli/lib/paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

// the same data folder the server uses: .env first, then PIVOT_DATA_DIR, else ~/.pivot
loadEnvFile(path.join(root, ".env"));
setPassphrase({ dataDir: resolveDataDir(), replace: args.includes("--replace"), stdin: args.includes("--stdin") })
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
