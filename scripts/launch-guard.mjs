// Fail-closed checks for the normal launcher (scripts/start.mjs), kept apart so they can be tested without starting
// anything. See docs/incident-2026-11-10-real-environment.md.
import fs from "node:fs";
import path from "node:path";

/**
 * Why the normal launcher must not start, or null. A data folder that already holds PIVOT's API token but no local
 * database belongs to a library kept in Neon: starting it without DATABASE_URL (a checkout or worktree with no .env)
 * would quietly create an empty local database there and show an empty library.
 */
export function missingConfig({ dataDir, env, envFile }) {
  if (env.DATABASE_URL) return null;
  const hasToken = fs.existsSync(path.join(dataDir, "api-token"));
  const hasLocalDb = fs.existsSync(path.join(dataDir, "db"));
  if (hasToken && !hasLocalDb)
    return `${dataDir} has no local database, so your library is probably in Neon, but DATABASE_URL isn't set (no ${envFile}?). Copy your .env there, or try the app with --scratch <folder>. Nothing was started.`;
  return null;
}
