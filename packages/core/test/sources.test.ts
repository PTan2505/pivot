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
    // A blank description from a form still gets the known one.
    const mobbin = await resources.createResource({
      type: "source",
      title: "Mobbin",
      description: "",
      sourceUrl: "https://mobbin.com/",
    });
    expect(mobbin.description).not.toBe("");
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

  it("counts a known site's old domain, and gives a shared host to the source saved first", async () => {
    const recent = await resources.createResource({
      type: "source",
      title: "Recent",
      sourceUrl: "https://recent.design/",
    });
    await resources.createResource({ type: "reference", title: "Godly site", sourceUrl: "https://godly.website/w/1" });
    expect((await resources.sourceStats())[recent.id]).toBe(1);

    const first = await resources.createResource({ type: "source", title: "Lab", sourceUrl: "https://lab.example/" });
    const second = await resources.createResource({
      type: "source",
      title: "Lab again",
      sourceUrl: "https://lab.example/tools",
    });
    await resources.createResource({ type: "reference", title: "Lab page", sourceUrl: "https://lab.example/p/1" });
    for (let i = 0; i < 3; i++) {
      const stats = await resources.sourceStats();
      expect([stats[first.id], stats[second.id]]).toEqual([1, undefined]);
    }
  });
});

describe("external search links", () => {
  it("builds search links for a query, saved sources first, and nothing for an empty query", async () => {
    const { externalSearchLinks } = await import("../src/known-sources");
    expect(externalSearchLinks("  ")).toEqual([]);
    const links = externalSearchLinks("pricing table", { savedHosts: ["www.lapa.ninja"], limit: 3 });
    expect(links[0]).toMatchObject({
      host: "lapa.ninja",
      saved: true,
      url: "https://www.lapa.ninja/search/?q=pricing%20table",
    });
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.url.includes("pricing%20table"))).toBe(true);
    const motion = externalSearchLinks("loader", { category: "motion" });
    expect(motion.every((l) => l.category === "motion")).toBe(true);
  });
});
