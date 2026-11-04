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
const motionMd = read(".claude/skills/pivot-design/motion.md");
const files = { "pivot-design": d, "pivot-redesign": r, specialists, motion: motionMd } as const;
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

  // get_reference_images' `which` values, from the tool's own schema
  const whichValues = new Set(
    [...(/which: z\s*\.enum\(\[([^\]]*)\]/.exec(src)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
  it("get_reference_images offers keyframes and states", () => {
    expect([...whichValues]).toEqual(["cover", "fullpage", "all", "keyframes", "states"]);
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
      expect(subset(all(/which: "([a-z]+)"/g, t), whichValues)).toEqual([]);
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
    expect(d).toContain("**Fallback:** use it instead of PIVOT");
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
  it("mockup count: 2–3 by default, 4–5 only when breadth helps, or the user's number", () => {
    expect(d).toContain("**2–3 genuinely different** directions by default");
    expect(d).toContain("Go to 4–5 only when the task gains from broader exploration");
    expect(d).toContain("the number the user asked for");
    for (const t of [d, r, read("README.md")]) expect(t).not.toMatch(/about \*?\*?5 (distinct )?directions/i);
    expect(r).toContain("2–3 directions for a Major change");
  });
  it("an approval is the user's message or their own click in PIVOT", () => {
    expect(d).toContain("an approval made there is the user's message");
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
    for (const s of ["shortlist", "**2–3 mockup**", "make-viewer.mjs", "Kiểm tra AI slop"])
      expect(spec.includes(s), s).toBe(true);
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

describe("specialists run for real, labelled by what happened", () => {
  const agent = read(".claude/agents/pivot-specialist.md");
  const agentTools = (/^tools: (.+)$/m.exec(agent)?.[1] ?? "").split(",").map((t) => t.trim());
  const labels = ["`ran (skill)`", "`ran (script)`", "`consulted`", "`unavailable`"];

  it("the pivot-specialist agent can read and load skills but never write or run commands", () => {
    expect(agentTools).toEqual(expect.arrayContaining(["Read", "Skill", "mcp__pivot__get_design_session"]));
    for (const banned of ["Edit", "Write", "NotebookEdit", "Bash", "Agent"]) expect(agentTools).not.toContain(banned);
    expect(agentTools.filter((t) => t.startsWith("mcp__pivot__") && !/__(get|list|search)_/.test(t))).toEqual([]);
  });
  it("the agent returns the contract, and is linked by pnpm skill:install without overwriting", () => {
    for (const f of ["Specialist:", "Why:", "Input:", "Recommendations:", "Constraints:", "Conflicts:", "Verify:"])
      expect(agent).toContain(f);
    expect(agent).toContain("Outcome (orchestrator): pending");
    const install = read("scripts/install-skill.mjs");
    expect(install).toContain(".claude/agents/pivot-specialist.md");
    expect(install).toContain("isn't a link to this repo");
  });
  it("specialists.md defines the three ways, the four labels and the contract", () => {
    for (const l of labels) expect(specialists).toContain(l);
    expect(specialists).toContain('subagent_type: "pivot-specialist"');
    for (const f of ["Recommendations:", "Conflicts:", "Verify:", "Outcome (orchestrator): pending"])
      expect(specialists).toContain(f);
    expect(specialists).toContain("`adopted`, `partially adopted`, `rejected` or `not applicable`");
  });
  it("no main-thread Skill call, no fallback to another agent or Claude process", () => {
    for (const t of [d, r, specialists]) expect(t).toContain("Skill tool");
    expect(specialists).toContain("**Never invoke a specialist with the Skill tool in your own session.**");
    expect(d).toContain("**Never invoke a specialist with the Skill tool yourself.**");
    expect(specialists).toContain("never use a general-purpose or other agent in its place");
    expect(specialists).toContain("never start another Claude process (`claude -p`)");
    expect(r).toContain("never use another agent or Claude process");
  });
  it("a missing specialist is skipped, never replaced", () => {
    expect(specialists).toContain(
      "Nothing stands in for it: no other agent, no other Claude process, no invented advice.",
    );
  });
  it("the 400-word contract budget is soft, and summaries keep every recommendation, constraint, conflict and check", () => {
    expect(specialists).toContain("about 400 words is a soft budget, not a limit");
    expect(specialists).toContain("keep every recommendation, constraint, conflict and verification item");
    expect(read(".claude/agents/pivot-specialist.md")).toContain(
      "never drop a recommendation, constraint, conflict or verification item to fit",
    );
    expect(read("docs/decisions-progress.md")).toContain("Structure: PASS");
  });
  it("skills report run labels, keep a ledger and don't re-run ledgered specialists", () => {
    expect(d).toContain("`ran (skill)` only when `pivot-specialist` loaded the specialist");
    expect(r).toContain("`ran (skill)` only through `pivot-specialist`");
    expect(specialists).toContain("`<name> — <phase> — <run label> — <outcome>:");
    expect(d).toContain("already in the latest brief's Specialists ledger isn't run again");
    expect(specialists).toContain("**One run per specialist per phase.**");
  });
  it("conflicts: domain owner wins, accessibility and reduced motion win, approved decisions aren't overridden", () => {
    expect(specialists).toContain("the one that owns the domain wins");
    expect(specialists).toContain("Accessibility and reduced motion always win");
    expect(specialists).toContain("It is never applied silently.");
  });
  it("motion specialists are routed, and non-invocable skills are only consulted", () => {
    for (const n of ["`animate`", "`find-animation-opportunities`", "`review-animations`", "`gsap-*`"])
      expect(specialists).toContain(n);
    expect(specialists).toContain("Skills that can't be model-invoked");
  });
  it("SPEC and PIVOT_DECISIONS describe the mechanism", () => {
    for (const x of ["pivot-specialist", "`ran (skill)`", "`consulted`", "claude -p"])
      expect(spec.includes(x), x).toBe(true);
    expect(read("docs/PIVOT_DECISIONS.md")).toContain("**Orchestrator v2, P0b**");
  });
});

describe("motion is part of the design", () => {
  const motion = read(".claude/skills/pivot-design/motion.md");

  it("motion.md defines the three levels and the classification line, none by default", () => {
    for (const l of ["**None**", "**Standard**", "**Advanced**"]) expect(motion).toContain(l);
    expect(motion).toContain("`Motion: none | standard | advanced — <reason> (auto | set by you)`");
    expect(motion).toContain("**The user's words decide**");
    expect(motion).toContain("**none** by default");
    expect(motion).toContain("don't force animation");
  });
  it("both skills classify motion and point to motion.md", () => {
    expect(d).toContain("**the motion level:**");
    expect(d).toContain("**Re-check the motion level**");
    expect(r).toContain("../pivot-design/motion.md");
    expect(r).toContain("so it is **Major**");
    expect(r).toContain("A Minor redesign keeps the existing motion exactly as it is");
  });
  it("the brief's Motion block tags items essential or detail, and references carry motion evidence", () => {
    expect(motion).toContain("**essential**");
    expect(motion).toContain("**detail**");
    for (const e of ["`observed live`", "`keyframes`", "`video exists, not viewed`", "`screenshot`", "`metadata only`"])
      expect(motion).toContain(e);
    expect(motion).toContain("**observed** or **inferred**");
    expect(d).toContain("add the **Motion** block from motion.md §4");
  });
  it("previews: CSS in PIVOT, executable local preview for Advanced, real reduced-motion setting only", () => {
    expect(motion).toContain("**CSS motion in PIVOT (Standard).**");
    expect(motion).toContain("--interactive <n,…>");
    expect(motion).toContain("never a rewrite of the mockup's CSS or a fake `matchMedia`");
    expect(motion).toContain("A recording, keyframes, a screenshot or a description is not an executable preview.");
  });
  it("reduced-motion evidence stays in three kinds; the OS setting and devices are verified only by the user", () => {
    expect(motion).toContain("**browser emulation**");
    expect(motion).toContain("verified only when the user turns it on and says what they saw");
    expect(motion).toContain("**a real device**: unverified unless the user checked it");
  });
  it("gate 2 needs each essential item seen running, never a static stand-in, and names the preview's digest", () => {
    expect(motion).toContain("**Check it yourself before gate 2:**");
    expect(motion.replace(/\s+/g, " ")).toContain(
      "A static version or its screenshot is never counted as the executable preview.",
    );
    expect(motion).toContain("digest <d>");
    expect(d).toContain("a static version, screenshot or recording never stands in for it");
    expect(motion).toContain("**What an approval is bound to, today:**");
  });
  it("the viewer's tested protections and residual risks are written down", () => {
    expect(motion).toContain("**What is tested and what isn't**");
    expect(motion).toContain("Not covered by the checks: DNS prefetching");
    expect(motion).toContain("The inliner's markup rewriting is a");
  });
  it("approval stays inside gate 2, with the Advanced rule and the exception", () => {
    expect(motion).toContain("There is no separate motion approval");
    expect(d).toContain("**Motion is approved here too, not in a separate step**");
    expect(motion).toContain("**Every essential item in the executable local preview**");
    expect(motion).toContain("`Exception (owner):");
    expect(motion).toContain("don't call `set_design_status` with `building`");
  });
  it("technology order and QA honesty", () => {
    expect(
      ordered(motion, ["already uses for motion", "CSS transitions", "The Web Animations API", "Add a library"]),
    ).toBe(true);
    expect(motion).toContain("Never add a dependency without that reason in the approved brief.");
    expect(motion).toContain("measure is unverified, never a pass");
  });
  it("the local viewer is hardened and motion specialists follow the level", () => {
    const viewer = read(".claude/skills/pivot-design/viewer/make-viewer.mjs");
    expect(viewer).toContain("connect-src 'none'");
    expect(viewer).not.toContain('allow-same-origin"');
    expect(specialists).toContain("when the motion level is standard or advanced");
  });
  it("motion evidence: read from PIVOT, observed only for a recording, inferred is the agent's label, gaps named", () => {
    const flat = motion.replace(/\s+/g, " ");
    expect(flat).toContain('`classification: "observed"` only when PIVOT recorded the page while scrolling it');
    expect(flat).toContain('`classification: "unknown"` when there is no recording');
    expect(flat).toContain("PIVOT never labels anything inferred itself");
    expect(flat).toContain('`which: "keyframes"`');
    expect(flat).toContain("**Name the gaps:**");
    expect(d.replace(/\s+/g, " ")).toContain("A screenshot never proves an animation");
  });
  it("SPEC and PIVOT_DECISIONS describe the motion foundation", () => {
    for (const x of ["mức motion", "Xem trước và duyệt motion", "--interactive"])
      expect(spec.includes(x), x).toBe(true);
    expect(read("docs/PIVOT_DECISIONS.md")).toContain("**Orchestrator v2, P0c: motion foundation**");
  });
});

describe("motion QA traces to the approved brief and never passes on missing evidence", () => {
  const flat = motionMd.replace(/\s+/g, " ");
  it("Motion items carry M-numbers that stay with them, and the brief template shows one", () => {
    expect(flat).toContain("Number the items **M1, M2…** in the Item cell");
    expect(motionMd).toContain("| M1 · <name> |");
  });
  it("motion.md §9: read the approved brief, plan from it, run the script, then check by hand", () => {
    expect(
      ordered(flat, [
        "**Read the approved brief**",
        "**Write the plan**",
        "**Run it:**",
        "**Read the report**",
        "**Check by hand",
      ]),
    ).toBe(true);
    expect(fs.existsSync(P(".claude/skills/pivot-design/scripts/motion-qa.mjs"))).toBe(true);
    expect(flat).toContain(
      "node <skill>/scripts/motion-qa.mjs <plan.json> --out <scratchpad>/motion-qa --brief <scratchpad>/brief.md",
    );
    expect(flat).toContain("never in the project");
  });
  it("Pass, Fail and Not Verified are defined, and only executed observations pass", () => {
    for (const x of ["**Pass**", "**Fail**", "**Not Verified**"]) expect(motionMd).toContain(x);
    expect(flat).toContain("Reading the source, a screenshot or a guess never makes a Pass.");
    expect(flat).toContain(
      "The **overall** status is Pass only when every essential item of the approved brief passed",
    );
    expect(flat).toContain("every item is Not Verified. Say so; never put screenshots in its place.");
    expect(flat).toContain(
      "turning everything off isn't assumed to be right, and content must still reach its final state",
    );
    expect(flat).toContain("Never invent a value or a tolerance the brief doesn't state.");
  });
  it("motion QA never drives PIVOT, blocks writes and other hosts, and its evidence can be re-checked", () => {
    expect(flat).toContain("never PIVOT's own app");
    expect(flat).toContain("redirects, WebSockets and workers included");
    expect(flat).toContain("`--allow-writes` lifts that, only with the user's permission");
    expect(flat).toContain("which must be a new, empty folder");
    expect(flat).toContain("It proves the files match the report, not that the report is genuine.");
    expect(flat).toContain("A final state alone never proves the trigger");
  });
  it("emulation, the OS setting and devices stay apart; remote requests need permission", () => {
    expect(flat).toContain("Reduced motion checked by the script is **browser emulation**");
    expect(flat).toContain("`--allow-remote`, which needs the user's permission");
  });
  it("pivot-design §10 and pivot-redesign use it; SPEC and PIVOT_DECISIONS describe it", () => {
    expect(d).toContain("`scripts/motion-qa.mjs` against the build");
    expect(d).toContain("the overall status is Pass only when every essential item passed");
    expect(r).toContain("a `motion-qa.mjs` run on the current build, before any edit, gives the before");
    for (const x of ["Motion QA", "motion-qa.mjs", "Not Verified"]) expect(spec.includes(x), x).toBe(true);
    expect(read("docs/PIVOT_DECISIONS.md")).toContain("**Orchestrator v2, P1c: motion QA**");
  });
});
