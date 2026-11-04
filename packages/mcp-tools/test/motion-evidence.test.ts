import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { AssetDTO, ResourceDetailDTO } from "@pivot/core/types";
import type { PivotSource } from "../src/source";
import { motionEvidenceOf, runTool, TOOLS } from "../src/tools";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const ID = "11111111-2222-4333-8444-555555555555";
const text = (r: Awaited<ReturnType<typeof runTool>>) =>
  r.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

const asset = (id: string, role: AssetDTO["role"], meta: Record<string, unknown> = {}, over: Partial<AssetDTO> = {}) =>
  ({
    id,
    kind: role === "motion-video" ? "video" : "image",
    role,
    fileName: `${id}.webp`,
    mimeType: role === "motion-video" ? "video/webm" : "image/webp",
    size: 1,
    width: role === "motion-video" ? null : 1440,
    height: role === "motion-video" ? null : 900,
    sourceUrl: null,
    notes: "",
    meta,
    createdAt: "2026-11-01T09:00:00.000Z",
    ...over,
  }) as AssetDTO;

const VIDEO_META = {
  method: "scroll-frames",
  colorScheme: "dark",
  capturedAt: "2026-11-01T09:00:00.000Z",
  viewport: { width: 1440, height: 900 },
  finalUrl: "https://linear.app/",
  durationMs: 12400,
};
const cover = asset("cover", "screenshot");
const video = asset("video", "motion-video", VIDEO_META);
// saved out of order on purpose
const keyframes = [
  asset("k2", "motion-keyframe", { keyframe: 2, scrollY: 1800, viewport: { width: 1440, height: 900 } }),
  asset("k0", "motion-keyframe", { keyframe: 0, scrollY: 0 }),
  asset("k1", "motion-keyframe", { keyframe: 1, scrollY: 900 }),
];
const states = [asset("s1", "state", { state: "Pricing toggle: Yearly" }), asset("s2", "state", {})];

const detail = (assets: AssetDTO[]): ResourceDetailDTO =>
  ({
    id: ID,
    type: "reference",
    title: "Linear",
    description: "",
    sourceUrl: "https://linear.app/",
    notes: "",
    content: "",
    meta: {},
    coverAssetId: "cover",
    captureStatus: "done",
    captureError: null,
    captureQuality: null,
    reviewStatus: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    tags: [],
    fullShot: null,
    collections: [],
    assets,
  }) as unknown as ResourceDetailDTO;

function sourceFor(assets: AssetDTO[]) {
  const fetched: string[] = [];
  const source = {
    search: async () => ({ results: [], total: 0, nextCursor: null, sort: "relevance" }),
    getResource: async (id: string) => (id === ID ? detail(assets) : null),
    listTags: async () => [],
    listCollections: async () => [],
    counts: async () => ({}),
    listSources: async () => [],
    getImage: async (assetId: string) => {
      fetched.push(assetId);
      return {
        data: await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#123456" } })
          .png()
          .toBuffer(),
        mimeType: "image/png",
      };
    },
  } as unknown as PivotSource;
  return { source, fetched };
}

