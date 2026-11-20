// The owner's feedback on mockups (docs/mockup-feedback-plan.md, Phase 2): stored only from PIVOT's own page, on a
// round of an exploring session, with pins on a version's render; a round answers it and may propose a DESIGN.md
// change, whose digest an approval of that round binds. Renders and pin crops use Chromium (skipped without it).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let design: typeof import("../src/design");
let feedback: typeof import("../src/design-feedback");
let capture: typeof import("../src/capture");
let backup: typeof import("../src/backup");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-feedback-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  design = await import("../src/design");
  feedback = await import("../src/design-feedback");
  capture = await import("../src/capture");
  backup = await import("../src/backup");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await capture.closeCaptureBrowser();
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

// A tall page with a red block at (100, 1200), so a crop around a pin there shows it; it overflows sideways by 40px,
// and the render is still cut to the width the pins are placed on.
const PAGE = `<!doctype html><html><body style="margin:0;background:#fff"><div style="width:calc(100vw + 40px);height:1px"></div>
<div style="height:1200px;background:linear-gradient(#eee,#ccc)"></div>
<div style="margin-left:100px;width:200px;height:120px;background:#d00"></div>
<div style="height:800px"></div></body></html>`;

async function sessionWithRound(title: string) {
  const { sessionId } = await design.saveDesignBrief({ title, milestone: "initial", markdown: `# ${title}` });
  const { ids } = await design.saveDesignMockups({
    sessionId,
    mockups: [
      { title: "One", html: PAGE },
      { title: "Two", html: PAGE.replace("#d00", "#00d") },
    ],
  });
  return { sessionId, ids };
}

