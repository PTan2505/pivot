import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-review-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("Inbox and page filters", () => {
  it("lists quick saves in the Inbox without hiding them from search, and takes them out when reviewed", async () => {
    const quick = await resources.createResource({
      type: "reference",
      title: "Quick pricing",
      sourceUrl: "https://acme.com/pricing",
      reviewStatus: "needs_review",
    });
    const done = await resources.createResource({
      type: "reference",
      title: "Sorted pricing",
      sourceUrl: "https://acme.com/",
    });
    expect(quick.reviewStatus).toBe("needs_review");
    expect(done.reviewStatus).toBeNull();

    expect((await resources.listResources({ needsReview: true })).map((r) => r.id)).toEqual([quick.id]);
    expect((await resources.listResources({ q: "pricing" })).map((r) => r.id).sort()).toEqual(
      [quick.id, done.id].sort(),
    );
    expect((await resources.typeCounts()).inbox).toBe(1);

    await resources.setReviewStatus([quick.id], null);
    expect(await resources.listResources({ needsReview: true })).toEqual([]);
    expect((await resources.typeCounts()).inbox).toBe(0);
    await resources.updateResource(done.id, { reviewStatus: "needs_review" });
    expect((await resources.listResources({ needsReview: true })).map((r) => r.id)).toEqual([done.id]);
  });

  it("narrows to one page or one website", async () => {
    const a = await resources.createResource({
      type: "reference",
      title: "Docs A",
      sourceUrl: "https://docs.site.dev/a/",
    });
    const b = await resources.createResource({ type: "reference", title: "Docs B", sourceUrl: "https://site.dev/b" });
    await resources.createResource({ type: "reference", title: "Other", sourceUrl: "https://notsite.dev/a" });
    expect((await resources.listResources({ url: "https://docs.site.dev/a" })).map((r) => r.id)).toEqual([a.id]);
    expect((await resources.listResources({ host: "site.dev", sort: "title" })).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(await resources.listResources({ host: "nothing.example" })).toEqual([]);
  });
});
