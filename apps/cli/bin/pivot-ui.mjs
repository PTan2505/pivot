#!/usr/bin/env node
// pivot-ui: run PIVOT, your local library of UI references, and the tools around it. `pivot-ui help` lists them.
import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { dist, packageVersion, resolveDataDir } from "../lib/paths.mjs";

const HELP = `pivot-ui ${packageVersion()}: your library of UI references, run locally.

Usage: pivot-ui [command] [options]

Commands
  start               Serve PIVOT on http://127.0.0.1:4321 (the default command)
  doctor              Check what this machine has and what is missing
  passphrase          Set the owner passphrase that approving a design needs (--replace to change it)
  extension           Put the Chrome extension in <data folder>/extension, ready to load unpacked
  preview <session>   Open a design session's mockups in a separate, network-locked browser window
  motion-qa <plan>    Check a build's motion against an approved plan
  help, version

Options
  --port <n>          Port (default 4321, or PORT)
  --data-dir <dir>    Data folder (default ~/.pivot, or PIVOT_DATA_DIR); settings such as DATABASE_URL
                      can go in <data folder>/.env
  --no-open           Don't open the browser when PIVOT starts`;

/** Runs one of the design skill's scripts shipped in dist/scripts, with every argument passed through. */
function runScript(name, args) {
  const child = spawn(process.execPath, [path.join(dist.scripts, `${name}.mjs`), ...args], { stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

async function main(argv) {
  if (["help", "--help", "-h"].includes(argv[0])) {
    console.log(HELP);
    return 0;
  }
  if (["version", "--version", "-v"].includes(argv[0])) {
    console.log(packageVersion());
    return 0;
  }
  // no command, or only options: start
  const [command, ...rest] = !argv[0] || argv[0].startsWith("-") ? ["start", ...argv] : argv;
  switch (command) {
    // these two take the script's own arguments
    case "preview":
    case "motion-qa":
      return runScript(command, rest);
  }
  const opts = parseArgs(rest, command);
  switch (command) {
    case "start":
      return (await import("../lib/start.mjs")).start(opts);
    case "doctor":
      return (await import("../lib/doctor.mjs")).doctor(opts);
    case "passphrase":
      return (await import("../lib/passphrase.mjs")).setPassphrase({
        dataDir: resolveDataDir(opts.dataDir),
        replace: opts.replace,
        stdin: opts.stdin,
      });
    case "extension":
      return (await import("../lib/extension.mjs")).installExtension(opts);
    default:
      throw new Error(`Unknown command ${JSON.stringify(command)}. Run pivot-ui help.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(`› ${err.message}`);
    process.exit(1);
  },
);
