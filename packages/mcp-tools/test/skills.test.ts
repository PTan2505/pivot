// Static contract checks for the PIVOT design skills (.claude/skills/pivot-design, pivot-redesign): the tools and
// enum values they name exist, their steps stay in order, and the rules they share agree with each other and with
// docs/SPEC.md. These prove what the files say, not what an agent does; behaviour is checked from traces
// (scripts/trace-check.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const P = (...p: string[]) => path.join(root, ...p);
const read = (...p: string[]) => fs.readFileSync(P(...p), "utf8");

const d = read(".claude/skills/pivot-design/SKILL.md");
const r = read(".claude/skills/pivot-redesign/SKILL.md");
const specialists = read(".claude/skills/pivot-design/specialists.md");
const files = { "pivot-design": d, "pivot-redesign": r, specialists } as const;
const spec = read("docs/SPEC.md");
const src = ["tools.ts", "write-tools.ts", "external-tools.ts"].map((f) => read("packages/mcp-tools/src", f)).join("");
const types = read("packages/core/src/types.ts");

const all = (re: RegExp, text: string) => new Set([...text.matchAll(re)].map((m) => m[1]));
const enumValues = (name: string) => {
  const body = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(types)?.[1] ?? "";
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
};
const subset = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
/** True when every word occurs in `text`, in this order. */
const ordered = (text: string, words: string[]) => {
  const pos = words.map((w) => text.indexOf(w));
  return pos.every((p) => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]);
};

describe("skills name real MCP tools and values", () => {
  const tools = all(/name: "([a-z_]+)"/g, src);

  it("packages/mcp-tools defines 13 tools", () => {
    expect(tools.size).toBe(13);
  });

  const milestones = enumValues("DESIGN_MILESTONES");
  const kinds = enumValues("DESIGN_DECISION_KINDS");
  const tagKinds = enumValues("TAG_KINDS");
  for (const [f, t] of Object.entries(files)) {
    it(`${f}: every tool it names exists`, () => {
      const used = all(/`((?:list|search|get|save|record|suggest|annotate|set)_[a-z_]+)`/g, t);
      expect(subset(used, tools)).toEqual([]);
    });
    it(`${f}: milestones, decision kinds, facet kinds and image 'which' values exist`, () => {
      expect(subset(all(/milestone: "([a-z_]+)"/g, t), milestones)).toEqual([]);
      const decisionKinds = new Set([...all(/kind: "([a-z_]+)"/g, t)].filter((k) => !tagKinds.has(k)));
      expect(subset(decisionKinds, kinds)).toEqual([]);
      const facetKinds = new Set([
        ...all(/\{kind: "([a-zA-Z]+)"/g, t),
        ...all(/`(pageType|domain|visualStyle|uiPattern|technology)[:`]/g, t),
      ]);
      expect(subset(facetKinds, tagKinds)).toEqual([]);
      expect(subset(all(/which: "([a-z]+)"/g, t), new Set(["cover", "fullpage", "all"]))).toEqual([]);
    });
  }

  it("the tool schemas have the fields the skills pass", () => {
    const fields = [
      ...["sessionId", "targetProject", "surface", "referenceIds", "note", "summary", "direction", "details"],
      ...["fromSlice", "facets", "collection", "source", "query"],
    ];
    expect(fields.filter((f) => !new RegExp(`\\b${f}: z`).test(src))).toEqual([]);
    expect(src).toMatch(/name: "list_facets",[\s\S]{0,600}inputSchema: \{\}/);
    expect(src).toMatch(/path: z\s*\.string\(\)/);
    expect(src).toMatch(/html: z\.string\(\)/);
  });
});

describe("mockups in PIVOT and the decision watcher", () => {
  it("pivot-design saves mockups to PIVOT and waits with the watcher in the background", () => {
    expect(d).toContain("save_design_mockups");
    expect(d).toContain("wait-for-decision.mjs");
    expect(d).toContain("run_in_background");
    expect(fs.existsSync(P(".claude/skills/pivot-design/scripts/wait-for-decision.mjs"))).toBe(true);
  });
  it("an owner approval made in PIVOT isn't recorded again; a chat approval stops the watcher", () => {
    for (const t of [d, r]) {
      expect(t).toContain('source: "owner"');
      expect(t).toContain("Don't record it again");
    }
    expect(d).toContain("stop the watcher");
  });
  it("the local viewer is only a fallback, and its script exists", () => {
    expect(d).toContain("Fallback viewer");
    expect(d).toContain("viewer/make-viewer.mjs");
    expect(fs.existsSync(P(".claude/skills/pivot-design/viewer/make-viewer.mjs"))).toBe(true);
  });
});

