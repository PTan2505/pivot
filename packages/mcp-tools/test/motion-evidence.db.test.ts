// Motion evidence end to end through the real data model: references and assets saved the way capture saves them
// (PGlite in a temp folder), read back by the MCP tools through a PIVOT source backed by core.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PivotSource } from "../src/source";
import { runTool, TOOLS } from "../src/tools";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const text = (r: Awaited<ReturnType<typeof runTool>>) =>
  r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

let tmp: string;
let resources: typeof import("@pivot/core/resources");
let assets: typeof import("@pivot/core/assets");
let db: typeof import("@pivot/core/db/client");
let source: PivotSource;
let recordedId: string;
let olderId: string;

const webp = (shade: string) =>
  sharp({ create: { width: 1440, height: 900, channels: 3, background: shade } })
    .webp()
    .toBuffer();

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-motion-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../../core/src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  resources = await import("@pivot/core/resources");
  assets = await import("@pivot/core/assets");
  db = await import("@pivot/core/db/client");

  source = {
    search: async () => ({ results: [], total: 0, nextCursor: null, sort: "relevance" }),
    getResource: (id) => resources.getResource(id),
    listTags: async () => [],
    listCollections: async () => [],
    counts: async () => ({}),
    listSources: async () => [],
    getImage: async (assetId) => {
      const row = await assets.getAsset(assetId);
      if (!row) throw new Error("missing asset");
      return { data: await assets.readAssetBytes(row), mimeType: row.mimeType };
    },
  } as PivotSource;

  // A reference recorded with motion, saved the way capture saves it (capture.ts, captureExtras).
  const recorded = await resources.createResource({
    type: "reference",
    title: "Linear",
    sourceUrl: "https://linear.app/",
  });
  recordedId = recorded.id;
  const meta = (extra: Record<string, unknown>) => ({
    method: "scroll-frames",
    colorScheme: "dark",
    capturedAt: "2026-11-01T09:00:00.000Z",
    ...extra,
  });
  const cover = await assets.saveAsset({ data: await webp("#101010"), fileName: "linear.webp", meta: meta({}) });
  await assets.attachAsset(recordedId, cover.id, "screenshot");
  const video = await assets.saveAsset({
    data: Buffer.from("not really a video"),
    fileName: "linear-motion.webm",
    mimeType: "video/webm",
    meta: meta({ viewport: { width: 1440, height: 900 }, finalUrl: "https://linear.app/", durationMs: 9800 }),
  });
  await assets.attachAsset(recordedId, video.id, "motion-video");
  for (const [i, scrollY] of [1800, 0, 900].entries()) {
    const frame = await assets.saveAsset({
      data: await webp(["#202020", "#303030", "#404040"][i]),
      fileName: `linear-keyframe-${i}.webp`,
      meta: meta({ keyframe: i + 1, scrollY, viewport: { width: 1440, height: 900 } }),
    });
    await assets.attachAsset(recordedId, frame.id, "motion-keyframe");
  }
  const state = await assets.saveAsset({
    data: await webp("#505050"),
    fileName: "state.webp",
    meta: { state: "Menu open" },
  });
  await assets.attachAsset(recordedId, state.id, "state");

  // A reference saved before motion capture existed: a screenshot and nothing else.
  const older = await resources.createResource({
    type: "reference",
    title: "Stripe",
    sourceUrl: "https://stripe.com/",
  });
  olderId = older.id;
  const shot = await assets.saveAsset({ data: await webp("#606060"), fileName: "stripe.webp" });
  await assets.attachAsset(olderId, shot.id, "screenshot");
}, 120_000);

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("motion evidence through the real data model", () => {
  it("get_reference reads the recording's provenance and keyframes from the saved assets", async () => {
    const r = await runTool(tool("get_reference"), source, { id: recordedId });
    const m = (r.structuredContent as { motionEvidence: Record<string, unknown> }).motionEvidence;
    expect(m).toMatchObject({
      classification: "observed",
      scope: "scroll",
      source: {
        kind: "pivot-scroll-recording",
        method: "scroll-frames",
        capturedAt: "2026-11-01T09:00:00.000Z",
        viewport: { width: 1440, height: 900 },
        finalUrl: "https://linear.app/",
      },
      recording: { durationMs: 9800 },
      keyframesTotal: 3,
      statesTotal: 1,
    });
    expect((m.keyframes as { scrollY: number }[]).map((k) => k.scrollY)).toEqual([0, 900, 1800]);
    expect(text(r)).toContain(
      "Motion: observed while scrolling (PIVOT scroll recording, 9.8 s, 1440×900, 2026-11-01).",
    );
  }, 30_000);

  it("get_reference_images sends the stored keyframes in scroll order", async () => {
    const r = await runTool(tool("get_reference_images"), source, { id: recordedId, which: "keyframes", maxImages: 4 });
    expect(r.content.filter((c) => c.type === "image")).toHaveLength(3);
    expect(text(r)).toMatch(
      /Keyframe 1 of 3 at scroll 0px[\s\S]*Keyframe 2 of 3 at scroll 900px[\s\S]*Keyframe 3 of 3 at scroll 1800px/,
    );
    const states = await runTool(tool("get_reference_images"), source, { id: recordedId, which: "states" });
    expect(text(states)).toContain("State 1 of 1: Menu open");
  }, 30_000);

  it("an older reference without a recording reads as unknown, and its screenshots are unchanged", async () => {
    const r = await runTool(tool("get_reference"), source, { id: olderId });
    expect(r.structuredContent).toMatchObject({
      motionEvidence: { classification: "unknown", keyframesTotal: 0 },
      screenshots: [{ role: "viewport" }], // as before: no cover chosen, so the screenshot is the viewport
    });
    expect((await runTool(tool("get_reference_images"), source, { id: olderId })).isError).toBeFalsy();
    expect(
      (await runTool(tool("get_reference_images"), source, { id: olderId, which: "keyframes" })).structuredContent,
    ).toMatchObject({
      error: { code: "no_images" },
    });
  }, 30_000);
});
