import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let clip: typeof import("../src/clip-requests");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-clip-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  clip = await import("../src/clip-requests");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("clip request ids", () => {
  it("lets the first request save and answers a repeat with its resource", async () => {
    const id = crypto.randomUUID();
    expect(await clip.claimClipRequest(id)).toBeNull();
    const r = await resources.createResource({
      type: "reference",
      title: "Once",
      sourceUrl: "https://example.com/once",
    });
    await clip.completeClipRequest(id, r.id);
    expect(await clip.claimClipRequest(id)).toBe(r.id);
  });

  it("makes a repeat wait for a save still in progress", async () => {
    const id = crypto.randomUUID();
    expect(await clip.claimClipRequest(id)).toBeNull();
    const r = await resources.createResource({
      type: "reference",
      title: "Slow",
      sourceUrl: "https://example.com/slow",
    });
    const repeat = clip.claimClipRequest(id, { waitMs: 5_000 });
    setTimeout(() => void clip.completeClipRequest(id, r.id), 300);
    expect(await repeat).toBe(r.id);
  });

  it("gives up waiting with an in-progress error", async () => {
    const id = crypto.randomUUID();
    await clip.claimClipRequest(id);
    await expect(clip.claimClipRequest(id, { waitMs: 300 })).rejects.toBeInstanceOf(clip.ClipInProgressError);
  });

  it("lets a retry save again after a failed first attempt", async () => {
    const id = crypto.randomUUID();
    await clip.claimClipRequest(id);
    await clip.releaseClipRequest(id);
    expect(await clip.claimClipRequest(id)).toBeNull();
  });
});
