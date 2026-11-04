// Migration 0010 (approval binding) on a database that already holds mockups and approvals: every existing version gets
// the same content digest the app computes, older approvals stay unbound, and the digest column ends NOT NULL.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import { mockupDigest } from "../src/design";

const dir = path.resolve(__dirname, "../src/db/migrations");
const run = async (db: PGlite, file: string) => {
  for (const statement of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint"))
    if (statement.trim()) await db.exec(statement);
};

describe("migration 0010_windy_tana_nile.sql", () => {
  it("backfills existing mockups' digests and leaves older approvals unbound", async () => {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const db = new PGlite();
    try {
      for (const f of files.filter((f) => f < "0010")) await run(db, f);
      const html = "<p>Old mockup – café ✓</p>";
      await db.query("insert into design_sessions (id, title, status) values ($1, $2, $3)", ["s1", "Old", "approved"]);
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
      await run(db, "0010_windy_tana_nile.sql");
      const m = (
        await db.query<{ digest: string; interactive: boolean }>("select digest, interactive from design_mockups")
      ).rows[0];
      expect(m).toEqual({ digest: mockupDigest(html, false), interactive: false });
      const d = (await db.query("select mockup_id, mockup_digest from design_decisions")).rows[0];
      expect(d).toEqual({ mockup_id: null, mockup_digest: null });
      // the session keeps its status, and no reset: its approval keeps the meaning it had
      const s = (await db.query("select status, approval_reset_at from design_sessions")).rows[0];
      expect(s).toEqual({ status: "approved", approval_reset_at: null });
      await expect(
        db.query(
          "insert into design_mockups (id, session_id, round, n, title, html, round_digest) values ('m2', 's1', 2, 1, 't', 'h', 'r')",
        ),
      ).rejects.toThrow(/digest/);
    } finally {
      await db.close();
    }
  });

  it("a failure inside it rolls the whole migration back: no half-added columns, no recorded step", async () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-mig-"));
    try {
      fs.cpSync(dir, copy, { recursive: true });
      const target = fs.readdirSync(copy).find((f) => f.startsWith("0010"))!;
      // a step that fails after the columns were added and the digests filled
      fs.appendFileSync(path.join(copy, target), "--> statement-breakpoint\nSELECT 1/0;");
      const client = new PGlite();
      const db = drizzle(client);
      const journal = JSON.parse(fs.readFileSync(path.join(copy, "meta/_journal.json"), "utf8"));
      const upTo9 = { ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx < 10) };
      fs.writeFileSync(path.join(copy, "meta/_journal.json"), JSON.stringify(upTo9));
      await migrate(db, { migrationsFolder: copy });
      await client.query("insert into design_sessions (id, title) values ('s1', 'Old')");
      await client.query(
        "insert into design_mockups (id, session_id, round, n, title, html, round_digest) values ('m1', 's1', 1, 1, 't', '<p>x</p>', 'r')",
      );
      fs.writeFileSync(path.join(copy, "meta/_journal.json"), JSON.stringify(journal));
      await expect(migrate(db, { migrationsFolder: copy })).rejects.toThrow();
      const cols = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name in ('design_mockups', 'design_decisions', 'design_sessions')",
      );
      const names = cols.rows.map((r) => r.column_name);
      for (const c of ["digest", "interactive", "mockup_id", "mockup_digest", "approval_reset_at"])
        expect(names).not.toContain(c);
      const steps = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
      expect(steps.rows[0]).toEqual({ n: upTo9.entries.length });
      // the data is as it was
      expect((await client.query("select html from design_mockups")).rows).toEqual([{ html: "<p>x</p>" }]);
      await client.close();
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });
});
