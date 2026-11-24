// The MCP side of mockup feedback (docs/mockup-feedback-plan.md, Phase 2): a round names the feedback it answers and
// the DESIGN.md change it proposes; get_design_session shows open feedback and what an approval binds; and
// get_feedback_images shows each pin's crop with its note.
import { describe, expect, it } from "vitest";
import type { DesignFeedbackDTO, DesignSessionDetailDTO } from "@pivot/core/types";
import type { PivotSource, PivotWriter } from "../src/source";
import { runTool } from "../src/tools";
import { WRITE_TOOLS } from "../src/write-tools";

const SID = "11111111-2222-4333-8444-555555555555";
const FID = "22222222-3333-4444-8555-666666666666";
const tool = (name: string) => WRITE_TOOLS.find((t) => t.name === name)!;

const feedback: DesignFeedbackDTO = {
  id: FID,
  sessionId: SID,
  round: 1,
  mockupId: "m2",
  mockupDigest: "d".repeat(64),
  text: "Warmer, please",
  width: 1440,
  pins: [
    { x: 200, y: 1260, text: "this block, smaller" },
    { x: 900, y: 40, text: "nav too loud" },
  ],
  status: "open",
  addressedRound: null,
  createdAt: "2026-11-20T00:00:00.000Z",
};

const session: DesignSessionDetailDTO = {
  id: SID,
  title: "Pricing",
  targetProject: "ledgerly",
  surface: "pricing page",
  status: "exploring",
  approvalResetAt: null,
  createdAt: "",
  updatedAt: "",
  currentApprovalId: null,
  currentQaId: null,
  snapshots: [],
  decisions: [],
  mockups: [
    {
      id: "m1",
      sessionId: SID,
      snapshotId: null,
      round: 1,
      n: 1,
      title: "One",
      interactive: false,
      digest: "a".repeat(64),
      createdAt: "",
    },
    {
      id: "m2",
      sessionId: SID,
      snapshotId: null,
      round: 1,
      n: 2,
      title: "Two",
      interactive: false,
      digest: "d".repeat(64),
      createdAt: "",
    },
  ],
  candidates: [],
  feedback: [feedback, { ...feedback, id: "f-old", pins: [], text: "Earlier", status: "addressed", addressedRound: 1 }],
  rounds: [
    {
      round: 1,
      addressesFeedback: ["f-old"],
      designSystemChange: {
        summary: "Accent becomes orange",
        markdown: "## Colors\n- accent: #ff6a13",
        digest: "c".repeat(64),
      },
      createdAt: "",
    },
  ],
};

function source(extra: Partial<PivotWriter> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    <T>(method: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return value;
    };
  const reader = {
    search: async () => ({ results: [], total: 0, nextCursor: null, sort: "relevance" as const }),
    getResource: async () => null,
    listTags: async () => [],
    listCollections: async () => [],
    counts: async () => ({}),
    listSources: async () => [],
    agentImage: async () => ({ data: Buffer.alloc(0), mimeType: "image/jpeg" as const, width: 0, height: 0 }),
    agentSlices: async () => ({ slices: [], total: 0, pageWidth: 0, pageHeight: 0 }),
  } satisfies PivotSource;
  const writer: PivotWriter = {
    saveDesignBrief: rec("saveDesignBrief", { sessionId: SID, snapshotId: "s", created: true, duplicate: false }),
    recordDesignDecision: rec("recordDesignDecision", { id: "d" }),
    saveDesignMockups: rec("saveDesignMockups", { round: 2, ids: ["n1"], created: true }),
    appUrl: "http://127.0.0.1:4321",
    getDesignSession: rec("getDesignSession", session),
    setDesignStatus: rec("setDesignStatus", null as never),
    listDesignSessions: rec("listDesignSessions", []),
    addSuggestions: rec("addSuggestions", { added: [], skipped: [] }),
    annotate: rec("annotate", { line: "" }),
    saveReference: rec("saveReference", { id: SID, path: "", title: "" }),
    ...extra,
  };
  return { src: { ...reader, ...writer }, calls };
}

const textOf = (res: Awaited<ReturnType<typeof runTool>>) =>
  res.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { text: string }).text)
    .join("\n");

