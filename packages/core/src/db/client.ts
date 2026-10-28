import fs from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { dataDir, databaseMode, paths } from "../config";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbState {
  promise?: Promise<DB>;
  close?: () => Promise<void>;
}

// Survive Next.js dev hot reloads: one connection per process.
const g = globalThis as unknown as { __pivotDb?: DbState };
const state: DbState = (g.__pivotDb ??= {});

function findMigrationsDir(): string {
  if (process.env.PIVOT_MIGRATIONS_DIR) return process.env.PIVOT_MIGRATIONS_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "packages/core/src/db/migrations");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate packages/core/src/db/migrations. Set PIVOT_MIGRATIONS_DIR.");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PGlite must only be opened by one process at a time, or the data directory can be corrupted. */
function acquireLocalLock() {
  const lock = paths.dbLock();
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, "utf8").trim());
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw new Error(
        `The local database is already open in another PIVOT process (pid ${pid}). Stop it before starting a new one.`,
      );
    }
  }
  fs.writeFileSync(lock, String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(lock, "utf8").trim() === String(process.pid)) fs.unlinkSync(lock);
    } catch {}
  };
  process.once("exit", release);
}

async function open(): Promise<DB> {
  fs.mkdirSync(dataDir(), { recursive: true });
  const migrationsFolder = findMigrationsDir();

  if (databaseMode() === "neon") {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // postgres.js negotiates SCRAM itself and would forward unknown URL params to the server as settings.
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.delete("channel_binding");
    const client = postgres(url.toString(), { max: 5, onnotice: () => {} });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    state.close = () => client.end();
    return db as unknown as DB;
  }

  acquireLocalLock();
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(paths.db());
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  state.close = () => client.close();
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!state.promise) {
    state.promise = open().catch((err) => {
      state.promise = undefined;
      throw err;
    });
  }
  return state.promise;
}

export async function closeDb() {
  await state.close?.();
  state.promise = undefined;
  state.close = undefined;
}

export { schema };
