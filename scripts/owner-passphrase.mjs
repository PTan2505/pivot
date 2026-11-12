#!/usr/bin/env node
// Sets the owner passphrase: pnpm owner:passphrase   (run it yourself, in your own terminal, in the PIVOT folder)
//
// Approving a design in PIVOT (and restoring a backup) needs this passphrase, so that only you can approve, never an
// agent that holds PIVOT's API token. It is set here, from a terminal, and never over PIVOT's HTTP API, so nothing that
// only has the API can set it first. Only a scrypt hash is stored, in PIVOT's data folder (owner-approval.json); the
// same format packages/core/src/owner-approval.ts checks.
//
//   --replace   replace a passphrase that is already set
//   --stdin     read the passphrase from standard input (one line), for scripted setups such as tests
//
// Use at least 12 characters, and a passphrase you don't use anywhere else: the hash is readable by anything that can
// read your data folder, which could then try guesses offline.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const MIN = 12;
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

// the same data folder the server uses: .env first, then PIVOT_DATA_DIR, else ~/.pivot
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
const dataDir = path.resolve((process.env.PIVOT_DATA_DIR || "~/.pivot").replace(/^~(?=$|\/)/, os.homedir()));
const file = path.join(dataDir, "owner-approval.json");

async function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // hide what is typed
  rl._writeToOutput = (s) => rl.output.write(s.startsWith(prompt) ? prompt : "");
  const answer = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function main() {
  if (fs.existsSync(file) && !args.includes("--replace")) {
    console.error(`An owner passphrase is already set (${file}). Add --replace to change it.`);
    process.exit(1);
  }
  let passphrase;
  if (args.includes("--stdin")) {
    passphrase = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  } else {
    if (!process.stdin.isTTY) {
      console.error("Run this in your own terminal (or pass --stdin for a scripted setup).");
      process.exit(1);
    }
    passphrase = await ask("New owner passphrase: ");
    if ((await ask("Again: ")) !== passphrase) {
      console.error("The two don't match. Nothing was changed.");
      process.exit(1);
    }
  }
  if (passphrase.length < MIN) {
    console.error(`Use at least ${MIN} characters. Nothing was changed.`);
    process.exit(1);
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(passphrase.normalize("NFC"), salt, SCRYPT.keylen, {
    ...SCRYPT,
    maxmem: 128 * 1024 * 1024,
  });
  fs.mkdirSync(dataDir, { recursive: true });
  const stored = {
    v: 1,
    algo: "scrypt",
    ...SCRYPT,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
    setAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
  fs.rmSync(path.join(dataDir, "owner-approval-attempts.json"), { force: true });
  console.log(`Owner passphrase set (${file}). Approving a design in PIVOT now asks for it.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