describe("shared files resolve and install", () => {
  it("pivot-redesign reaches pivot-design's specialists.md by its relative path", () => {
    expect(fs.existsSync(P(".claude/skills/pivot-redesign/../pivot-design/specialists.md"))).toBe(true);
  });
  it("pnpm skill:install links both skills", () => {
    expect(read("scripts/install-skill.mjs")).toContain('["pivot-design", "pivot-redesign"]');
  });
});

describe("steps stay in order", () => {
  it("pivot-design: flow line and section order", () => {
    const flow = /The flow is \*\*(.+?)\*\*/.exec(d)?.[1] ?? "";
    expect(
      ordered(flow, ["search", "shortlist", "brief", "design session", "mockups", "approval", "build", "QA"]),
    ).toBe(true);
    const sections = ["## 2. Search", "## 4. Shortlist", "## 5. Brief", "## 6. Design session", "## 7. Mockups"];
    expect(ordered(d, [...sections, "## 8. Approval", "## 9. Build", "## 10. QA"])).toBe(true);
  });
  it("pivot-design: facets first, brief before mockups, showing the brief isn't a gate", () => {
    expect(d).toContain("before your first general library search");
    expect(d).toContain("Showing the brief is not an approval gate");
    expect(d).toContain("right after you show it and before the mockups");
  });
  it("pivot-redesign: path A and path B order", () => {
    const a = /in this order:\n\n([\s\S]+?)\n\n/.exec(r)?.[1] ?? "";
    expect(
      ordered(a, ["Classify", "references", "shortlist", "brief", "`initial`", "mockups", "approval", "Build", "QA"]),
    ).toBe(true);
    const b = r.slice(r.indexOf("## 3. Path B"), r.indexOf("## 4."));
    expect(ordered(b, ["**Audit**", "**Propose**", "**Save**", "**Mockup:**", "**Ask and wait**", "**Build**"])).toBe(
      true,
    );
  });
  it("pivot-redesign: no brief after mockups, facets before search, no library search on path B", () => {
    expect(r).toContain("doesn't allow writing the brief only after the mockups");
    expect(r).toContain("Before any general library search, call `list_facets` once per task");
    expect(r).toContain("No library search unless the user asks for references");
    for (const stale of ["Save, ask and wait", "A QA departure is recorded", "report it and record it (`deviation`)"])
      expect(r).not.toContain(stale);
  });
});

describe("approval provenance", () => {
  for (const [f, t] of [
    ["pivot-design", d],
    ["pivot-redesign", r],
  ] as const) {
    it(`${f}: exact words, other instructions labelled, recorded once`, () => {
      expect(t).toContain("exact approval words");
      expect(t).toContain("labelled line");
      expect(t).toContain("user's words");
      expect(t).toContain("get_design_session");
      expect(t).toMatch(/Record (it|each approval) once/);
    });
  }
  it("specialists.md and SPEC agree", () => {
    expect(specialists).toContain("Never replace or paraphrase the authorisation");
    expect(spec).toContain("nguyên văn lời duyệt");
    expect(spec).toContain("không ghi lại");
  });
});

describe("QA differences are classified in one place", () => {
  it("pivot-design §10 has the four classes and SPEC describes them", () => {
    for (const s of [
      "Refinement within the approved scope",
      "Departure from an approved requirement or design detail",
      "Material change to the approved direction",
      "Pre-existing or unrelated defect",
    ])
      expect(d).toContain(s);
    for (const s of [
      "tinh chỉnh trong phạm vi",
      "lệch khỏi một yêu cầu hay chi tiết đã duyệt",
      "thay đổi đáng kể",
      "lỗi có sẵn từ trước",
    ])
      expect(spec).toContain(s);
  });
  it("pivot-redesign and specialists.md point to pivot-design §10", () => {
    expect(r).toContain("`pivot-design` §10");
    expect(specialists).toContain("`pivot-design` §10");
    expect(specialists).not.toContain("departs from the approved direction");
  });
});

describe("specialists stay optional", () => {
  for (const [f, t] of [
    ["pivot-design", d],
    ["pivot-redesign", r],
  ] as const) {
    it(`${f}: checkpoint line, "none" is valid, no preloading`, () => {
      expect(t).toContain("`Specialists: none — <reason>`");
      expect(t).toContain("`Specialists: <name> — <stage> — <purpose>`");
      expect(t).toContain('"None" is a valid answer');
      expect(t).toContain("Don't preload every specialist's instructions");
    });
  }
  it("small fixes stay light", () => {
    expect(r).toContain("**Small fix:** none, unless the user asks.");
    expect(r).toContain("No screenshot matrix, no session.");
    expect(d).toContain("Small, explicit fixes skip the flow");
    expect(specialists).toContain("**Small fix:** none by default");
  });
  it("a specialist is named only after its SKILL.md was read; SPEC describes the checkpoint", () => {
    expect(specialists).toContain("Name a specialist on the checkpoint line only after this Read succeeds");
    expect(spec).toContain("Specialists: none — <lý do>");
  });
});