describe("mockup feedback over MCP", () => {
  it("saves a round with the feedback it answers and the DESIGN.md change it proposes", async () => {
    const { src, calls } = source();
    const change = { summary: "Accent becomes orange", markdown: "## Colors\n- accent: #ff6a13" };
    const res = await runTool(tool("save_design_mockups"), src, {
      sessionId: SID,
      mockups: [{ title: "Warm", html: "<p>w</p>" }],
      addressesFeedback: [FID],
      designSystemChange: change,
    });
    expect(res.isError).toBeFalsy();
    expect(calls.find((c) => c.method === "saveDesignMockups")!.args[1]).toMatchObject({
      addressesFeedback: [FID],
      designSystemChange: change,
    });
    expect(textOf(res)).toMatch(/Answers 1 piece of the user's feedback/);
    expect(textOf(res)).toMatch(/only after the user approves a version of this round, exactly as proposed/);
    // without them, nothing extra is sent (an older app keeps working)
    const plain = source();
    await runTool(tool("save_design_mockups"), plain.src, {
      sessionId: SID,
      mockups: [{ title: "x", html: "<p>x</p>" }],
    });
    expect(Object.keys(plain.calls[0].args[1] as object).sort()).toEqual(["mockups", "snapshotId"]);
  });

  it("shows open feedback, what each round answers and proposes, and the change an approval binds", async () => {
    const approved: DesignSessionDetailDTO = {
      ...session,
      decisions: [
        {
          id: "a1",
          sessionId: SID,
          kind: "approval",
          summary: "approved",
          direction: "Version 2: Two (round 1)",
          details: "",
          source: "owner",
          binding: { mockupId: "m2", digest: "d".repeat(64), status: "bound", designSystemDigest: "c".repeat(64) },
          createdAt: "",
        },
      ],
    };
    const { src } = source({ getDesignSession: async () => approved });
    const out = textOf(await runTool(tool("get_design_session"), src, { sessionId: SID }));
    expect(out).toMatch(/1 open\. Answer it with a new round \(save_design_mockups with addressesFeedback\)/);
    expect(out).toContain(`OPEN · id ${FID} · round 1, version 2 "Two" at 1440px: "Warmer, please"`);
    expect(out).toContain('1. at (200, 1260) "this block, smaller"');
    expect(out).toContain("answered by round 1 · id f-old");
    expect(out).toMatch(
      /Round 1 answers feedback f-old; proposes a DESIGN\.md change \(digest cccccccccccc\): Accent becomes orange/,
    );
    expect(out).toMatch(
      /Approved with its round's DESIGN\.md change \(digest cccccccccccc\): write exactly that change/,
    );
  });

  it("shows each pin's crop with its note, a few at a time", async () => {
    const asked: number[] = [];
    const { src } = source({
      getFeedback: async (id) => (id === FID ? feedback : null),
      feedbackPinImage: async (_id, i) => {
        asked.push(i);
        return {
          data: Buffer.from("jpg"),
          mimeType: "image/jpeg",
          width: 960,
          height: 720,
          region: { left: 0, top: 900, width: 960, height: 720 },
        };
      },
    });
    const res = await runTool(tool("get_feedback_images"), src, { feedbackId: FID, maxImages: 1 });
    expect(res.isError).toBeFalsy();
    expect(asked).toEqual([0]);
    expect(res.content.filter((c) => c.type === "image")).toHaveLength(1);
    expect(textOf(res)).toContain('Pin 1 at (200, 1260): "this block, smaller" (shows x 0–960, y 900–1620)');
    expect(textOf(res)).toMatch(/More pins: call again with fromPin 1/);
    // an unknown id, and an app that predates feedback
    expect((await runTool(tool("get_feedback_images"), src, { feedbackId: SID })).isError).toBe(true);
    const old = await runTool(tool("get_feedback_images"), source().src, { feedbackId: FID });
    expect(textOf(old)).toMatch(/predates mockup feedback/);
  });

  it("names an element pin by its tag, text and selector, and gives its HTML with the crop", async () => {
    const element = {
      selector: "main > section.hero > a.btn.primary",
      tag: "a",
      classes: ["btn", "primary"],
      text: "Start free",
      box: { x: 120, y: 480, w: 160, h: 48 },
      html: '<a class="btn primary" href="#">Start free</a>',
    };
    const withElement: DesignFeedbackDTO = {
      ...feedback,
      pins: [{ x: 200, y: 500, text: "make this the outline style", n: 3, element }],
    };
    const { src } = source({
      getDesignSession: async () => ({ ...session, feedback: [withElement] }),
      getFeedback: async () => withElement,
      feedbackPinImage: async () => ({
        data: Buffer.from("jpg"),
        mimeType: "image/jpeg",
        width: 960,
        height: 720,
        region: { left: 0, top: 120, width: 960, height: 720 },
      }),
    });
    const place =
      'on element a.btn.primary "Start free" (selector `main > section.hero > a.btn.primary`, box 120,480 160×48)';
    const out = textOf(await runTool(tool("get_design_session"), src, { sessionId: SID }));
    expect(out).toContain(`3. ${place} "make this the outline style"`);
    const images = textOf(await runTool(tool("get_feedback_images"), src, { feedbackId: FID }));
    expect(images).toContain(`Pin 3 ${place}: "make this the outline style"`);
    expect(images).toContain('```html\n<a class="btn primary" href="#">Start free</a>\n```');
  });

  it("marks a live note as seen in the preview with scripts running", async () => {
    const live: DesignFeedbackDTO = {
      ...feedback,
      pins: [
        {
          x: 300,
          y: 900,
          text: "the open menu",
          n: 1,
          live: true,
          element: { selector: "nav > ul.menu", tag: "ul", classes: ["menu"], box: { x: 280, y: 880, w: 240, h: 300 } },
          capture: { sha256: "a".repeat(64), region: { left: 0, top: 700, width: 960, height: 720 } },
        },
        {
          x: 10,
          y: 10,
          text: "spot",
          n: 2,
          live: true,
          capture: { sha256: "b".repeat(64), region: { left: 0, top: 0, width: 960, height: 720 } },
        },
      ],
    };
    const { src } = source({ getDesignSession: async () => ({ ...session, feedback: [live] }) });
    const out = textOf(await runTool(tool("get_design_session"), src, { sessionId: SID }));
    expect(out).toContain(
      "1. on element ul.menu (selector `nav > ul.menu`, box 280,880 240×300) [live: seen in the preview with scripts running]",
    );
    expect(out).toContain("2. at (10, 10) [live: seen in the preview with scripts running]");
  });
});
