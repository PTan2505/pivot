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

describe("approvals are bound to the exact mockup content", () => {
  const exploring = async (title: string, versions: { title: string; html: string }[]) => {
    const { sessionId } = await design.saveDesignBrief({ title, milestone: "initial", markdown: `## ${title}` });
    const { ids } = await design.saveDesignMockups({ sessionId, mockups: versions });
    const s = (await design.getDesignSession(sessionId))!;
    return { sessionId, ids, mockups: s.mockups };
  };
  const tamper = async (id: string, html: string) => {
    const { designMockups } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await (await db.getDb()).update(designMockups).set({ html }).where(eq(designMockups.id, id));
  };

  it("each version has a content digest of its HTML and kind; the migration's SQL computes the same value", async () => {
    const { mockups } = await exploring("Digest", [{ title: "A", html: "<p>Café ✓</p>" }]);
    expect(mockups[0]).toMatchObject({ interactive: false, digest: design.mockupDigest("<p>Café ✓</p>", false) });
    expect(design.mockupDigest("<p>x</p>", true)).not.toBe(design.mockupDigest("<p>x</p>", false));
    const { sql } = await import("drizzle-orm");
    const html = "<p>Café ✓ \u{1F600}</p>";
    const rows = (await (
      await db.getDb()
    ).execute(
      sql`select encode(sha256(convert_to(${"pivot-mockup:v1:static:" + html}, 'UTF8')), 'hex') as d`,
    )) as unknown as { rows: { d: string }[] };
    expect(rows.rows[0].d).toBe(design.mockupDigest(html, false));
  });

  it("the owner's approval stores the version and the digest the page showed; a stale or wrong digest is refused", async () => {
    const { sessionId, ids, mockups } = await exploring("Owner", [
      { title: "One", html: "<p>1</p>" },
      { title: "Two", html: "<p>2</p>" },
    ]);
    await expect(design.approveDesignMockup(ids[0], "", "0".repeat(64))).rejects.toThrow(/reload it before approving/);
    await expect(design.approveDesignMockup(ids[0], "", "abc")).rejects.toThrow(/reload it before approving/);
    expect((await design.getDesignSession(sessionId))!.status).toBe("exploring");
    // the page shows the first 12 characters; that prefix is enough
    await design.approveDesignMockup(ids[1], "Go", mockups[1].digest.slice(0, 12));
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.decisions.at(-1)).toMatchObject({
      source: "owner",
      binding: { mockupId: ids[1], digest: mockups[1].digest, status: "bound" },
    });
  });

  it("an agent's approval names a version of this session only, and a digest needs its version", async () => {
    const a = await exploring("Agent A", [{ title: "A", html: "<p>a</p>" }]);
    const b = await exploring("Agent B", [{ title: "B", html: "<p>b</p>" }]);
    const base = { sessionId: a.sessionId, kind: "approval" as const, summary: "User approved A" };
    await expect(design.recordDesignDecision({ ...base, mockupId: b.ids[0] })).rejects.toThrow(/No mockup version/);
    await expect(design.recordDesignDecision({ ...base, mockupDigest: a.mockups[0].digest })).rejects.toThrow(
      /needs the mockupId/,
    );
    await expect(
      design.recordDesignDecision({ ...base, mockupId: a.ids[0], mockupDigest: b.mockups[0].digest }),
    ).rejects.toThrow(/isn't the stored one/);
    await design.recordDesignDecision({ ...base, mockupId: a.ids[0] });
    expect((await design.getDesignSession(a.sessionId))!.decisions.at(-1)!.binding).toEqual({
      mockupId: a.ids[0],
      digest: a.mockups[0].digest,
      status: "bound",
    });
  });

  it("building checks the approved version is still what was approved; a changed or missing version stops it", async () => {
    const { sessionId, ids, mockups } = await exploring("Build", [{ title: "One", html: "<p>1</p>" }]);
    await design.approveDesignMockup(ids[0], "", mockups[0].digest);
    await tamper(ids[0], "<p>1, edited after approval</p>");
    // the session reports it too: the HTML no longer hashes to the approved digest
    expect((await design.getDesignSession(sessionId))!.decisions.at(-1)!.binding!.status).toBe("changed");
    // the stored digest no longer matches its HTML: refused at building, and the approval shows it can't be checked
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/Ask for approval again/);
    expect((await design.getDesignSession(sessionId))!.status).toBe("approved");
    await tamper(ids[0], "<p>1</p>");
    await design.setDesignSessionStatus(sessionId, "building");
    expect((await design.getDesignSession(sessionId))!.status).toBe("building");

    const gone = await exploring("Gone", [{ title: "One", html: "<p>g</p>" }]);
    await design.approveDesignMockup(gone.ids[0], "", gone.mockups[0].digest);
    const { designMockups } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await (await db.getDb()).delete(designMockups).where(eq(designMockups.id, gone.ids[0]));
    expect((await design.getDesignSession(gone.sessionId))!.decisions.at(-1)!.binding!.status).toBe("missing");
    await expect(design.setDesignSessionStatus(gone.sessionId, "building")).rejects.toThrow(/Ask for approval again/);
  });

  it("an approval recorded without a version (a chat approval, or one made before binding) keeps working", async () => {
    const { sessionId } = await exploring("Legacy", [{ title: "One", html: "<p>l</p>" }]);
    await design.recordDesignDecision({ sessionId, kind: "approval", summary: "Approved in chat", direction: "1" });
    expect((await design.getDesignSession(sessionId))!.decisions.at(-1)!.binding).toBeNull();
    await design.setDesignSessionStatus(sessionId, "building");
    expect((await design.getDesignSession(sessionId))!.status).toBe("building");
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
