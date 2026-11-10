// Under the test runner PIVOT refuses the owner's real data folder, skills folder, database and bucket, so a test that
// forgets to isolate itself fails instead of touching real data (incident 2026-11-10).
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { databaseMode, dataDir, skillsDir } from "../src/config";
import { r2ConfigFromEnv } from "../src/storage";

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

describe("tests can't reach real PIVOT data", () => {
  it("refuses the real data and skills folders, even when HOME is faked", () => {
    delete process.env.PIVOT_DATA_DIR;
    expect(() => dataDir()).toThrow(/must not use the real/);
    process.env.HOME = "/tmp/fake-home";
    process.env.PIVOT_DATA_DIR = path.join(os.userInfo().homedir, ".pivot");
    expect(() => dataDir()).toThrow(/must not use the real/);
    process.env.PIVOT_DATA_DIR = path.join(os.userInfo().homedir, ".stan-bag", "x");
    expect(() => dataDir()).toThrow(/must not use the real/);
    delete process.env.CLAUDE_SKILLS_DIR;
    process.env.HOME = os.userInfo().homedir;
    expect(() => skillsDir()).toThrow(/must not use the real/);
    // positive control
    process.env.PIVOT_DATA_DIR = path.join(os.tmpdir(), "pivot-guard-ok");
    expect(dataDir()).toBe(path.join(os.tmpdir(), "pivot-guard-ok"));
  });

  it("refuses a non-local database or R2 endpoint", () => {
    process.env.DATABASE_URL = "postgres://u:p@ep-example.neon.tech/db";
    expect(() => databaseMode()).toThrow(/real DATABASE_URL/);
    process.env.DATABASE_URL = "postgres://u@127.0.0.1:5432/db";
    expect(databaseMode()).toBe("neon");
    Object.assign(process.env, {
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET: "b",
      R2_ACCOUNT_ID: "acct",
    });
    delete process.env.R2_ENDPOINT;
    expect(() => r2ConfigFromEnv()).toThrow(/real R2_ENDPOINT/);
    process.env.R2_ENDPOINT = "http://127.0.0.1:9999";
    expect(r2ConfigFromEnv()).toMatchObject({ endpoint: "http://127.0.0.1:9999" });
  });
});
