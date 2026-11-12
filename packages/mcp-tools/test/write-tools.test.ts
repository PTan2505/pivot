import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlineMockup } from "../src/mockups";
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
    saveDesignMockups: rec("saveDesignMockups", { round: 2, ids: ["m1", "m2"], created: true }),
    appUrl: "http://127.0.0.1:4321",
    getDesignSession: rec("getDesignSession", null),
    setDesignStatus: rec("setDesignStatus", null as never),
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
  it("are the ten design and library writes, and the design ones say briefs stay out of the repo", () => {
    expect(WRITE_TOOLS.map((t) => t.name)).toEqual([
      "save_design_brief",
      "record_design_decision",
      "save_design_mockups",
      "set_design_status",
      "get_design_session",
      "propose_references",
      "select_references",
      "suggest_metadata",
      "annotate_reference",
      "save_reference",
    ]);
    for (const name of [
      "save_design_brief",
      "record_design_decision",
      "save_design_mockups",
      "propose_references",
      "select_references",
    ]) {
      expect(tool(name).description).toMatch(/never write them into the project's repository/);
    }
    expect(tool("record_design_decision").description).toMatch(
      /can't record an approval: approvals are the owner's alone/,
    );
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

  it("record_design_decision can't record an approval: it never reaches PIVOT", async () => {
    const { source, calls } = writerSource();
    const M = "22222222-3333-4444-8555-666666666666";
    const res = await runTool(tool("record_design_decision"), source, {
      sessionId: ID,
      kind: "approval",
      summary: "The user approved version 2",
      mockupId: M,
      mockupDigest: "0123456789ab",
    });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("record_design_decision records a deviation bound to a version, and checks the binding's form", async () => {
    const { source, calls } = writerSource();
    const M = "22222222-3333-4444-8555-666666666666";
    const res = await runTool(tool("record_design_decision"), source, {
      sessionId: ID,
      kind: "deviation",
      summary: "QA: the hero lost its entrance",
      mockupId: M,
      mockupDigest: "0123456789ab",
    });
    expect(calls[0]).toMatchObject({
      method: "recordDesignDecision",
      args: [ID, { kind: "deviation", mockupId: M, mockupDigest: "0123456789ab" }],
    });
    expect(res.structuredContent).toMatchObject({ mockupId: M });
    for (const bad of [
      { mockupId: "m1" },
      { mockupId: M, mockupDigest: "short" },
      { mockupId: M, mockupDigest: "zz".repeat(8) },
    ])
      expect(
        (
          await runTool(tool("record_design_decision"), source, {
            sessionId: ID,
            kind: "deviation",
            summary: "x",
            ...bad,
          })
        ).isError,
        JSON.stringify(bad),
      ).toBe(true);
  });

  it("get_design_session shows each version's id and digest, and whether an approval still matches it", async () => {
    const { source } = writerSource();
    const digest = "a".repeat(64);
    const session = (status: "bound" | "changed" | "missing", currentApprovalId: string | null = "d1") =>
      ({
        id: ID,
        currentApprovalId,
        approvalResetAt: null,
        title: "Billing",
        targetProject: "",
        surface: "",
        status: "approved",
        createdAt: "",
        updatedAt: "",
        snapshots: [],
        decisions: [
          {
            id: "d1",
            sessionId: ID,
            kind: "approval",
            summary: "Owner approved version 1",
            direction: "Version 1: One (round 1)",
            details: "",
            source: "owner",
            binding: { mockupId: "m1", digest, status },
            createdAt: "",
          },
        ],
        mockups: [
          {
            id: "m1",
            sessionId: ID,
            snapshotId: null,
            round: 1,
            n: 1,
            title: "One",
            interactive: false,
            digest,
            createdAt: "",
          },
        ],
      }) as never;
    source.getDesignSession = async () => session("bound");
    const t = (r: Awaited<ReturnType<typeof runTool>>) => (r.content[0] as { text: string }).text;
    const ok = t(await runTool(tool("get_design_session"), source, { sessionId: ID }));
    expect(ok).toContain("Bound to mockup m1, digest aaaaaaaaaaaa: unchanged.");
    expect(ok).toContain("approval (by the user, in PIVOT) [counts now]:");
    expect(ok).not.toContain("No approval counts now");
    expect(ok).toContain("1. One (id m1, digest aaaaaaaaaaaa)");
    source.getDesignSession = async () => session("changed");
    expect(t(await runTool(tool("get_design_session"), source, { sessionId: ID }))).toContain(
      "CHANGED since approval, approve again",
    );
    // after a reopen or a major change, the old approval is shown but doesn't count
    source.getDesignSession = async () => session("bound", null);
    const reopened = t(await runTool(tool("get_design_session"), source, { sessionId: ID }));
    expect(reopened).toContain("No approval counts now");
    expect(reopened).not.toContain("[counts now]");
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

describe("set_design_status", () => {
  // A session in a given status, and a writer that records the status it was set to.
  function withStatus(status: string) {
    const set: string[] = [];
    const { source } = writerSource();
    source.getDesignSession = async () => ({ id: ID, status, snapshots: [], decisions: [] }) as never;
    source.setDesignStatus = async (_id, to) => {
      set.push(to);
      return { id: ID, status: to } as never;
    };
    return { source, set };
  }
  const run = (source: PivotSource, status: string) =>
    runTool(tool("set_design_status"), source, { sessionId: ID, status });

  it("moves an approved session to building, and a building one to done", async () => {
    const a = withStatus("approved");
    expect((await run(a.source, "building")).content[0]).toMatchObject({ text: "The session is now building." });
    const b = withStatus("building");
    expect((await run(b.source, "done")).isError).toBeFalsy();
    expect([...a.set, ...b.set]).toEqual(["building", "done"]);
  });

  it("changes nothing when the session already has that status", async () => {
    const s = withStatus("building");
    expect((await run(s.source, "building")).content[0]).toMatchObject({ text: "The session is already building." });
    expect(s.set).toEqual([]);
  });

  it("refuses moves out of order with a conflict that says what to do", async () => {
    for (const [from, to, hint] of [
      ["exploring", "building", /needs the user's approval again/],
      ["abandoned", "building", /ask whether to restore it/],
      ["approved", "done", /Only a session that is building/],
      ["done", "building", /Only an approved session/],
    ] as const) {
      const s = withStatus(from);
      const res = await run(s.source, to);
      expect(res.isError).toBe(true);
      expect(res.content[0]).toMatchObject({ text: expect.stringMatching(/^conflict: /) });
      expect(res.content[0]).toMatchObject({ text: expect.stringMatching(hint) });
      expect(s.set).toEqual([]);
    }
  });

  it("never sets exploring, approved or abandoned, and refuses on a read-only connection", async () => {
    for (const status of ["exploring", "approved", "abandoned"]) {
      expect((await run(withStatus("approved").source, status)).isError).toBe(true);
    }
    const res = await runTool(tool("set_design_status"), reader, { sessionId: ID, status: "building" });
    expect(res.content[0]).toMatchObject({ text: expect.stringMatching(/^read_only: /) });
  });
});

describe("save_design_mockups", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-mockups-"));
    await fs.writeFile(path.join(dir, "dot.png"), Buffer.from("89504e47", "hex"));
    await fs.writeFile(path.join(dir, "base.css"), "body{color:red}");
    await fs.writeFile(
      path.join(dir, "site.css"),
      '@import "base.css"; @import url(https://fonts.example/x.css); .hero{background:url(dot.png)}',
    );
    await fs.writeFile(
      path.join(dir, "a.html"),
      `<!doctype html><link rel="stylesheet" href="site.css"><link rel="stylesheet" href="https://cdn.example/t.css">
<script src="app.js"></script><script>alert(1)</script>
<style>.x{background:url('./dot.png')}</style>
<img src="dot.png" alt="Dot"><img src="https://img.example/y.png" alt=""><img src="gone.png" alt="">
<div style="background:url(dot.png)"></div>`,
    );
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("inlines local CSS, images and imports, and removes scripts and remote files", async () => {
    const r = await inlineMockup(path.join(dir, "a.html"));
    expect(r.html).not.toMatch(/<script|<link|https:\/\/|dot\.png/);
    expect(r.html).toContain("body{color:red}");
    expect(r.html.match(/data:image\/png;base64,iVBORw==/g)).toHaveLength(4);
    expect(r.dropped).toEqual(
      expect.arrayContaining([
        "app.js",
        "inline <script>",
        "https://cdn.example/t.css",
        "https://fonts.example/x.css",
        "https://img.example/y.png",
      ]),
    );
    expect(r.missing).toEqual([path.join(dir, "gone.png")]);
  });

  it("uploads the inlined round and returns the session page's link", async () => {
    const { source, calls } = writerSource();
    const res = await runTool(tool("save_design_mockups"), source, {
      sessionId: ID,
      mockups: [
        { title: "Raised card", path: path.join(dir, "a.html") },
        { title: "Quiet table", html: "<p>2</p>" },
      ],
    });
    expect(res.isError).toBeFalsy();
    const sent = calls.find((c) => c.method === "saveDesignMockups")!.args[1] as {
      mockups: { title: string; html: string }[];
    };
    expect(sent.mockups.map((m) => m.title)).toEqual(["Raised card", "Quiet table"]);
    expect(sent.mockups[0].html).toContain("data:image/png");
    const out = (res.content[0] as { text: string }).text;
    expect(out).toContain(`http://127.0.0.1:4321/design/${ID}?round=2`);
    expect(out).toMatch(/Removed .*app\.js/);
  });

  it("keeps an interactive version's scripts, marks it, and points to the interactive preview", async () => {
    await fs.writeFile(path.join(dir, "i.html"), `<button onclick="t()">T</button><script>function t(){}</script>`);
    const { source, calls } = writerSource();
    const res = await runTool(tool("save_design_mockups"), source, {
      sessionId: ID,
      mockups: [
        { title: "Static", path: path.join(dir, "i.html") },
        { title: "Live", path: path.join(dir, "i.html"), interactive: true },
      ],
    });
    expect(res.isError).toBeFalsy();
    const sent = calls.find((c) => c.method === "saveDesignMockups")!.args[1] as {
      mockups: { title: string; html: string; interactive?: boolean }[];
    };
    expect(sent.mockups[0]).toEqual({ title: "Static", html: '<button onclick="t()">T</button>' });
    expect(sent.mockups[1]).toEqual({
      title: "Live",
      html: '<button onclick="t()">T</button><script>function t(){}</script>',
      interactive: true,
    });
    expect((res.content[0] as { text: string }).text).toMatch(/Interactive versions: 2\..*preview\.mjs 11111111-/);
  });

  it("needs exactly one of path or html, an absolute path, and at most 9 versions", async () => {
    const { source } = writerSource();
    const run = (mockups: unknown[]) => runTool(tool("save_design_mockups"), source, { sessionId: ID, mockups });
    expect((await run([{ title: "x" }])).content[0]).toMatchObject({
      text: expect.stringMatching(/either path or html/),
    });
    expect((await run([{ title: "x", path: "a.html" }])).content[0]).toMatchObject({
      text: expect.stringMatching(/must be absolute/),
    });
    expect((await run(Array.from({ length: 10 }, (_, i) => ({ title: `v${i}`, html: "<p>" })))).isError).toBe(true);
  });

  it("refuses on a read-only connection", async () => {
    const res = await runTool(tool("save_design_mockups"), reader, {
      sessionId: ID,
      mockups: [{ title: "x", html: "<p>" }],
    });
    expect(res.content[0]).toMatchObject({ text: expect.stringMatching(/^read_only/) });
  });
});

describe("gate 1: propose_references and select_references", () => {
  const cand = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `c${n}`,
    n,
    kind: "external" as const,
    resourceId: null,
    title: `Site ${n}`,
    url: `https://example.com/${n}`,
    source: "web search",
    why: `fits ${n}`,
    take: "",
    avoid: "",
    previewUrl: null,
    previewError: null,
    previewStatus: "pending" as const,
    selected: false,
    selectedWords: null,
    createdAt: "",
    ...extra,
  });

  it("waits for PIVOT's previews, returns them as images, and points the user at the session page", async () => {
    const { source, calls } = writerSource();
    let listed = 0;
    const s = {
      ...source,
      proposeReferences: async (...args: unknown[]) => {
        calls.push({ method: "proposeReferences", args });
        return { candidates: [cand(1), cand(2)] };
      },
      listCandidates: async () => {
        listed++;
        return [
          cand(1, { previewStatus: "ready", previewUrl: "/api/design/candidates/c1/preview" }),
          cand(2, { previewStatus: "failed", previewError: "HTTP 403" }),
        ];
      },
      getCandidatePreview: async (id: string) => ({ data: Buffer.from(`img-${id}`), mimeType: "image/webp" }),
    };
    const r = await tool("propose_references").run(s, {
      sessionId: ID,
      candidates: [
        { url: "https://example.com/1", why: "fits 1" },
        { url: "https://example.com/2", why: "fits 2" },
      ],
    });
    expect(listed).toBeGreaterThan(0);
    const out = r.content[0].type === "text" ? r.content[0].text : "";
    expect(out).toMatch(/1\. Site 1 — external, web search — https:\/\/example.com\/1/);
    expect(out).toMatch(/Preview: none \(HTTP 403\)/);
    expect(out).toContain(`http://127.0.0.1:4321/design/${ID}#references`);
    expect(out).toMatch(/wait for their pick \(gate 1\)/);
    expect(r.content.filter((c) => c.type === "image")).toEqual([
      { type: "image", data: Buffer.from("img-c1").toString("base64"), mimeType: "image/webp" },
    ]);
  });

  it("records the user's own words with the pick; an app without the feature says so", async () => {
    const { source } = writerSource();
    const got: unknown[] = [];
    const s = {
      ...source,
      selectReferences: async (...args: unknown[]) => {
        got.push(args);
        return { selected: [cand(2, { selected: true, selectedWords: "just 2" })] };
      },
    };
    const r = await tool("select_references").run(s, { sessionId: ID, numbers: [2], userWords: "just 2" });
    expect(got).toEqual([[ID, { numbers: [2], userWords: "just 2" }]]);
    expect(r.content[0].type === "text" && r.content[0].text).toMatch(/Recorded the user's pick: "just 2"/);
    await expect(
      tool("propose_references").run(source, { sessionId: ID, candidates: [{ url: "https://e.com/", why: "x" }] }),
    ).rejects.toMatchObject({ code: "not_supported" });
  });
});
