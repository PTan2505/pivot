import { describe, expect, it } from "vitest";
import type { PivotSource, PivotWriter } from "../src/source";
import { runTool } from "../src/tools";
import { WRITE_TOOLS } from "../src/write-tools";

const ID = "11111111-2222-4333-8444-555555555555";
const tool = (name: string) => WRITE_TOOLS.find((t) => t.name === name)!;

const reader: PivotSource = {
  search: async () => ({ results: [], total: 0, nextCursor: null, sort: "relevance" }),
  getResource: async () => null,
  listTags: async () => [],
  listCollections: async () => [
    { id: "c1", name: "Pricing pages", description: "", count: 1, createdAt: "", updatedAt: "" },
  ],
  counts: async () => ({}),
  listSources: async () => [],
  getImage: async () => ({ data: Buffer.alloc(0), mimeType: "image/png" }),
};

function writerSource() {
  const calls: { method: string; args: unknown[] }[] = [];
  const rec =
    <T>(method: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return value;
    };
  const writer: PivotWriter = {
    saveDesignBrief: rec("saveDesignBrief", { sessionId: ID, snapshotId: "s1", created: true, duplicate: false }),
    recordDesignDecision: rec("recordDesignDecision", { id: "d1" }),
    getDesignSession: rec("getDesignSession", null),
    listDesignSessions: rec("listDesignSessions", []),
    addSuggestions: rec("addSuggestions", {
      added: [
        {
          id: "x",
          resourceId: ID,
          kind: "facet" as const,
          value: { kind: "visualStyle", name: "Dark", existing: true },
          reason: "",
          source: "agent",
          status: "pending" as const,
          createdAt: "",
        },
      ],
      skipped: [{ kind: "title", value: {}, why: "already suggested" }],
    }),
    annotate: rec("annotate", { line: "agent (2026-11-01): ok" }),
    saveReference: rec("saveReference", { id: ID, path: `/r/${ID}`, title: "Linear" }),
  };
  return { source: { ...reader, ...writer }, calls };
}

describe("PIVOT MCP write tools", () => {
  it("are the six design and library writes, and the design ones say briefs stay out of the repo", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toEqual([
      "save_design_brief",
      "record_design_decision",
      "get_design_session",
      "suggest_metadata",
      "annotate_reference",
      "save_reference",
    ]);
    for (const name of ["save_design_brief", "record_design_decision"]) {
      expect(tool(name).description).toMatch(/never write them into the project's repository/);
    }
    expect(tool("record_design_decision").description).toMatch(/only after the user explicitly approved/);
    expect(tool("suggest_metadata").description).toMatch(/never change the reference by themselves/);
  });

  it("refuse on a read-only connection instead of pretending to save", async () => {
    const res = await runTool(tool("save_design_brief"), reader, {
      milestone: "initial",
      title: "x",
      markdown: "# brief",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]).toMatchObject({ text: expect.stringMatching(/^read_only: .*Nothing was saved/) });
  });

  it("save_design_brief opens a session on the first brief and reports its id", async () => {
    const { source, calls } = writerSource();
    const res = await runTool(tool("save_design_brief"), source, {
      milestone: "initial",
      title: "Ledgerly pricing",
      markdown: "## Brief",
      referenceIds: [ID],
    });
    expect(res.content[0]).toMatchObject({ text: expect.stringMatching(/opened a design session\. sessionId/) });
    expect(calls[0]).toMatchObject({ method: "saveDesignBrief" });
  });

  it("validate inputs (milestone, decision kind, ids)", async () => {
    const { source } = writerSource();
    expect(
      (await runTool(tool("save_design_brief"), source, { milestone: "final", title: "x", markdown: "y" })).isError,
    ).toBe(true);
    expect(
      (await runTool(tool("record_design_decision"), source, { sessionId: ID, kind: "maybe", summary: "x" })).isError,
    ).toBe(true);
    expect((await runTool(tool("annotate_reference"), source, { id: "nope", note: "x" })).isError).toBe(true);
  });

  it("suggest_metadata lists what was added and skipped", async () => {
    const { source } = writerSource();
    const res = await runTool(tool("suggest_metadata"), source, {
      id: ID,
      suggestions: [{ kind: "facet", value: { kind: "visualStyle", name: "dark" }, reason: "black background" }],
    });
    expect((res.content[0] as { text: string }).text).toBe(
      "1 suggestion added to the Inbox.\n- facet: visualStyle: Dark\n- skipped title: already suggested",
    );
  });

  it("save_reference resolves collections by name and refuses unknown ones", async () => {
    const { source, calls } = writerSource();
    const ok = await runTool(tool("save_reference"), source, {
      url: "https://linear.app/pricing",
      collections: ["pricing pages"],
    });
    expect(ok.isError).toBeFalsy();
    expect(calls.find((c) => c.method === "saveReference")!.args[0]).toMatchObject({ collectionIds: ["c1"] });
    const bad = await runTool(tool("save_reference"), source, { url: "https://x.dev/", collections: ["Nope"] });
    expect(bad.content[0]).toMatchObject({ text: expect.stringMatching(/^not_found: No collection "Nope"/) });
  });
});
