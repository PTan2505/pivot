// Migration 0010 (approval binding) on a database that already holds mockups and approvals: every existing version gets
// the same content digest the app computes, older approvals stay unbound, and the digest column ends NOT NULL.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { mockupDigest } from "../src/design";

const dir = path.resolve(__dirname, "../src/db/migrations");
const run = async (db: PGlite, file: string) => {
  for (const statement of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint"))
    if (statement.trim()) await db.exec(statement);
};

describe("migration 0010_cynical_black_tom.sql", () => {
  it("backfills existing mockups' digests and leaves older approvals unbound", async () => {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const db = new PGlite();
    try {
      for (const f of files.filter((f) => f < "0010")) await run(db, f);
      const html = "<p>Old mockup – café ✓</p>";
      await db.query("insert into design_sessions (id, title) values ($1, $2)", ["s1", "Old"]);
      await db.query(
        "insert into design_mockups (id, session_id, round, n, title, html, round_digest) values ($1, $2, 1, 1, $3, $4, $5)",
        ["m1", "s1", "Old", html, crypto.randomUUID()],
      );
      await db.query("insert into design_decisions (id, session_id, kind, summary) values ($1, $2, $3, $4)", [
        "d1",
        "s1",
        "approval",
        "approved before binding",
      ]);
      await run(db, "0010_cynical_black_tom.sql");
      const m = (
        await db.query<{ digest: string; interactive: boolean }>("select digest, interactive from design_mockups")
      ).rows[0];
      expect(m).toEqual({ digest: mockupDigest(html, false), interactive: false });
      const d = (await db.query("select mockup_id, mockup_digest from design_decisions")).rows[0];
      expect(d).toEqual({ mockup_id: null, mockup_digest: null });
      await expect(
        db.query(
          "insert into design_mockups (id, session_id, round, n, title, html, round_digest) values ('m2', 's1', 2, 1, 't', 'h', 'r')",
        ),
      ).rejects.toThrow(/digest/);
    } finally {
      await db.close();
    }
  });
});
