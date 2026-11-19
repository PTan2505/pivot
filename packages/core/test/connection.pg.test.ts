// A pooled connection that died while idle (a laptop that slept, a network change, a suspended Neon compute): the
// client doesn't know until its next query, which then fails with ECONNRESET. Shown against a real PostgreSQL server
// through a proxy that can play dead, plus the pure rules. The server part is skipped when no PostgreSQL binaries are
// found (PG_BIN, PATH, or Homebrew's postgresql@*).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isConnectionError, NEON_POOL, retryOnConnectionError } from "../src/db/connection";

describe("connection errors", () => {
  it("knows a broken connection from a failed query, through Drizzle's wrapping", () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    expect(isConnectionError(reset)).toBe(true);
    expect(isConnectionError(new Error("Failed query: select 1", { cause: reset }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error("closed"), { code: "CONNECTION_CLOSED" }))).toBe(true);
    // the query was wrong, or the server is down: running it again won't help
    expect(isConnectionError(Object.assign(new Error("syntax error"), { code: "42601" }))).toBe(false);
    expect(isConnectionError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isConnectionError(new Error("no code"))).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  it("runs the work again on a broken connection, at most `retries` more times, and never on other errors", async () => {
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    let calls = 0;
    const onRetry = vi.fn();
    expect(
      await retryOnConnectionError(
        async () => {
          if (calls++ === 0) throw new Error("Failed query", { cause: reset });
          return "ok";
        },
        { onRetry },
      ),
    ).toBe("ok");
    expect([calls, onRetry.mock.calls.length]).toEqual([2, 1]);

    calls = 0;
    await expect(
      retryOnConnectionError(
        async () => {
          calls++;
          throw reset;
        },
        { retries: 2 },
      ),
    ).rejects.toBe(reset);
    expect(calls).toBe(3);

    // by default one try per pooled connection
    calls = 0;
    await expect(
      retryOnConnectionError(async () => {
        calls++;
        throw reset;
      }),
    ).rejects.toBe(reset);
    expect(calls).toBe(NEON_POOL.max + 1);

    calls = 0;
    const wrong = Object.assign(new Error("syntax error"), { code: "42601" });
    await expect(
      retryOnConnectionError(async () => {
        calls++;
        throw wrong;
      }),
    ).rejects.toBe(wrong);
    expect(calls).toBe(1);
  });

  it("closes idle connections and replaces old ones in the Neon pool", () => {
    expect(NEON_POOL.idle_timeout).toBeGreaterThan(0);
    expect(NEON_POOL.idle_timeout).toBeLessThanOrEqual(60);
    expect(NEON_POOL.max_lifetime).toBeGreaterThan(NEON_POOL.idle_timeout);
  });
});

function pgBin() {
  const candidates = [process.env.PG_BIN];
  try {
    candidates.push(path.dirname(execFileSync("which", ["initdb"], { encoding: "utf8" }).trim()));
  } catch {}
  for (const root of ["/opt/homebrew/opt", "/usr/local/opt"])
    if (fs.existsSync(root))
      for (const d of fs
        .readdirSync(root)
        .filter((n) => /^postgresql(@\d+)?$/.test(n))
        .sort()
        .reverse())
        candidates.push(path.join(root, d, "bin"));
  return candidates.find((d) => d && fs.existsSync(path.join(d, "initdb")) && fs.existsSync(path.join(d, "pg_ctl")));
}
const bin = pgBin();

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };

/**
 * A TCP proxy in front of PostgreSQL. `sleep()` makes every open connection dead without telling the client (as after
 * a laptop's sleep): the next bytes the client sends get a reset. New connections work normally.
 */
async function deadableProxy(target: number) {
  const dead = new WeakSet<net.Socket>();
  const open = new Set<net.Socket>();
  const server = net.createServer((client) => {
    open.add(client);
    const upstream = net.connect(target, "127.0.0.1");
    client.on("data", (chunk) => {
      if (dead.has(client)) {
        upstream.destroy();
        client.resetAndDestroy();
      } else upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      if (!dead.has(client)) client.write(chunk);
    });
    const end = () => {
      open.delete(client);
      client.destroy();
      upstream.destroy();
    };
    client.on("close", end);
    client.on("error", end);
    upstream.on("error", end);
  });
  const port = await freePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    port,
    connections: () => open.size,
    sleep: () => open.forEach((s) => dead.add(s)),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe.skipIf(!bin)("a connection that died while idle (real PostgreSQL)", () => {
  let tmp: string;
  let proxy: Awaited<ReturnType<typeof deadableProxy>>;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-pg-conn-"));
    const data = path.join(tmp, "pg");
    execFileSync(
      path.join(bin!, "initdb"),
      ["-D", data, "-U", "pivot", "-A", "trust", "-E", "UTF8", "--no-locale", "--no-sync"],
      { stdio: "ignore", env: pgEnv },
    );
    const port = await freePort();
    execFileSync(
      path.join(bin!, "pg_ctl"),
      [
        "-D",
        data,
        "-l",
        path.join(tmp, "pg.log"),
        "-w",
        "-o",
        `-p ${port} -c listen_addresses=127.0.0.1 -k ${tmp}`,
        "start",
      ],
      { stdio: "ignore", env: pgEnv },
    );
    proxy = await deadableProxy(port);
  }, 60_000);

  // a fresh pool for each case, with the app's own settings
  beforeEach(() => {
    client = postgres(`postgres://pivot@127.0.0.1:${proxy.port}/postgres`, { ...NEON_POOL, onnotice: () => {} });
    db = drizzle(client);
  });
  afterEach(async () => {
    await Promise.race([client.end({ timeout: 0 }).catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
  });

  afterAll(async () => {
    await proxy?.close();
    if (tmp) {
      try {
        execFileSync(path.join(bin!, "pg_ctl"), ["-D", path.join(tmp, "pg"), "-m", "fast", "-w", "stop"], {
          stdio: "ignore",
          env: pgEnv,
        });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  });

  const one = async () => (await db.execute(sql`select 1 as one`))[0];
  /** Opens every connection the pool may hold (parallel queries that overlap), then they all "sleep". */
  const fillPoolThenSleep = async () => {
    await Promise.all(
      Array.from({ length: NEON_POOL.max }, (_, i) => db.execute(sql`select pg_sleep(0.05), ${i}::int as i`)),
    );
    expect(proxy.connections()).toBe(NEON_POOL.max);
    proxy.sleep();
  };

  it("fails the first query after the sleep with ECONNRESET, which counts as a broken connection", async () => {
    await fillPoolThenSleep();
    const err = await one().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(isConnectionError(err)).toBe(true);
  });

  it("is not saved by a single retry when the whole pool died", async () => {
    await fillPoolThenSleep();
    await expect(retryOnConnectionError(one, { retries: 1 })).rejects.toSatisfy(isConnectionError);
  });

  it("reaches a fresh connection with the default retries, as the API's GET requests do", async () => {
    await fillPoolThenSleep();
    const onRetry = vi.fn();
    expect(await retryOnConnectionError(one, { onRetry })).toEqual({ one: 1 });
    expect(onRetry.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onRetry.mock.calls.length).toBeLessThanOrEqual(NEON_POOL.max);
    // and the pool works normally afterwards
    expect(await one()).toEqual({ one: 1 });
  });
});