describe("feedback", () => {
  it("is stored from PIVOT's page, refused with the API token, and checked against the round and version", async () => {
    const { sessionId, ids } = await sessionWithRound("Feedback rules");
    await expect(
      feedback.addFeedback({ sessionId, round: 1, text: "bigger", bearer: "Bearer abc" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(feedback.addFeedback({ sessionId, round: 1, text: "  " })).rejects.toThrow(/Write what to change/);
    await expect(feedback.addFeedback({ sessionId, round: 2, text: "x" })).rejects.toThrow(/no round 2/);
    await expect(
      feedback.addFeedback({ sessionId, round: 1, mockupId: crypto.randomUUID(), text: "x" }),
    ).rejects.toThrow(/isn't in this round/);
    // pins need a version and one of the page's widths, and must sit on the page
    await expect(
      feedback.addFeedback({ sessionId, round: 1, width: 1440, pins: [{ x: 1, y: 1, text: "a" }] }),
    ).rejects.toThrow(/say which/);
    await expect(
      feedback.addFeedback({ sessionId, round: 1, mockupId: ids[0], width: 1000, pins: [{ x: 1, y: 1, text: "a" }] }),
    ).rejects.toThrow(/1440, 834, 390/);
    await expect(
      feedback.addFeedback({ sessionId, round: 1, mockupId: ids[0], width: 390, pins: [{ x: 500, y: 1, text: "a" }] }),
    ).rejects.toThrow(/outside the page/);

    const round = await feedback.addFeedback({ sessionId, round: 1, text: "  Warmer overall  " });
    const pinned = await feedback.addFeedback({
      sessionId,
      round: 1,
      mockupId: ids[1],
      width: 1440,
      pins: [{ x: 200.4, y: 1260.6, text: " this block, smaller " }],
    });
    expect(round).toMatchObject({ round: 1, mockupId: null, text: "Warmer overall", pins: [], status: "open" });
    expect(pinned).toMatchObject({
      mockupId: ids[1],
      width: 1440,
      pins: [{ x: 200, y: 1261, text: "this block, smaller" }],
    });
    expect(pinned.mockupDigest).toMatch(/^[0-9a-f]{64}$/);
    const s = await design.getDesignSession(sessionId);
    expect(s?.feedback.map((f) => f.id)).toEqual([round.id, pinned.id]);
  });

  it("is answered by a round that names it, and a proposed DESIGN.md change binds to an approval of that round", async () => {
    const { sessionId } = await sessionWithRound("Answered");
    const fb = await feedback.addFeedback({ sessionId, round: 1, text: "Use the brand orange everywhere" });
    await expect(
      design.saveDesignMockups({
        sessionId,
        mockups: [{ title: "x", html: "<p>x</p>" }],
        addressesFeedback: [crypto.randomUUID()],
      }),
    ).rejects.toThrow(/doesn't have/);
    await expect(
      design.saveDesignMockups({
        sessionId,
        mockups: [{ title: "x", html: "<p>x</p>" }],
        designSystemChange: { summary: "", markdown: "x" },
      }),
    ).rejects.toThrow(/summary/);
    const change = { summary: "Accent becomes the brand orange", markdown: "## Colors\n\n- accent: #ff6a13" };
    const saved = await design.saveDesignMockups({
      sessionId,
      mockups: [{ title: "Orange", html: "<p>orange</p>" }],
      addressesFeedback: [fb.id],
      designSystemChange: change,
    });
    expect(saved).toMatchObject({ round: 2, created: true });
    // the same round again is the same round
    expect(
      await design.saveDesignMockups({
        sessionId,
        mockups: [{ title: "Orange", html: "<p>orange</p>" }],
        addressesFeedback: [fb.id],
        designSystemChange: change,
      }),
    ).toMatchObject({ round: 2, created: false });

    const s = await design.getDesignSession(sessionId);
    expect(s?.feedback[0]).toMatchObject({ id: fb.id, status: "addressed", addressedRound: 2 });
    expect(s?.rounds).toEqual([
      {
        round: 2,
        addressesFeedback: [fb.id],
        designSystemChange: { ...change, digest: design.designSystemDigest(change) },
        createdAt: expect.any(String),
      },
    ]);

    // an approval of a version of that round keeps the change's digest; one from round 1 has none
    const v2 = s!.mockups.find((m) => m.round === 2)!;
    await design.recordDesignDecision({
      sessionId,
      kind: "approval",
      source: "owner",
      summary: "approved",
      mockupId: v2.id,
      mockupDigest: v2.digest,
    });
    const after = await design.getDesignSession(sessionId);
    expect(after?.decisions.at(-1)?.binding).toMatchObject({
      mockupId: v2.id,
      status: "bound",
      designSystemDigest: design.designSystemDigest(change),
    });
    // and feedback stops once the session moved on
    await expect(feedback.addFeedback({ sessionId, round: 2, text: "more" })).rejects.toThrow(/approved/);
  });

  it("survives a backup and restore, with the change's digest recomputed", async () => {
    const { sessionId } = await sessionWithRound("Backed up");
    const fb = await feedback.addFeedback({ sessionId, round: 1, text: "keep" });
    await design.saveDesignMockups({
      sessionId,
      mockups: [{ title: "Kept", html: "<p>kept</p>" }],
      addressesFeedback: [fb.id],
      designSystemChange: { summary: "Radius 8", markdown: "radius: 8px" },
    });
    const made = await backup.createBackup({ targetDir: path.join(tmp, "backup") });
    const file = path.join(made.path, "data.json");
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    expect(data.designFeedback.some((f: { id: string }) => f.id === fb.id)).toBe(true);
    const round = data.designRounds.find((r: { sessionId: string }) => r.sessionId === sessionId);
    // a backup whose stored digest doesn't match its change: the digest is recomputed on restore
    round.designSystemDigest = "0".repeat(64);
    await fs.writeFile(file, JSON.stringify(data));
    const { designSessions } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await (await db.getDb()).delete(designSessions).where(eq(designSessions.id, sessionId));
    expect(await design.getDesignSession(sessionId)).toBeNull();
    await backup.restoreBackup(made.path);
    const s = (await design.getDesignSession(sessionId))!;
    expect(s.feedback).toMatchObject([{ id: fb.id, status: "addressed", addressedRound: 2 }]);
    expect(s.rounds[0].designSystemChange?.digest).toBe(
      design.designSystemDigest({ summary: "Radius 8", markdown: "radius: 8px" }),
    );
  });
});

describe.skipIf(!(await (await import("../src/capture")).playwrightStatus()).installed)("renders and pin crops", () => {
  it("renders a version at a page width once, and crops around a pin with its number drawn", async () => {
    const { sessionId, ids } = await sessionWithRound("Rendered");
    const first = await feedback.renderMockup(ids[0], 390);
    expect(first).toMatchObject({ width: 390 });
    const sharpMeta = (await import("sharp")).default;
    expect((await sharpMeta(first!.data).metadata()).width).toBe(390);
    expect(first!.height).toBeGreaterThanOrEqual(2100);
    // cached by digest and width: the second call reads the stored image
    const again = await feedback.renderMockup(ids[0], 390);
    expect(again!.data.equals(first!.data)).toBe(true);
    await expect(feedback.renderMockup(ids[0], 1000)).rejects.toThrow(/1440, 834, 390/);

    const fb = await feedback.addFeedback({
      sessionId,
      round: 1,
      mockupId: ids[0],
      width: 1440,
      pins: [
        { x: 200, y: 1260, text: "smaller" },
        { x: 5, y: 5, text: "corner" },
      ],
    });
    const crop = await feedback.pinImage(fb.id, 0);
    expect(crop).toMatchObject({ index: 0, mimeType: "image/jpeg", region: { width: 960, height: 720 } });
    // the pin sits inside the region, and the red block at (100–300, 1200–1320) is in it
    const { left, top, width, height } = crop!.region;
    expect(200 >= left && 200 <= left + width && 1260 >= top && 1260 <= top + height).toBe(true);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(crop!.data).raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / width;
    const at = (x: number, y: number) => {
      const i = (Math.round((y - top) * scale) * info.width + Math.round((x - left) * scale)) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [r, g, b] = at(280, 1300); // inside the red block, away from the marker
    expect(r).toBeGreaterThan(180);
    expect(g + b).toBeLessThan(120);
    // a pin in the corner keeps its crop inside the page
    expect((await feedback.pinImage(fb.id, 1))?.region).toMatchObject({ left: 0, top: 0 });
    expect(await feedback.pinImage(fb.id, 5)).toBeNull();
  }, 60_000);
});