describe("motionEvidenceOf", () => {
  it("a scroll recording is observed: provenance from the capture, keyframes in scroll order, honest limits", () => {
    const m = motionEvidenceOf(detail([cover, video, ...keyframes, ...states]));
    expect(m.classification).toBe("observed");
    expect(m.scope).toBe("scroll");
    expect(m.source).toEqual({
      kind: "pivot-scroll-recording",
      method: "scroll-frames",
      capturedAt: "2026-11-01T09:00:00.000Z",
      viewport: { width: 1440, height: 900 },
      finalUrl: "https://linear.app/",
    });
    expect(m.recording).toEqual({ assetId: "video", durationMs: 12400 });
    expect(m.keyframes.map((k) => [k.assetId, k.scrollY])).toEqual([
      ["k0", 0],
      ["k1", 900],
      ["k2", 1800],
    ]);
    expect(m.states).toEqual([
      { assetId: "s1", state: "Pricing toggle: Yearly" },
      { assetId: "s2", state: null },
    ]);
    const limits = m.limitations.join(" ");
    expect(limits).toContain("hover, click, focus and other triggers weren't exercised");
    expect(limits).toContain("Timing and easing weren't measured");
    expect(limits).toContain("can't be viewed through these tools");
    expect(limits).toContain("not how it animates");
  });

  it("no recording is unknown, never inferred, and nothing is made up", () => {
    const m = motionEvidenceOf(detail([cover, ...states]));
    expect(m).toMatchObject({ classification: "unknown", scope: null, source: null, recording: null, keyframes: [] });
    expect(m.statesTotal).toBe(2);
    expect(m.limitations[0]).toContain("any motion described for it is inferred unless observed live");
    expect(JSON.stringify(motionEvidenceOf(detail([cover])))).not.toMatch(/inferred"|easing":|duration":/);
  });

  it("keeps a half-missing recording observed but says what's missing", () => {
    const onlyFrames = motionEvidenceOf(detail([cover, ...keyframes]));
    expect(onlyFrames.classification).toBe("observed");
    expect(onlyFrames.recording).toBeNull();
    expect(onlyFrames.limitations.join(" ")).toContain("video is missing");
    const onlyVideo = motionEvidenceOf(detail([cover, video]));
    expect(onlyVideo.keyframesTotal).toBe(0);
    expect(onlyVideo.limitations.join(" ")).toContain("No keyframes were kept");
  });

  it("ignores files that are gone and malformed metadata instead of guessing", () => {
    const m = motionEvidenceOf(
      detail([
        asset("v", "motion-video", { durationMs: "12s", viewport: { width: "wide" }, capturedAt: 7 }),
        asset("gone", "motion-keyframe", { scrollY: 0 }, { missing: true }),
        asset("k", "motion-keyframe", { scrollY: "900" }),
      ]),
    );
    expect(m.recording).toEqual({ assetId: "v", durationMs: null });
    expect(m.source?.viewport).toBeNull();
    expect(m.source?.capturedAt).toBe("2026-11-01T09:00:00.000Z"); // the asset's own date, not the bad value
    expect(m.keyframes).toEqual([{ assetId: "k", index: null, scrollY: null, width: 1440, height: 900 }]);
  });

  it("caps the lists to keep replies small, and reports the totals", () => {
    const many = Array.from({ length: 20 }, (_, i) => asset(`k${i}`, "motion-keyframe", { scrollY: i * 100 }));
    const m = motionEvidenceOf(detail([video, ...many]));
    expect(m.keyframes).toHaveLength(12);
    expect(m.keyframesTotal).toBe(20);
  });
});

describe("get_reference motion evidence", () => {
  it("adds motionEvidence and a Motion line, leaving the other fields as they were", async () => {
    const { source } = sourceFor([cover, video, ...keyframes]);
    const r = await runTool(tool("get_reference"), source, { id: ID });
    const out = r.structuredContent as Record<string, unknown>;
    expect(out.motionEvidence).toMatchObject({ classification: "observed", keyframesTotal: 3 });
    // keyframes are still listed among the screenshots, as before
    expect((out.screenshots as { role: string }[]).map((s) => s.role)).toEqual([
      "cover",
      "motion keyframe",
      "motion keyframe",
      "motion keyframe",
    ]);
    expect(text(r)).toContain(
      "Motion: observed while scrolling (PIVOT scroll recording, 12.4 s, 1440×900, 2026-11-01).",
    );
    expect(text(r)).toContain("3 keyframes at scroll 0–1800px: get_reference_images which=keyframes.");
  });

  it("says unknown for a reference without a recording (every reference saved before motion capture)", async () => {
    const { source } = sourceFor([cover]);
    const r = await runTool(tool("get_reference"), source, { id: ID });
    expect((r.structuredContent as { motionEvidence: unknown }).motionEvidence).toMatchObject({
      classification: "unknown",
    });
    expect(text(r)).toContain("Motion: unknown (PIVOT holds no recording).");
  });
});

describe("get_reference_images keyframes and states", () => {
  it("sends keyframes in scroll order, labelled as observed stills, pages with fromSlice, fetches only this reference's files", async () => {
    const { source, fetched } = sourceFor([cover, video, ...keyframes, ...states]);
    const r = await runTool(tool("get_reference_images"), source, { id: ID, which: "keyframes", maxImages: 2 });
    expect(r.content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(text(r)).toContain("Keyframe 1 of 3 at scroll 0px (observed, PIVOT scroll recording)");
    expect(text(r)).toContain("Keyframe 2 of 3 at scroll 900px");
    expect(text(r)).toContain("Call again with fromSlice 2");
    expect(text(r)).toContain("Timing and easing weren't measured");
    expect(r.structuredContent).toEqual({
      which: "keyframes",
      classification: "observed",
      total: 3,
      returned: ["k0", "k1"],
    });
    const rest = await runTool(tool("get_reference_images"), source, { id: ID, which: "keyframes", fromSlice: 2 });
    expect(rest.structuredContent).toMatchObject({ returned: ["k2"] });
    expect(fetched).toEqual(["k0", "k1", "k2"]);
  });

  it("sends interaction-state stills, never calling them motion", async () => {
    const { source } = sourceFor([cover, ...states]);
    const r = await runTool(tool("get_reference_images"), source, { id: ID, which: "states" });
    expect(r.content.filter((c) => c.type === "image")).toHaveLength(2);
    expect(text(r)).toContain("State 1 of 2: Pricing toggle: Yearly (a still: how the state looks, not how it moves)");
    expect(r.structuredContent).toMatchObject({ which: "states", classification: null });
  });

  it("says plainly when there is no evidence", async () => {
    const { source } = sourceFor([cover]);
    const k = await runTool(tool("get_reference_images"), source, { id: ID, which: "keyframes" });
    expect(k.isError).toBe(true);
    expect(text(k)).toContain("no motion keyframes: its motion evidence is unknown");
    const s = await runTool(tool("get_reference_images"), source, { id: ID, which: "states" });
    expect(s.structuredContent).toMatchObject({ error: { code: "no_images" } });
  });

  it("rejects bad input and unknown references", async () => {
    const { source } = sourceFor([cover, video, ...keyframes]);
    for (const input of [
      { id: ID, which: "video" },
      { id: "not-a-uuid", which: "keyframes" },
      { id: ID, which: "keyframes", fromSlice: 21 },
      { id: ID, which: "keyframes", maxImages: 5 },
    ]) {
      expect(
        (await runTool(tool("get_reference_images"), source, input)).structuredContent,
        JSON.stringify(input),
      ).toMatchObject({
        error: { code: "invalid_input" },
      });
    }
    const other = await runTool(tool("get_reference_images"), source, {
      id: "99999999-2222-4333-8444-555555555555",
      which: "keyframes",
    });
    expect(other.structuredContent).toMatchObject({ error: { code: "not_found" } });
  });

  it("leaves cover, fullpage and all as they were", async () => {
    const { source, fetched } = sourceFor([cover, video, ...keyframes]);
    const r = await runTool(tool("get_reference_images"), source, { id: ID });
    expect(fetched).toEqual(["cover"]);
    expect(r.structuredContent).toBeUndefined();
  });
});
