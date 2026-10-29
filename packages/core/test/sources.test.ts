import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { knownSourceFor, matchHost } from "../src/source-match";
import { sourceSearchUrl } from "../src/types";

let tmp: string;
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-sources-"));
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

describe("source matching", () => {
  it("knows sites and matches hosts", () => {
    expect(knownSourceFor("https://www.dribbble.com/shots/1")?.name).toBe("Dribbble");
    expect(matchHost("styles.refero.design", ["refero.design", "styles.refero.design"])).toBe("styles.refero.design");
    expect(matchHost("cdn.dribbble.com", ["dribbble.com"])).toBe("dribbble.com");
    expect(matchHost("notdribbble.com", ["dribbble.com"])).toBeNull();
    expect(sourceSearchUrl("https://dribbble.com/search/{q}", "pricing page")).toBe(
      "https://dribbble.com/search/pricing%20page",
    );
  });
});

describe("sources", () => {
  it("fills in known sites and attributes references by host", async () => {
    const dribbble = await resources.createResource({
      type: "source",
      title: "Dribbble",
      sourceUrl: "https://dribbble.com/",
    });
    expect(dribbble.meta).toMatchObject({ category: "inspiration", searchUrl: expect.stringContaining("{q}") });
    const foundry = await resources.createResource({
      type: "source",
      title: "A foundry",
      sourceUrl: "https://some-type-foundry.example/",
      meta: { category: "type-color" },
    });
    expect(foundry.meta).toEqual({ category: "type-color" });

    // References saved from the same site count toward it.
    for (const [title, url] of [
      ["Pricing shot", "https://dribbble.com/shots/123-Pricing"],
      ["Another shot", "https://dribbble.com/shots/9"],
    ])
      await resources.createResource({ type: "reference", title, sourceUrl: url });
    expect((await resources.sourceStats())[dribbble.id]).toBe(2);
    const via = await resources.listResources({ via: dribbble.id });
    expect(via.map((r) => r.title).sort()).toEqual(["Another shot", "Pricing shot"]);
  });
});
