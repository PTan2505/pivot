import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let design: typeof import("../src/design");
let suggestions: typeof import("../src/suggestions");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-design-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  design = await import("../src/design");
  suggestions = await import("../src/suggestions");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("design sessions", () => {
  it("opens a session with the first brief, keeps snapshots and decisions, and asks again after a major change", async () => {
    await expect(design.saveDesignBrief({ title: "x", milestone: "approved", markdown: "# B" })).rejects.toThrow(
      /Only the first complete brief/,
    );
    const first = await design.saveDesignBrief({
      title: "Ledgerly pricing",
      targetProject: "ledgerly",
      surface: "pricing page",
      milestone: "initial",
      markdown: "## Brief: pricing\n| Reference | Take | Leave |",
      referenceIds: ["r1"],
    });
    expect(first).toMatchObject({ created: true, duplicate: false });
    // the same brief again is the same snapshot
    const again = await design.saveDesignBrief({
      sessionId: first.sessionId,
      title: "Ledgerly pricing",
      milestone: "initial",
      markdown: "## Brief: pricing\n| Reference | Take | Leave |",
    });
    expect(again).toMatchObject({ snapshotId: first.snapshotId, duplicate: true });

    await design.recordDesignDecision({ sessionId: first.sessionId, kind: "approval", summary: "A with B's columns" });
    await design.saveDesignBrief({
      sessionId: first.sessionId,
      title: "",
      milestone: "approved",
      markdown: "## Approved",
    });
    expect((await design.getDesignSession(first.sessionId))!.status).toBe("approved");

    await design.saveDesignBrief({
      sessionId: first.sessionId,
      title: "",
      milestone: "major_change",
      markdown: "## Changed: cards instead of table",
      note: "the table didn't fit on phones",
    });
    const s = (await design.getDesignSession(first.sessionId))!;
    expect(s.status).toBe("exploring");
    expect(s.snapshots.map((x) => x.milestone)).toEqual(["initial", "approved", "major_change"]);
    expect(s.decisions.map((d) => d.kind)).toEqual(["approval"]);
    expect((await design.listDesignSessions({ targetProject: "ledgerly" })).map((x) => x.id)).toEqual([
      first.sessionId,
    ]);
  });
});

describe("agent suggestions", () => {
  it("keeps suggestions pending, reuses existing facet names, finds them in search, and applies only what you accept", async () => {
    const r = await resources.createResource({
      type: "reference",
      title: "Untitled shot",
      sourceUrl: "https://ex.com/a",
      tags: [{ kind: "pageType", name: "Pricing" }],
    });
    await resources.createResource({
      type: "reference",
      title: "Other",
      tags: [{ kind: "visualStyle", name: "Dark" }],
    });
    const { added, skipped } = await suggestions.addSuggestions(r.id, [
      { kind: "facet", value: { kind: "visualStyle", name: "dark" }, reason: "black background" },
      { kind: "facet", value: { kind: "pageType", name: "pricing" } },
      { kind: "title", value: { text: "Glassy pricing table" } },
      { kind: "description", value: { text: "Three tiers on a glowing grid" } },
      { kind: "collection", value: { name: "Pricing pages" } },
    ]);
    expect(added.map((a) => a.kind)).toEqual(["facet", "title", "description", "collection"]);
    expect(added[0].value).toMatchObject({ name: "Dark", existing: true });
    expect(skipped).toMatchObject([{ why: "already on the reference" }]);
    // nothing changed yet, but the description is searchable
    expect((await resources.getResource(r.id))!.title).toBe("Untitled shot");
    expect((await resources.listResources({ q: "glowing grid" })).map((x) => x.id)).toEqual([r.id]);
    // a repeat is not stored twice
    expect(
      (await suggestions.addSuggestions(r.id, [{ kind: "title", value: { text: "glassy pricing table" } }])).skipped,
    ).toHaveLength(1);

    const byKind = Object.fromEntries(added.map((a) => [a.kind, a.id]));
    await suggestions.decideSuggestions([byKind.facet, byKind.collection, byKind.title], true);
    await suggestions.decideSuggestions([byKind.description], false);
    const after = (await resources.getResource(r.id))!;
    expect(after.title).toBe("Glassy pricing table");
    expect(after.description).toBe("");
    expect(after.tags.map((t) => t.name).sort()).toEqual(["Dark", "Pricing"]);
    expect(after.collections.map((c) => c.name)).toEqual(["Pricing pages"]);
    expect(await suggestions.listSuggestions({ resourceId: r.id })).toEqual([]);
    // rejected text is no longer searchable
    expect(await resources.listResources({ q: "glowing grid" })).toEqual([]);
  });

  it("appends an agent note without touching the user's notes", async () => {
    const r = await resources.createResource({ type: "reference", title: "Noted", notes: "Mine." });
    const line = await suggestions.annotateReference(r.id, "The table groups features by job.");
    expect(line).toMatch(/^agent \(\d{4}-\d{2}-\d{2}\): The table/);
    expect((await resources.getResource(r.id))!.notes).toBe(`Mine.\n\n${line}`);
  });
});
