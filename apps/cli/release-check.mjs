#!/usr/bin/env node
// Which changed files end up in the npm package pivot-studio. The publish workflow uses it on a pull request into main:
// when the package's contents change but apps/cli/package.json keeps a version that is already on npm, the merge would
// publish nothing and npx users would keep running the old app, so the check fails unless the pull request carries the
// "no-npm-release" label. Not shipped in the package ("files" in package.json leaves it out).
//
// Usage: git diff --name-only <base>...<head> | node apps/cli/release-check.mjs
// Prints the changed files that are in the package, one per line (nothing when none are).
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// What build.mjs puts in the package: the web app (apps/web with packages/core), the migrations, the extension, the
// design skill's two Playwright scripts, the CLI itself, the notices, and the dependency versions.
const INCLUDED = [
  /^apps\/web\/(src|public)\//,
  /^apps\/web\/(next\.config\.ts|package\.json|tsconfig\.json)$/,
  /^packages\/core\/src\//,
  /^packages\/core\/(package\.json|tsconfig\.json)$/,
  /^apps\/extension\/(src|public|scripts)\//,
  /^apps\/extension\/[^/]+\.(html|json|ts)$/,
  /^apps\/cli\/(bin|lib)\//,
  /^apps\/cli\/(build\.mjs|package\.json|README\.md|LICENSE)$/,
  /^plugin\/skills\/design\/scripts\/(preview|motion-qa)\.mjs$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^pnpm-lock\.yaml$/,
];

// Tests sit next to the code in some folders; they never reach the package.
const EXCLUDED = [/\.test\.[cm]?[jt]sx?$/, /\/test\//, /\/__tests__\//];

/** The paths, out of `files`, whose change changes the published package. */
export function packageFiles(files) {
  return files
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => INCLUDED.some((re) => re.test(f)) && !EXCLUDED.some((re) => re.test(f)));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = packageFiles(fs.readFileSync(0, "utf8").split("\n"));
  if (changed.length) console.log(changed.join("\n"));
}
