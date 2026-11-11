import crypto from "node:crypto";
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

  it("an interactive version stores its kind in its digest, approves the same way, and keeps static rounds as they were", async () => {
    const { sessionId } = await design.saveDesignBrief({ title: "Live", milestone: "initial", markdown: "## Live" });
    const html = "<button>Go</button><script>1</script>";
    const one = await design.saveDesignMockups({
      sessionId,
      mockups: [
        { title: "Still", html },
        { title: "Live", html, interactive: true },
      ],
    });
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.mockups.map((m) => [m.interactive, m.digest])).toEqual([
      [false, design.mockupDigest(html, false)],
      [true, design.mockupDigest(html, true)],
    ]);
    // the same set again is the same round; flipping the flag is a different round
    expect(
      await design.saveDesignMockups({
        sessionId,
        mockups: [
          { title: "Still", html },
          { title: "Live", html, interactive: true },
        ],
      }),
    ).toEqual({
      ...one,
      created: false,
    });
    const flipped = await design.saveDesignMockups({
      sessionId,
      mockups: [
        { title: "Still", html },
        { title: "Live", html },
      ],
    });
    expect(flipped.created).toBe(true);
    // a static set saved without the flag keeps the round identity it had before the flag existed
    expect(
      await design.saveDesignMockups({
        sessionId,
        mockups: [
          { title: "Still", html },
          { title: "Live", html, interactive: false },
        ],
      }),
    ).toEqual({
      ...flipped,
      created: false,
    });
    // the owner approves the interactive version by the digest the preview and the page show
    await expect(design.approveDesignMockup(one.ids[1], "", design.mockupDigest(html, false))).rejects.toThrow(
      /reload it before approving/,
    );
    await design.approveDesignMockup(one.ids[1], "The live one", design.mockupDigest(html, true).slice(0, 12));
    expect((await design.getDesignSession(sessionId))!.decisions.at(-1)).toMatchObject({
      binding: { mockupId: one.ids[1], digest: design.mockupDigest(html, true), status: "bound" },
    });
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

  // Inserts rows the way migrated data or a restored backup could hold them, bypassing the app's checks.
  const raw = async () => {
    const schema = await import("../src/db/schema");
    const orm = await import("drizzle-orm");
    return { db: await db.getDb(), ...schema, ...orm };
  };
  const decision = async (sessionId: string, at: Date, binding: { mockupId?: string; mockupDigest?: string } = {}) => {
    const { db: d, designDecisions } = await raw();
    await d.insert(designDecisions).values({
      sessionId,
      kind: "approval",
      summary: "inserted",
      createdAt: at,
      mockupId: binding.mockupId ?? null,
      mockupDigest: binding.mockupDigest ?? null,
    });
  };

  it("an unbound approval can't be recorded once the session has mockups; without mockups it can, and builds", async () => {
    const { sessionId } = await exploring("Unbound", [{ title: "One", html: "<p>u</p>" }]);
    await expect(
      design.recordDesignDecision({ sessionId, kind: "approval", summary: "Approved in chat", direction: "1" }),
    ).rejects.toThrow(/pass the mockupId/);
    expect((await design.getDesignSession(sessionId))!.status).toBe("exploring");
    // a change or a deviation needs no version
    await design.recordDesignDecision({ sessionId, kind: "deviation", summary: "QA found a gap" });

    const { sessionId: plain } = await design.saveDesignBrief({
      title: "Plain",
      milestone: "initial",
      markdown: "# P",
    });
    await design.recordDesignDecision({ sessionId: plain, kind: "approval", summary: "One-paragraph direction" });
    await design.setDesignSessionStatus(plain, "building");
    expect((await design.getDesignSession(plain))!.status).toBe("building");
  });

  const setSession = async (sessionId: string, values: { status?: string; approvalResetAt?: Date | null }) => {
    const { db: d, designSessions, eq } = await raw();
    await d.update(designSessions).set(values).where(eq(designSessions.id, sessionId));
  };

  it("an unbound approval from before binding still counts (it can't be created any more where mockups exist)", async () => {
    const { sessionId } = await exploring("Legacy", [{ title: "One", html: "<p>l</p>" }]);
    await decision(sessionId, new Date());
    // as migrated: approved, no reset recorded
    await setSession(sessionId, { status: "approved", approvalResetAt: null });
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.decisions.at(-1)!.binding).toBeNull();
    expect(s.currentApprovalId).toBe(s.decisions.at(-1)!.id);
    await design.setDesignSessionStatus(sessionId, "approved");
    await design.setDesignSessionStatus(sessionId, "building");
    expect((await design.getDesignSession(sessionId))!.status).toBe("building");
  });

  it("approve A then B: when B changes or goes, building is refused and never falls back to A", async () => {
    const { sessionId, ids, mockups } = await exploring("A then B", [
      { title: "A", html: "<p>A</p>" },
      { title: "B", html: "<p>B</p>" },
    ]);
    const approve = (n: number) =>
      design.recordDesignDecision({ sessionId, kind: "approval", summary: `Approved ${n}`, mockupId: ids[n] });
    await approve(0);
    await new Promise((r) => setTimeout(r, 5));
    await approve(1);
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).toBe(
      (await design.getDesignSession(sessionId))!.decisions.at(-1)!.id,
    );
    await tamper(ids[1], "<p>B edited</p>");
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/Ask for approval again/);
    // a newer approval that would be unbound, or names an unknown version, isn't recorded, so nothing older takes over
    await expect(design.recordDesignDecision({ sessionId, kind: "approval", summary: "x" })).rejects.toThrow(
      /mockupId/,
    );
    await expect(
      design.recordDesignDecision({ sessionId, kind: "approval", summary: "x", mockupId: crypto.randomUUID() }),
    ).rejects.toThrow(/No mockup version/);
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/Ask for approval again/);
    const { db: d, designMockups, eq } = await raw();
    await d.delete(designMockups).where(eq(designMockups.id, ids[1]));
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/Ask for approval again/);
    // A is untouched and still valid, yet it doesn't count: B is the newer approval
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.decisions.find((x) => x.binding?.mockupId === ids[0])!.binding!.status).toBe("bound");
    expect(s.decisions.find((x) => x.binding?.mockupId === ids[1])!.binding!.status).toBe("missing");
    expect(mockups[0].digest).toBe(design.mockupDigest("<p>A</p>"));
    expect((await design.getDesignSession(sessionId))!.status).toBe("approved");
  });

  it("approvals recorded at the same moment count only if they name the same version", async () => {
    const { sessionId, ids, mockups } = await exploring("Tie", [
      { title: "A", html: "<p>tA</p>" },
      { title: "B", html: "<p>tB</p>" },
    ]);
    const at = new Date();
    await decision(sessionId, at, { mockupId: ids[0], mockupDigest: mockups[0].digest });
    await decision(sessionId, at, { mockupId: ids[1], mockupDigest: mockups[1].digest });
    await setSession(sessionId, { status: "approved" }); // as recording an approval leaves it
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).toBeNull();
    await expect(design.setDesignSessionStatus(sessionId, "approved")).rejects.toThrow(/same moment/);
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/same moment/);
    // the same version twice at once is not ambiguous
    const same = await exploring("Tie same", [{ title: "A", html: "<p>tS</p>" }]);
    await decision(same.sessionId, at, { mockupId: same.ids[0], mockupDigest: same.mockups[0].digest });
    await decision(same.sessionId, at, { mockupId: same.ids[0], mockupDigest: same.mockups[0].digest });
    await setSession(same.sessionId, { status: "approved" });
    await design.setDesignSessionStatus(same.sessionId, "building");
    // and the pick doesn't depend on the order rows come back in
    const us = BigInt(at.getTime()) * 1000n;
    const rows = [
      { id: "b", at: us, mockupId: "x", mockupDigest: "1" },
      { id: "a", at: us, mockupId: "y", mockupDigest: "2" },
    ];
    expect(design.pickCurrentApproval(rows, null).approval).toBeNull();
    expect(design.pickCurrentApproval([...rows].reverse(), null).approval).toBeNull();
  });

  it("a reset and an approval keep the order they happened in, even before the clock moves on", async () => {
    // PGlite's now() moves in whole milliseconds, so a reset and an approval can share one. Placing the other event
    // a second ahead of now() stands for a clock that hasn't moved past it yet.
    const { sql } = await import("drizzle-orm");
    const { db: d } = await raw();

    // an approval recorded right after a reset counts
    const a = await exploring("After reset", [{ title: "A", html: "<p>ar</p>" }]);
    await d.execute(
      sql`update design_sessions set approval_reset_at = now() + interval '1 second' where id = ${a.sessionId}`,
    );
    await design.recordDesignDecision({
      sessionId: a.sessionId,
      kind: "approval",
      summary: "after",
      mockupId: a.ids[0],
    });
    expect((await design.getDesignSession(a.sessionId))!.currentApprovalId).not.toBeNull();
    await design.setDesignSessionStatus(a.sessionId, "building");

    // a reset made right after an approval ends it
    const b = await exploring("Before reset", [{ title: "A", html: "<p>br</p>" }]);
    await design.recordDesignDecision({
      sessionId: b.sessionId,
      kind: "approval",
      summary: "before",
      mockupId: b.ids[0],
    });
    await d.execute(
      sql`update design_decisions set created_at = now() + interval '1 second' where session_id = ${b.sessionId}`,
    );
    await design.setDesignSessionStatus(b.sessionId, "exploring"); // Reopen
    await design.setDesignSessionStatus(b.sessionId, "abandoned");
    await expect(design.setDesignSessionStatus(b.sessionId, "approved")).rejects.toThrow(/needs approving again/);

    // and approvals made one after another never tie: the newer one counts
    const c = await exploring("In a row", [
      { title: "A", html: "<p>r1</p>" },
      { title: "B", html: "<p>r2</p>" },
    ]);
    await design.recordDesignDecision({ sessionId: c.sessionId, kind: "approval", summary: "A", mockupId: c.ids[0] });
    await d.execute(
      sql`update design_decisions set created_at = now() + interval '1 second' where session_id = ${c.sessionId}`,
    );
    await design.recordDesignDecision({ sessionId: c.sessionId, kind: "approval", summary: "B", mockupId: c.ids[1] });
    const sc = (await design.getDesignSession(c.sessionId))!;
    expect(sc.decisions.find((x) => x.id === sc.currentApprovalId)!.binding!.mockupId).toBe(c.ids[1]);
  });

  it("times are compared in microseconds: moments in the same millisecond keep their order", async () => {
    // an approval 300 µs after the reset counts; one at the reset moment doesn't (a JS Date rounds both to one ms)
    const reset = 1_762_000_000_123_000n;
    const one = (id: string, at: bigint, v = "x") => ({ id, at, mockupId: v, mockupDigest: v });
    expect(design.pickCurrentApproval([one("a", reset + 300n)], reset).approval?.id).toBe("a");
    expect(design.pickCurrentApproval([one("a", reset)], reset).approval).toBeNull();
    // two approvals of different versions 1 µs apart: the newer one counts, in any order
    const rows = [one("old", reset + 500n, "x"), one("new", reset + 501n, "y")];
    expect(design.pickCurrentApproval(rows, reset).approval?.id).toBe("new");
    expect(design.pickCurrentApproval([...rows].reverse(), reset).approval?.id).toBe("new");
    // and in the database: a reset and an approval inside the same millisecond, in that order
    const { sessionId, ids, mockups } = await exploring("Same ms", [{ title: "A", html: "<p>ms</p>" }]);
    const { db: d, designSessions, designDecisions, eq } = await raw();
    const base = new Date();
    await d.update(designSessions).set({ status: "approved" }).where(eq(designSessions.id, sessionId));
    const { sql } = await import("drizzle-orm");
    await d.execute(
      sql`update design_sessions set approval_reset_at = ${base.toISOString()}::timestamptz + interval '100 microseconds' where id = ${sessionId}`,
    );
    await d.insert(designDecisions).values({
      sessionId,
      kind: "approval",
      summary: "approved 300 µs after the reset, in the same millisecond",
      mockupId: ids[0],
      mockupDigest: mockups[0].digest,
      createdAt: sql`${base.toISOString()}::timestamptz + interval '400 microseconds'` as unknown as Date,
    });
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).not.toBeNull();
    await design.setDesignSessionStatus(sessionId, "building");
  });

  it("after Reopen or a major change, older approvals stop counting: no approved, no building, until approved again", async () => {
    const { sessionId, ids, mockups } = await exploring("Reopen", [{ title: "A", html: "<p>r</p>" }]);
    await design.approveDesignMockup(ids[0], "", mockups[0].digest);
    await design.setDesignSessionStatus(sessionId, "exploring"); // Reopen
    for (const status of ["approved", "building"] as const)
      await expect(design.setDesignSessionStatus(sessionId, status)).rejects.toThrow(/needs approving again/);
    // abandon, then restore: the page restores to exploring, and approved is still refused
    await design.setDesignSessionStatus(sessionId, "abandoned");
    expect((await design.getDesignSession(sessionId))!.currentApprovalId).toBeNull();
    await expect(design.setDesignSessionStatus(sessionId, "approved")).rejects.toThrow(/needs approving again/);
    await design.setDesignSessionStatus(sessionId, "exploring");
    await design.approveDesignMockup(ids[0], "again", mockups[0].digest);
    await design.setDesignSessionStatus(sessionId, "building");

    const mc = await exploring("Major", [{ title: "A", html: "<p>m</p>" }]);
    await design.approveDesignMockup(mc.ids[0], "", mc.mockups[0].digest);
    await design.saveDesignBrief({
      sessionId: mc.sessionId,
      title: "Major",
      milestone: "major_change",
      markdown: "# v2",
    });
    await expect(design.setDesignSessionStatus(mc.sessionId, "building")).rejects.toThrow(/needs approving again/);
  });

  it("a legacy approval stops counting once the session is reset, and an approval at the reset moment never counts", async () => {
    const { sessionId } = await exploring("Legacy reset", [{ title: "One", html: "<p>lr</p>" }]);
    await decision(sessionId, new Date(Date.now() - 60_000));
    await setSession(sessionId, { status: "approved", approvalResetAt: null });
    await design.setDesignSessionStatus(sessionId, "exploring"); // Reopen
    await design.setDesignSessionStatus(sessionId, "abandoned");
    for (const status of ["approved", "building"] as const)
      await expect(design.setDesignSessionStatus(sessionId, status)).rejects.toThrow(/needs approving again/);

    const tie = await exploring("At the reset", [{ title: "One", html: "<p>at</p>" }]);
    const at = new Date(Date.now() - 1000);
    await decision(tie.sessionId, at, { mockupId: tie.ids[0], mockupDigest: tie.mockups[0].digest });
    await setSession(tie.sessionId, { status: "approved", approvalResetAt: at });
    expect((await design.getDesignSession(tie.sessionId))!.currentApprovalId).toBeNull();
    await expect(design.setDesignSessionStatus(tie.sessionId, "building")).rejects.toThrow(/needs approving again/);
  });

  it("the reset is stamped with the database's clock, the same clock as approvals", async () => {
    // PGlite runs in this process on the JS clock, so a skew between two clocks can't be simulated here; the source is
    // checked instead: every reset is written with the database's now(), never the app's Date.
    const src = await fs.readFile(path.resolve(__dirname, "../src/design.ts"), "utf8");
    expect(src).toContain("approvalResetAt: resetMoment(sessionId)");
    expect(src).toMatch(/const resetMoment = [\s\S]*?greatest\(now\(\)/);
    expect(src).not.toMatch(/approvalResetAt:\s*new Date/);
    const backupSrc = await fs.readFile(path.resolve(__dirname, "../src/backup.ts"), "utf8");
    expect(backupSrc).toContain("sql`now()`");
  });

  it("missing reset metadata can't weaken authorization: exploring has no approval, and a major change still resets", async () => {
    // a session reopened before resets were recorded: exploring, approvals, no reset
    const old = await exploring("Old reopen", [{ title: "One", html: "<p>or</p>" }]);
    await decision(old.sessionId, new Date(Date.now() - 60_000), {
      mockupId: old.ids[0],
      mockupDigest: old.mockups[0].digest,
    });
    await setSession(old.sessionId, { status: "exploring", approvalResetAt: null });
    expect((await design.getDesignSession(old.sessionId))!.currentApprovalId).toBeNull();
    for (const status of ["approved", "building"] as const)
      await expect(design.setDesignSessionStatus(old.sessionId, status)).rejects.toThrow(/approving again/);

    // a major change after the approval, with the reset lost (an old backup): the brief itself still resets it
    const mc = await exploring("Lost reset", [{ title: "One", html: "<p>lost</p>" }]);
    await design.approveDesignMockup(mc.ids[0], "", mc.mockups[0].digest);
    await design.saveDesignBrief({ sessionId: mc.sessionId, title: "x", milestone: "major_change", markdown: "# v2" });
    await setSession(mc.sessionId, { status: "abandoned", approvalResetAt: null });
    expect((await design.getDesignSession(mc.sessionId))!.currentApprovalId).toBeNull();
    await expect(design.setDesignSessionStatus(mc.sessionId, "approved")).rejects.toThrow(/needs approving again/);
  });

  it("no path into building without a current approval, whatever the status it comes from", async () => {
    const { sessionId } = await exploring("Direct", [{ title: "A", html: "<p>d</p>" }]);
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/no recorded approval/);
    await design.setDesignSessionStatus(sessionId, "abandoned");
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/no recorded approval/);
  });

  it("flipping a version's interactive flag changes its identity; a building session still reports the change", async () => {
    const { sessionId, ids, mockups } = await exploring("Flag", [{ title: "A", html: "<p>f</p>" }]);
    await design.approveDesignMockup(ids[0], "", mockups[0].digest);
    await design.setDesignSessionStatus(sessionId, "building");
    const { db: d, designMockups, eq } = await raw();
    await d.update(designMockups).set({ interactive: true }).where(eq(designMockups.id, ids[0]));
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.status).toBe("building");
    expect(s.decisions.at(-1)!.binding!.status).toBe("changed");
    await design.setDesignSessionStatus(sessionId, "done");
    await expect(design.setDesignSessionStatus(sessionId, "building")).rejects.toThrow(/Ask for approval again/);
  });

  it("another session's mockup can't confirm an approval, even when its digest matches", async () => {
    const one = await exploring("Mine", [{ title: "A", html: "<p>same</p>" }]);
    const other = await exploring("Theirs", [{ title: "A", html: "<p>same</p>" }]);
    // as a crafted or mixed-up backup could hold it: an approval in one session naming the other's version
    await decision(one.sessionId, new Date(), { mockupId: other.ids[0], mockupDigest: other.mockups[0].digest });
    await setSession(one.sessionId, { status: "approved" });
    expect((await design.getDesignSession(one.sessionId))!.decisions.at(-1)!.binding!.status).toBe("missing");
    await expect(design.setDesignSessionStatus(one.sessionId, "building")).rejects.toThrow(/No mockup version/);
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
