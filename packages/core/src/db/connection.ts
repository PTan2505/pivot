/**
 * The Neon (PostgreSQL) connection pool, and what to do when one of its connections died while it sat idle.
 *
 * A connection can die without the client hearing about it: the computer sleeps, the network changes, or Neon suspends
 * its compute. The next query on that connection then fails with ECONNRESET (seen after a laptop woke up). Two things
 * keep that from reaching the user:
 * - the pool closes connections that sat idle, and replaces old ones, so a stale one is rarely picked;
 * - a read that still hits one runs again (postgres.js drops a connection once it fails). After a sleep every pooled
 *   connection can be dead, and each failed try removes only one, so a read may need as many tries as the pool has
 *   connections: with 5 dead, the 6th try opens a fresh one (checked against a real PostgreSQL server in
 *   test/connection.pg.test.ts). Node's timers don't count the time the computer slept, so `idle_timeout` alone
 *   doesn't clear them.
 */

/** postgres.js options for the Neon pool. */
export const NEON_POOL = {
  max: 5,
  /** Seconds a connection may sit unused before the pool closes it (a new one opens on the next query). */
  idle_timeout: 20,
  /** Seconds before a connection is replaced, however busy it is. */
  max_lifetime: 30 * 60,
} as const;

/**
 * Errors that mean the connection broke, not that the query was wrong: Node's socket errors and postgres.js's own
 * connection codes. A refused connection isn't one (the server is down: running it again won't help).
 */
const CONNECTION_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
]);

/** Whether `err`, or an error it wraps (Drizzle puts the driver's error in `cause`), is a broken connection. */
export function isConnectionError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && CONNECTION_CODES.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs `fn`, and runs it again while it fails on a broken connection, at most `retries` more times: by default one try
 * per pooled connection, so even a pool that died whole reaches a fresh connection. Only for work that is safe to
 * repeat (reads, GET requests): a write that broke halfway might have been applied. Other errors are thrown at once.
 */
export async function retryOnConnectionError<T>(
  fn: () => Promise<T>,
  { retries = NEON_POOL.max, onRetry }: { retries?: number; onRetry?: (err: unknown) => void } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isConnectionError(err)) throw err;
      onRetry?.(err);
    }
  }
}