describe("evidence is reported as it is", () => {
  it("generated, inspected and delivered stay apart; blocked checks are unverified", () => {
    expect(d).toContain("screenshots you generated");
    expect(d).toContain("actually looked at");
    expect(d).toContain("hand to the user");
    expect(d).toContain("**unverified**, never a pass");
    expect(r).toContain("Report evidence as `pivot-design` §10 says");
  });
  it("no universal pixel-diff mandate", () => {
    expect(r).toContain("Use a pixel diff when the tooling has one");
    expect(r + d).not.toContain("pixel diff is required");
  });
});

describe("shortlist, mockups and slop check", () => {
  it("the shortlist pauses for the user's pick and isn't an approval", () => {
    expect(d).toContain("stop for the user's pick");
    expect(d).toContain("Skip the pause only when the user said so");
    expect(d).toContain("/r/<id>");
    expect(d).toContain("This is a choice, not an approval");
  });
  it("mockup count: about 5 distinct, or the user's number", () => {
    expect(d).toContain("about **5 distinct** directions");
    expect(d).toContain("the number the user asked for");
  });
  it("an approval is the user's message or their own click in PIVOT", () => {
    expect(d).toContain("the approval is then the user's message");
    expect(d).toContain("An approval the user made in PIVOT** is an explicit approval");
  });
  it("the slop check always runs and the critique stays text-only", () => {
    expect(d).toContain("Slop check.");
    expect(d).toContain("whatever the specialist checkpoint said");
    expect(d).toContain("never its `critique-storage write`");
    expect(r).toContain("**Slop check** (Minor and Major): always run");
    expect(specialists).toContain("**slop check** (`pivot-design` §10)");
  });
  it("pivot-redesign path B mockups follow pivot-design §7 with the watcher", () => {
    expect(r).toContain("follow `pivot-design` §7");
    expect(r).toContain("start the watcher");
  });
  it("SPEC describes the shortlist, mockups, viewer and slop check", () => {
    for (const s of ["shortlist", "khoảng 5 mockup", "make-viewer.mjs", "Kiểm tra AI slop"]) expect(spec).toContain(s);
  });
});

describe("session status", () => {
  it("pivot-design marks building before the first edit and done only when nothing is left", () => {
    expect(d).toContain('**Before the first edit,** call `set_design_status` with `status: "building"`');
    expect(d).toContain('call `set_design_status` with `status: "done"`');
    expect(d).toContain("a departure waits for the user's decision");
  });
  it("pivot-design reads the status on resume", () => {
    expect(d).toContain("`abandoned`: the user stopped this work");
    expect(d).toContain("The old approval no longer covers building");
  });
  it("pivot-redesign: building after approval, done at QA, status read on resume", () => {
    expect(r).toContain('then `set_design_status` with `status: "building"` before the first edit');
    expect(r).toContain("**Close the session**");
    expect(r).toContain("abandoned means stop and ask");
  });
  it("SPEC documents set_design_status and its conflict", () => {
    expect(spec).toContain("set_design_status");
    expect(spec).toContain("`conflict`");
  });
});

describe("components", () => {
  it("no stale 2–3 mockup count in pivot-design", () => {
    expect(d).not.toContain("2–3 mockups");
    expect(d).not.toContain("instead of 2–3");
  });
  it("the brief has a Component API line, left out for pages", () => {
    expect(d).toContain("**Component API:**");
    expect(d).toContain("Leave out the **Component API** line for a page");
  });
  it("component mockups: in context, with states, 2–3 allowed, reuse first", () => {
    for (const s of [
      "**When the surface is a component,**",
      "**In context:**",
      "**Its states on the same page:**",
      "only 2–3 that really differ",
      "**Reuse first:**",
    ])
      expect(d).toContain(s);
    expect(d).toContain("or a component and the page or container it lives in");
    expect(r).toContain("§7's component rules");
  });
  it("SPEC and PIVOT_DECISIONS document component mockups", () => {
    expect(spec).toContain("Component API");
    expect(read("docs/PIVOT_DECISIONS.md")).toContain("Mockup count and components");
  });
});
