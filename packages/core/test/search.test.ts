import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseQuery } from "../src/query";
import type { ResourceType, TagKind } from "../src/types";

let tmp: string;
let resources: typeof import("../src/resources");
let search: typeof import("../src/search");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-search-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  resources = await import("../src/resources");
  search = await import("../src/search");
  db = await import("../src/db/client");
  const corpus = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/search-corpus.json"), "utf8")) as {
    items: {
      type: ResourceType;
      title: string;
      description: string;
      sourceUrl: string | null;
      tags: { kind: TagKind; name: string }[];
      meta?: Record<string, unknown>;
    }[];
  };
  for (const item of corpus.items) await resources.createResource({ ...item, meta: item.meta ?? {} });
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("parseQuery", () => {
  it("reads synonyms as one term, drops stop words, and keeps soft words only when nothing else is left", () => {
    expect(parseQuery("sign in").map((t) => t.text)).toEqual(["sign in"]);
    expect(parseQuery("login")[0].patterns).toContain("\\msign[\\s_-]*in");
    expect(parseQuery("pricing page").map((t) => t.text)).toEqual(["pricing"]);
    expect(parseQuery("inspiration gallery").map((t) => t.text)).toEqual(["inspiration"]);
    expect(parseQuery("page").map((t) => t.text)).toEqual(["page"]);
    expect(parseQuery("the of").map((t) => t.text)).toEqual(["the", "of"]);
    // plurals find singulars, and the match starts at a word
    expect(parseQuery("icons")[0].patterns).toEqual(["\\micon"]);
    expect(parseQuery("class")[0].patterns).toEqual(["\\mclass"]);
    // regular-expression characters are taken literally
    expect(parseQuery("c++")[0].patterns).toEqual(["\\mc\\+\\+"]);
  });
});

describe("searchResources", () => {
  it("matches at word starts, so a term doesn't hit inside another word", async () => {
    const page = await search.searchResources({ query: "sign" });
    expect(page.results.map((r) => r.title).sort()).toEqual(["GitHub — Sign in", "Supabase — Sign in"]);
  });

  it("pages through every match once, in a stable order, with a total", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let total = 0;
    do {
      const page: Awaited<ReturnType<typeof search.searchResources>> = await search.searchResources({
        types: ["reference", "source"],
        limit: 7,
        cursor,
      });
      total = page.total;
      seen.push(...page.results.map((r) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(total).toBe(70);
    expect(new Set(seen).size).toBe(70);
    const again = await search.searchResources({ types: ["reference", "source"], limit: 7 });
    expect(again.results.map((r) => r.id)).toEqual(seen.slice(0, 7));
  });

  it("refuses a cursor from another search, and limits outside 1–50", async () => {
    const first = await search.searchResources({ query: "pricing", limit: 2 });
    expect(first.nextCursor).toBeTruthy();
    await expect(search.searchResources({ query: "docs", limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
    await expect(search.searchResources({ query: "docs", cursor: "garbage" })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
    await expect(search.searchResources({ limit: 0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(search.searchResources({ limit: 51 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("filters by facet name in any case, and reports facets that don't exist", async () => {
    const pricing = await search.searchResources({ facets: [{ kind: "pageType", name: "pricing" }] });
    expect(pricing.total).toBe(5);
    expect(pricing.results.every((r) => r.facets.some((f) => f.kind === "pageType" && f.name === "Pricing"))).toBe(
      true,
    );
    const darkPricing = await search.searchResources({
      facets: [
        { kind: "pageType", name: "Pricing" },
        { kind: "visualStyle", name: "DARK" },
      ],
    });
    expect(darkPricing.results.map((r) => r.title).sort()).toEqual([
      "Framer: Pricing",
      "Pricing & Fees | Supabase",
      "Pricing – Linear",
    ]);
    const unknown = await search.searchResources({ facets: [{ kind: "pageType", name: "Checkout" }] });
    expect(unknown).toMatchObject({ total: 0, results: [], unknownFacets: [{ kind: "pageType", name: "Checkout" }] });
  });

  it("returns small hits without storage details, http(s) links only, and never trashed items", async () => {
    const page = await search.searchResources({ query: "linear" });
    expect(Object.keys(page.results[0]).sort()).toEqual(
      [
        "createdAt",
        "description",
        "facets",
        "hasScreenshot",
        "host",
        "id",
        "sourceUrl",
        "title",
        "type",
        "updatedAt",
      ].sort(),
    );
    expect(page.results[0].host).toBe("linear.app");
    expect(page.sort).toBe("relevance");

    const odd = await resources.createResource({
      type: "reference",
      title: "Odd link test",
      sourceUrl: "javascript:alert(1)",
    });
    const hit = (await search.searchResources({ query: "odd link test" })).results.find((r) => r.id === odd.id);
    expect(hit?.sourceUrl ?? null).toBeNull();

    await resources.trashResources([odd.id]);
    expect((await search.searchResources({ query: "odd link test" })).total).toBe(0);
  });
});
