// Approval resets against a real PostgreSQL server, whose clock is the operating system's, not this process's: the
// app's clock is set an hour behind or ahead (only JS Date is faked) and the approval rules must still hold. PGlite runs
// inside this process on the JS clock, so this skew can only be shown with a separate server. Skipped when no
// PostgreSQL binaries are found (PG_BIN, PATH, or Homebrew's postgresql@*).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

// PostgreSQL refuses to start without a valid locale; C is present everywhere.
const pgEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
let tmp: string;
let design: typeof import("../src/design");
let db: typeof import("../src/db/client");
const HOUR = 3_600_000;

describe.skipIf(!bin)("approval resets with the app's clock skewed from the database's (real PostgreSQL)", () => {
  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-pg-"));
    const data = path.join(tmp, "pg");
    execFileSync(
      path.join(bin!, "initdb"),
      ["-D", data, "-U", "pivot", "-A", "trust", "-E", "UTF8", "--no-locale", "--no-sync"],
      {
        stdio: "ignore",
        env: pgEnv,
      },
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
    Object.assign(process.env, {
      DATABASE_URL: `postgres://pivot@127.0.0.1:${port}/postgres`,
      PIVOT_DATA_DIR: path.join(tmp, "data"),
      PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
    });
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
    design = await import("../src/design");
    db = await import("../src/db/client");
  }, 60_000);

  afterAll(async () => {
    await db?.closeDb();
    if (tmp) {
      try {
        execFileSync(path.join(bin!, "pg_ctl"), ["-D", path.join(tmp, "pg"), "-m", "fast", "-w", "stop"], {
          stdio: "ignore",
          env: pgEnv,
        });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        delete process.env.DATABASE_URL;
      }
    }
  });

  const approvedSession = async (title: string) => {
    const { sessionId } = await design.saveDesignBrief({ title, milestone: "initial", markdown: `## ${title}` });
    const html = `<p>${title}</p>`;
    const { ids } = await design.saveDesignMockups({ sessionId, mockups: [{ title, html }] });
    await design.approveDesignMockup(ids[0], "", design.mockupDigest(html));
    return { sessionId, mockupId: ids[0], digest: design.mockupDigest(html) };
  };
  /** Runs `fn` with this process's clock moved by `offset` ms; the database's clock is untouched. */
  const skewed = async (offset: number, fn: () => Promise<void>) => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + offset });
    try {
      await fn();
    } finally {
      vi.useRealTimers();
    }
  };
  const times = async (sessionId: string) => {
    const { sql } = await import("drizzle-orm");
    const rows = (await (
      await db.getDb()
    ).execute(
      sql`select (select approval_reset_at from design_sessions where id = ${sessionId}) as reset,
                 (select max(created_at) from design_decisions where session_id = ${sessionId} and kind = 'approval') as approved,
                 now() as db_now`,
    )) as unknown as { reset: Date; approved: Date; db_now: Date }[];
    return rows[0];
  };

  it("an app clock an hour behind can't revive the approval a Reopen ended", async () => {
    const { sessionId } = await approvedSession("Behind");
    await skewed(-HOUR, async () => {
      await design.setDesignSessionStatus(sessionId, "exploring"); // Reopen
      await design.setDesignSessionStatus(sessionId, "abandoned");
    });
    // the reset is on the database's clock: after the approval, not an hour before it
    const t = await times(sessionId);
    expect(new Date(t.reset).getTime()).toBeGreaterThan(new Date(t.approved).getTime());
    expect(Math.abs(new Date(t.reset).getTime() - new Date(t.db_now).getTime())).toBeLessThan(60_000);
    for (const status of ["approved", "building"] as const)
      await expect(design.setDesignSessionStatus(sessionId, status)).rejects.toThrow(/needs approving again/);
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).toBeNull();
  });

  it("an app clock an hour ahead doesn't hold back a genuine approval made after the reset", async () => {
    const { sessionId, mockupId, digest } = await approvedSession("Ahead");
    await skewed(HOUR, async () => {
      await design.setDesignSessionStatus(sessionId, "exploring"); // Reopen
    });
    await design.approveDesignMockup(mockupId, "again", digest);
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).not.toBeNull();
    await design.setDesignSessionStatus(sessionId, "building");
    expect((await design.getDesignSession(sessionId))!.status).toBe("building");
  });

  it("a major change made while the app's clock is behind still ends the earlier approval", async () => {
    const { sessionId } = await approvedSession("Major behind");
    await skewed(-HOUR, async () => {
      await design.saveDesignBrief({ sessionId, title: "x", milestone: "major_change", markdown: "# v2" });
    });
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/needs approving again/);
  });

  it("migration 0010 runs on PostgreSQL itself: the backfilled digest matches the app's", async () => {
    const { sql } = await import("drizzle-orm");
    const html = "<p>Café ✓</p>";
    const rows = (await (
      await db.getDb()
    ).execute(
      sql`select encode(sha256(convert_to(${"pivot-mockup:v1:static:" + html}, 'UTF8')), 'hex') as d`,
    )) as unknown as {
      d: string;
    }[];
    expect(rows[0].d).toBe(design.mockupDigest(html, false));
  });
});
