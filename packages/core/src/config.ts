import os from "node:os";
import path from "node:path";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/*
 * Under the test runner (Vitest sets VITEST), PIVOT never uses the owner's real folders, database or bucket: a test that
 * forgot to point PIVOT_DATA_DIR, CLAUDE_SKILLS_DIR… at a temp folder, or that inherited a real DATABASE_URL or R2 keys
 * from the shell, fails loudly instead of touching real data. The real home comes from the account, not $HOME, which
 * tests may fake.
 */
const underTest = () => !!process.env.VITEST;
const realHome = () => os.userInfo().homedir;
function notRealInTests(resolved: string, ...real: string[]) {
  if (
    underTest() &&
    real.some((r) => resolved === path.join(realHome(), r) || resolved.startsWith(path.join(realHome(), r) + path.sep))
  )
    throw new Error(
      `Tests must not use the real ${resolved}: point the matching environment variable at a temp folder.`,
    );
  return resolved;
}
const loopback = (host: string) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
/** Under the test runner, only a loopback database or S3 endpoint (a throwaway local server) may be used. */
export function assertTestService(kind: "DATABASE_URL" | "R2_ENDPOINT", url: string | undefined) {
  if (!underTest()) return;
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {}
  if (!loopback(host)) throw new Error(`Tests must not use a real ${kind}: only a local (127.0.0.1) test server.`);
}

export function dataDir(): string {
  return notRealInTests(
    path.resolve(/* turbopackIgnore: true */ expandHome(process.env.PIVOT_DATA_DIR || "~/.pivot")),
    ".pivot",
    ".stan-bag",
  );
}

export function skillsDir(): string {
  return notRealInTests(
    path.resolve(/* turbopackIgnore: true */ expandHome(process.env.CLAUDE_SKILLS_DIR || "~/.claude/skills")),
    ".claude",
  );
}

export function pluginsDir(): string {
  return notRealInTests(
    path.resolve(/* turbopackIgnore: true */ expandHome(process.env.CLAUDE_PLUGINS_DIR || "~/.claude/plugins")),
    ".claude",
  );
}

/** Lock file written by the `skills` installer (npx skills add …): records each skill's source repo. */
export function skillLockPath(): string {
  return path.resolve(
    /* turbopackIgnore: true */ expandHome(process.env.AGENTS_SKILL_LOCK || "~/.agents/.skill-lock.json"),
  );
}

export const paths = {
  db: () => path.join(dataDir(), "db"),
  dbLock: () => path.join(dataDir(), "db.lock"),
  assets: () => path.join(dataDir(), "assets"),
  thumbnails: () => path.join(dataDir(), "thumbnails"),
  exports: () => path.join(dataDir(), "exports"),
  cache: () => path.join(dataDir(), "cache", "assets"),
};

export function databaseMode(): "neon" | "local" {
  if (process.env.DATABASE_URL) assertTestService("DATABASE_URL", process.env.DATABASE_URL);
  return process.env.DATABASE_URL ? "neon" : "local";
}

export { expandHome };
