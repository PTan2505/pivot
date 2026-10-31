import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ResourceType, TagKind } from "../src/types";

/**
 * Search relevance on the owner's real library (titles, descriptions, URLs and facets of 25 references and 45
 * sources). Prints Recall@5, Precision@5 and MRR per query and fails if an average drops below the recorded floor.
 */
// Measured 2026-10-31: 0.773 / 0.702 / 0.848 with substring matching, 0.956 / 0.826 / 0.977 after query.ts.
const FLOOR = { recall5: 0.95, precision5: 0.82, mrr: 0.97 };

interface CorpusItem {
  type: ResourceType;
  title: string;
  description: string;
  sourceUrl: string | null;
  tags: { kind: TagKind; name: string }[];
  meta?: Record<string, unknown>;
}

let tmp: string;
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-search-eval-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  resources = await import("../src/resources");
  db = await import("../src/db/client");
  const corpus = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/search-corpus.json"), "utf8")) as {
    items: CorpusItem[];
  };
  for (const item of corpus.items) await resources.createResource({ ...item, meta: item.meta ?? {} });
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

it("finds the right references and sources for real queries", { timeout: 120_000 }, async () => {
  const { queries } = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/search-eval.json"), "utf8")) as {
    queries: { q: string; relevant: string[] }[];
  };
  const rows: string[] = [];
  let recallSum = 0;
  let precisionSum = 0;
  let mrrSum = 0;
  for (const { q, relevant } of queries) {
    const hits = (await resources.listResources({ q, types: ["reference", "source"] })).map((r) => r.title);
    const top = hits.slice(0, 5);
    const found = top.filter((t) => relevant.includes(t)).length;
    const recall = found / Math.min(5, relevant.length);
    // out of what could be relevant in five slots: a query with two relevant pages and three strangers scores 0.4
    const precision = top.length ? found / Math.min(5, Math.max(top.length, relevant.length)) : 0;
    const first = hits.findIndex((t) => relevant.includes(t));
    const rr = first === -1 ? 0 : 1 / (first + 1);
    recallSum += recall;
    precisionSum += precision;
    mrrSum += rr;
    rows.push(
      `${q.padEnd(26)} R@5 ${recall.toFixed(2)}  P@5 ${precision.toFixed(2)}  RR ${rr.toFixed(2)}  hits ${hits.length}`,
    );
  }
  const recall5 = recallSum / queries.length;
  const precision5 = precisionSum / queries.length;
  const mrr = mrrSum / queries.length;
  console.log(
    [
      ...rows,
      `${"mean".padEnd(26)} R@5 ${recall5.toFixed(3)}  P@5 ${precision5.toFixed(3)}  MRR ${mrr.toFixed(3)}`,
    ].join("\n"),
  );
  expect(recall5).toBeGreaterThanOrEqual(FLOOR.recall5);
  expect(precision5).toBeGreaterThanOrEqual(FLOOR.precision5);
  expect(mrr).toBeGreaterThanOrEqual(FLOOR.mrr);
});
