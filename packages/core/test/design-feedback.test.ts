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

  it("keeps each pin's number as the owner saw it, gaps included, and refuses two pins with one number", async () => {
    const { sessionId, ids } = await sessionWithRound("Pin numbers");
    const fb = await feedback.addFeedback({
      sessionId,
      round: 1,
      mockupId: ids[0],
      width: 1440,
      pins: [
        { n: 1, x: 10, y: 10, text: "a" },
        { n: 3, x: 20, y: 20, text: "c" },
        { x: 30, y: 30, text: "no number: its place" },
      ],
    });
    expect(fb.pins.map((p) => p.n)).toEqual([1, 3, 4]);
    await expect(
      feedback.addFeedback({
        sessionId,
        round: 1,
        mockupId: ids[0],
        width: 1440,
        pins: [
          { n: 2, x: 1, y: 1, text: "a" },
          { n: 2, x: 2, y: 2, text: "b" },
        ],
      }),
    ).rejects.toThrow(/same number/);
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

  // A page with what the Select tool must handle: ids (one duplicated), same-tag siblings, an svg, hidden and tiny
  // elements, a long attribute and a script that must not run.
  const EL_PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<header class="top"><nav><a href="#" title="${"t".repeat(300)}">Home</a><button id="cta">Sign up</button></nav></header>
<main><section class="hero"><h1>Hello</h1><p id="dup">One</p><p id="dup">Two</p>
<a class="btn primary" href="#">First</a><a class="btn primary" href="#" style="display:inline-block;margin-left:400px;padding:20px">Second</a>
<svg width="40" height="40"><path d="M0 0L40 40"/></svg>
<div style="visibility:hidden;height:30px">hidden</div><span style="display:inline-block;width:2px;height:2px"></span>
</section></main>
<script>const d = document.createElement("div"); d.id = "injected"; d.style.height = "50px"; document.body.append(d);</script>
</body></html>`;

  it("maps a version's elements with selectors that find exactly them, and keeps the map with the render", async () => {
    const { sessionId } = await design.saveDesignBrief({ title: "Elements", milestone: "initial", markdown: "# E" });
    const { ids } = await design.saveDesignMockups({ sessionId, mockups: [{ title: "One", html: EL_PAGE }] });
    const map = (await feedback.mockupElements(ids[0], 1440))!;
    const tags = map.map((e) => e.tag);
    expect(tags).toEqual(expect.arrayContaining(["header", "nav", "a", "button", "main", "section", "h1", "p", "svg"]));
    expect(tags).not.toContain("path"); // nothing inside an svg
    expect(tags).not.toContain("script");
    expect(map.find((e) => e.id === "injected")).toBeUndefined(); // the page's script never ran
    expect(map.find((e) => e.text === "hidden")).toBeUndefined();
    expect(map.every((e) => e.w >= 4 && e.h >= 4 && e.x + e.w <= 1440)).toBe(true);
    const cta = map.find((e) => e.id === "cta")!;
    expect(cta).toMatchObject({ tag: "button", sel: "#cta", text: "Sign up" });
    expect(map[cta.p].tag).toBe("nav");
    // a duplicated id isn't a selector; same-tag siblings are told apart
    const second = map.find((e) => e.text === "Second")!;
    expect(second.sel).toMatch(/a\.btn\.primary:nth-of-type\(2\)$/);
    expect(map.find((e) => e.text === "Two")!.sel).not.toMatch(/#dup/);
    // every selector finds exactly one element in the version's HTML
    const htmls = await capture.elementsHtml(
      EL_PAGE,
      map.map((e) => e.sel),
      { width: 1440 },
    );
    expect(htmls.every((h) => h !== null)).toBe(true);
    // kept next to the render; a render made before maps existed is made again with its map
    const store = feedback.renderStore();
    const { digest } = (await design.getDesignSession(sessionId))!.mockups[0];
    expect(await store.get(feedback.elementsStoreKey(digest, 1440))).toBeTruthy();
    await store.delete(feedback.elementsStoreKey(digest, 1440));
    expect((await feedback.mockupElements(ids[0], 1440))!.length).toBe(map.length);
    await expect(feedback.mockupElements(ids[0], 1000)).rejects.toThrow(/1440, 834, 390/);
    expect(await feedback.mockupElements("00000000-0000-4000-8000-000000000000", 1440)).toBeNull();
  }, 60_000);

  it("stores an element pin from PIVOT's own map, with its HTML trimmed, and crops it outlined", async () => {
    const { sessionId } = await design.saveDesignBrief({ title: "Element pin", milestone: "initial", markdown: "# P" });
    const { ids } = await design.saveDesignMockups({ sessionId, mockups: [{ title: "One", html: EL_PAGE }] });
    const map = (await feedback.mockupElements(ids[0], 1440))!;
    const second = map.find((e) => e.text === "Second")!;
    const home = map.find((e) => e.text === "Home")!;
    const svg = map.find((e) => e.tag === "svg")!;
    const fb = await feedback.addFeedback({
      sessionId,
      round: 1,
      mockupId: ids[0],
      width: 1440,
      pins: [
        // a point outside the element moves to its centre
        { x: 1, y: 1, text: "outline style", n: 2, element: { selector: second.sel } },
        { x: home.x + 2, y: home.y + 2, text: "rename", element: { selector: home.sel } },
        { x: svg.x + 1, y: svg.y + 1, text: "bigger icon", element: { selector: svg.sel } },
        { x: 10, y: 10, text: "a plain spot" },
      ],
    });
    const [p2, pHome, pSvg, plain] = fb.pins;
    expect(p2).toMatchObject({
      n: 2,
      x: Math.round(second.x + second.w / 2),
      y: Math.round(second.y + second.h / 2),
      element: { selector: second.sel, tag: "a", classes: ["btn", "primary"], text: "Second" },
    });
    expect(p2.element!.box).toEqual({ x: second.x, y: second.y, w: second.w, h: second.h });
    expect(p2.element!.html).toMatch(/^<a class="btn primary"[^>]*>Second<\/a>$/);
    expect(pHome).toMatchObject({ x: home.x + 2, y: home.y + 2 });
    expect(pHome.element!.html).toContain(`title="${"t".repeat(120)}…"`); // a long attribute is cut
    expect(pSvg.element!.html).toBe('<svg width="40" height="40">…</svg>');
    expect(plain.element).toBeUndefined();
    // the page never says what the element is: only a selector PIVOT's map has is accepted
    await expect(
      feedback.addFeedback({
        sessionId,
        round: 1,
        mockupId: ids[0],
        width: 1440,
        pins: [{ x: 5, y: 5, text: "x", element: { selector: "body > div.nope" } }],
      }),
    ).rejects.toThrow(/Pin 1's element isn't on this version at 1440px/);

    // the crop shows the whole element outlined in ember, with room around it
    const crop = (await feedback.pinImage(fb.id, 0))!;
    const { left, top, width, height } = crop.region;
    expect(second.x >= left && second.x + second.w <= left + width).toBe(true);
    expect(second.y >= top && second.y + second.h <= top + height).toBe(true);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(crop.data).raw().toBuffer({ resolveWithObject: true });
    const scale = info.width / width;
    const at = (x: number, y: number) => {
      const i = (Math.round((y - top) * scale) * info.width + Math.round((x - left) * scale)) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [r, g, b] = at(second.x + second.w + 2, second.y + second.h / 2 + 10); // on the right edge's outline
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(60);
    expect(g).toBeLessThan(160);
    expect(b).toBeLessThan(80);
  }, 60_000);

  it("keeps the shallowest elements of a page with too many, parents renumbered", () => {
    const raw = [
      { parent: -1, depth: 0, tag: "main", x: 0, y: 0, w: 10, h: 10, sel: "main" },
      { parent: 0, depth: 1, tag: "div", x: 0, y: 0, w: 10, h: 10, sel: "main > div" },
      { parent: 1, depth: 2, tag: "span", x: 0, y: 0, w: 10, h: 10, sel: "main > div > span" },
      { parent: -1, depth: 0, tag: "footer", x: 0, y: 0, w: 10, h: 10, sel: "footer" },
    ];
    expect(capture.trimMap(raw, 3).map((e) => [e.i, e.p, e.tag])).toEqual([
      [0, -1, "main"],
      [1, 0, "div"],
      [2, -1, "footer"],
    ]);
  });
});
