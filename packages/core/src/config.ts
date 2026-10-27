import os from "node:os";
import path from "node:path";

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ expandHome(process.env.STAN_BAG_DATA_DIR || "~/.stan-bag"));
}

export function skillsDir(): string {
  return path.resolve(/* turbopackIgnore: true */ expandHome(process.env.CLAUDE_SKILLS_DIR || "~/.claude/skills"));
}

export function pluginsDir(): string {
  return path.resolve(/* turbopackIgnore: true */ expandHome(process.env.CLAUDE_PLUGINS_DIR || "~/.claude/plugins"));
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
  return process.env.DATABASE_URL ? "neon" : "local";
}

export { expandHome };
