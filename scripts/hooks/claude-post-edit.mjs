#!/usr/bin/env node
// Claude Code PostToolUse hook (Edit|Write|MultiEdit): format the edited file with Prettier and,
// for apps/web sources, run ESLint --fix. Lint errors that remain are reported back to Claude
// (exit code 2 + stderr) so it fixes them in the same turn. Never blocks on tooling problems.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORMAT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md|html|ya?ml)$/i;
const LINT = /\.(ts|tsx|js|jsx|mjs)$/i;

let input = "";
for await (const chunk of process.stdin) input += chunk;
let file;
try {
  const payload = JSON.parse(input);
  file = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!file) process.exit(0);
file = path.resolve(file);
const rel = path.relative(root, file);
// Only files inside this repo that still exist (Write of a deleted path, files outside the project).
if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(file)) process.exit(0);

const run = (cmd, args, cwd = root) => spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 60_000 });

if (FORMAT.test(file)) {
  // Run from the repo root so .prettierignore applies (vendored shadcn files, migrations…).
  const r = run("pnpm", ["exec", "prettier", "--write", "--log-level", "warn", file]);
  if (r.status !== 0 && r.stderr && !/No files matching/.test(r.stderr)) {
    process.stderr.write(`Prettier could not format ${rel}:\n${r.stderr.trim()}\n`);
    process.exit(2);
  }
}

if (LINT.test(file) && rel.startsWith(`apps${path.sep}web${path.sep}`)) {
  const web = path.join(root, "apps/web");
  const r = run("pnpm", ["exec", "eslint", "--fix", "--no-warn-ignored", path.relative(web, file)], web);
  if (r.status === 1) {
    process.stderr.write(`ESLint found problems in ${rel} that need a manual fix:\n${(r.stdout || r.stderr).trim()}\n`);
    process.exit(2);
  }
}
