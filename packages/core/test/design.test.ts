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

  it("only lets a session be marked approved by hand once it has a recorded approval", async () => {
    const { sessionId } = await design.saveDesignBrief({ title: "Onboarding", milestone: "initial", markdown: "## B" });
    await expect(design.setDesignSessionStatus(sessionId, "approved")).rejects.toThrow(/no recorded approval/);
    expect((await design.getDesignSession(sessionId))!.status).toBe("exploring");
    // the other statuses stay free to set by hand
    await design.setDesignSessionStatus(sessionId, "abandoned");
    expect((await design.getDesignSession(sessionId))!.status).toBe("abandoned");

    await design.recordDesignDecision({ sessionId, kind: "approval", summary: "Direction 2" });
    await design.setDesignSessionStatus(sessionId, "building");
    await design.setDesignSessionStatus(sessionId, "approved");
    expect((await design.getDesignSession(sessionId))!.status).toBe("approved");
  });

  it("keeps mockup rounds, and the owner's approval of one version records it and marks the session approved", async () => {
    const { sessionId, snapshotId } = await design.saveDesignBrief({
      title: "Billing",
      milestone: "initial",
      markdown: "## Brief: billing",
    });
    const versions = [
      { title: "Raised card", html: "<!doctype html><p>1</p>" },
      { title: "Quiet table", html: "<!doctype html><p>2</p>" },
    ];
    await expect(design.saveDesignMockups({ sessionId, mockups: [] })).rejects.toThrow(/1 to 9/);
    await expect(
      design.saveDesignMockups({ sessionId, mockups: [{ title: "Big", html: "x".repeat(2 * 1024 * 1024 + 1) }] }),
    ).rejects.toThrow(/over 2 MB/);

    const one = await design.saveDesignMockups({ sessionId, mockups: versions });
    expect(one).toMatchObject({ round: 1, created: true });
    // the same set again is the same round
    expect(await design.saveDesignMockups({ sessionId, mockups: versions })).toEqual({ ...one, created: false });
    const two = await design.saveDesignMockups({ sessionId, mockups: [versions[1]] });
    expect(two.round).toBe(2);

    const s = (await design.getDesignSession(sessionId))!;
    expect(s.mockups.map((m) => [m.round, m.n, m.title, m.snapshotId])).toEqual([
      [1, 1, "Raised card", snapshotId],
      [1, 2, "Quiet table", snapshotId],
      [2, 1, "Quiet table", snapshotId],
    ]);
    expect(s.mockups[0]).not.toHaveProperty("html");
    expect((await design.getDesignMockupHtml(one.ids[1]))!.html).toBe(versions[1].html);

    expect(await design.approveDesignMockup("00000000-0000-0000-0000-000000000000")).toBeNull();
    await design.approveDesignMockup(one.ids[0], "  Keep the table of version 2.  ");
    const approved = (await design.getDesignSession(sessionId))!;
    expect(approved.status).toBe("approved");
    expect(approved.decisions.at(-1)).toMatchObject({
      kind: "approval",
      source: "owner",
      direction: "Version 1: Raised card (round 1)",
      details: "Keep the table of version 2.",
    });
    // once approved, neither another approval nor a new round goes in without a major change
    await expect(design.approveDesignMockup(one.ids[1])).rejects.toThrow(/session is approved/);
    await expect(design.saveDesignMockups({ sessionId, mockups: [{ title: "Late", html: "<p>" }] })).rejects.toThrow(
      /session is approved/,
    );
    // agent records keep their source
    await design.recordDesignDecision({ sessionId, kind: "change", summary: "Tighter rows" });
    expect((await design.getDesignSession(sessionId))!.decisions.at(-1)!.source).toBe("agent");
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
