import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze, loadSession, parseTranscript } from "../../../scripts/trace-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../../../scripts/trace-check.mjs");
const fixture = path.join(here, "fixtures/traces/design-run.jsonl");
const opts = { target: "/work/target", scratch: "/tmp/scratch" };

/** Builds a synthetic transcript: each step is [toolName, input, { error, where, cwd }]. */
function trace(steps) {
  const lines = [];
  steps.forEach(([name, input, o = {}], i) => {
    const time = `2026-11-03T10:00:${String(i).padStart(2, "0")}.000Z`;
    const side = o.where ? { isSidechain: true, agentId: o.where } : {};
    const cwd = o.cwd ?? "/work/target";
    lines.push(
      JSON.stringify({
        type: "assistant",
        timestamp: time,
        cwd,
        ...side,
        message: { content: [{ type: "tool_use", id: `t${i}`, name, input }] },
      }),
      JSON.stringify({
        type: "user",
        timestamp: time,
        cwd,
        ...side,
        message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, is_error: !!o.error, content: "SECRET" }] },
      }),
    );
  });
  return parseTranscript(lines.join("\n"));
}
const building = ["mcp__pivot__set_design_status", { sessionId: "s", status: "building" }];
const edit = ["Edit", { file_path: "/work/target/src/a.tsx", old_string: "SECRET", new_string: "SECRET" }];

describe("trace-check on a recorded-shape design run", () => {
  const report = analyze(loadSession(fixture), { ...opts, specialists: ["find-animation-opportunities"] });

  it("reads the subagent transcripts with the session", () => {
    expect(report.specialists.animate).toMatchObject({ label: "ran (skill)", where: ["subagent"] });
    expect(report.mcp.get_design_session).toBe(1);
  });

  it("labels execution, script runs, consultation, skipping and unavailability", () => {
    const labels = Object.fromEntries(Object.entries(report.specialists).map(([n, e]) => [n, e.label]));
    expect(labels).toEqual({
      animate: "ran (skill)",
      "emil-design-eng": "unavailable",
      "find-animation-opportunities": "none",
      impeccable: "ran (script)",
      "ui-ux-pro-max": "ran (script)",
    });
  });

  it("counts writes by place and passes the gate when the target is written only after building", () => {
    expect(report.writes).toEqual({ target: 1, scratch: 1, other: 0, shellHeuristic: 0 });
    expect(report.gate).toMatchObject({ ok: true, buildingMarked: true, buildingRefused: 1, approvalsRecorded: 1 });
    expect(report.warnings).toEqual([]);
  });

  it("never echoes prompts, inputs or results", () => {
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });
});

describe("trace-check specialist labels", () => {
  it("is consulted when the specialist's files were only read", () => {
    const r = analyze(
      trace([
        ["Read", { file_path: "/u/.claude/skills/animate/SKILL.md" }],
        ["Bash", { command: "cat /u/.claude/skills/animate/RECIPES.md" }],
      ]),
      opts,
    );
    expect(r.specialists.animate).toMatchObject({ label: "consulted", reads: 2, skillCalls: 0 });
  });

  it("flags a specialist Skill call made in the main thread", () => {
    const r = analyze(trace([["Skill", { skill: "design-taste-frontend" }]]), opts);
    expect(r.specialists["design-taste-frontend"].label).toBe("ran (skill)");
    expect(r.warnings).toEqual(["design-taste-frontend: invoked with the Skill tool in the main thread"]);
  });

  it("labels a refused Skill call unavailable, never a run, and matches plugin-qualified names", () => {
    const r = analyze(
      trace([
        ["Skill", { skill: "animate" }, { where: "a1", error: true }],
        ["Skill", { skill: "impeccable:impeccable" }, { where: "a1" }],
      ]),
      { ...opts, specialists: ["animate"] },
    );
    expect(r.specialists.animate).toMatchObject({ label: "unavailable", skillCalls: 0, failedSkillCalls: 1 });
    expect(r.specialists.impeccable.label).toBe("ran (skill)");
  });

  it("takes only folder-like skill names from commands, so no command text reaches the report", () => {
    const r = analyze(
      trace([
        [
          "Bash",
          { command: 'cd ~/.claude/skills/impeccable; grep -rn "SECRET" SKILL.md /x/skills/animate/RECIPES.md' },
        ],
        ["Bash", { command: "ls ~/.claude/skills/ && cat .claude/skills/.hidden/x SECRET; echo /skills/ SECRET/" }],
        ["Skill", { skill: "SECRET text with spaces" }, { where: "a1" }],
      ]),
      opts,
    );
    expect(Object.keys(r.specialists).sort()).toEqual(["(unnamed)", "animate", "impeccable"]);
    expect(r.specialists.impeccable.label).toBe("consulted");
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("names only known skills when given the installed list", () => {
    const r = analyze(
      trace([
        ["Read", { file_path: "/u/.claude/skills/animate/SKILL.md" }],
        ["Bash", { command: "echo /x/skills/PRIVATEWORD/" }],
      ]),
      { ...opts, knownSkills: new Set(["animate"]) },
    );
    expect(Object.keys(r.specialists).sort()).toEqual(["(unrecognised)", "animate"]);
  });

  it("ignores PIVOT's own skills", () => {
    const r = analyze(
      trace([
        ["Skill", { skill: "pivot-design" }],
        ["Read", { file_path: "/u/.claude/skills/pivot-design/specialists.md" }],
      ]),
      opts,
    );
    expect(r.specialists).toEqual({});
  });
});

describe("trace-check approval gate", () => {
  it("fails when the target is written before the session is marked building", () => {
    const r = analyze(trace([edit, building]), opts);
    expect(r.gate).toMatchObject({ ok: false, reason: "target written before the session was marked building" });
  });

  it("fails when building was refused and the target was written anyway", () => {
    const r = analyze(trace([[...building, { error: true }], edit]), opts);
    expect(r.gate).toMatchObject({ ok: false, buildingRefused: 1, buildingMarked: false });
    expect(r.gate.reason).toBe("target written but the session was never marked building");
  });

  it("treats shell writes in the target as target writes, and ignores reads and /dev/null", () => {
    const reads = analyze(
      trace([
        ["Bash", { command: "git status --porcelain && cat src/a.tsx 2>/dev/null" }],
        ["Bash", { command: "pnpm test >&2" }],
        ["Bash", { command: 'node -e "const ok = (x) => x >= 1; console.log(ok(2))"' }],
      ]),
      opts,
    );
    expect(reads.writes.target).toBe(0);
    expect(reads.gate.reason).toBe("no target writes");

    const shell = analyze(trace([["Bash", { command: "echo hi > src/b.ts" }], building]), opts);
    expect(shell.writes).toMatchObject({ target: 1, shellHeuristic: 1 });
    expect(shell.gate.ok).toBe(false);
  });

  it("doesn't count writes to the scratch folder against the gate", () => {
    const r = analyze(
      trace([["Write", { file_path: "/tmp/scratch/mockup-1.html", content: "x" }, { cwd: "/tmp/scratch" }]]),
      opts,
    );
    expect(r.writes).toMatchObject({ scratch: 1, target: 0 });
    expect(r.gate.ok).toBe(true);
  });

  it("counts a tool call written twice with the same id once", () => {
    const call = JSON.stringify({
      type: "assistant",
      isSidechain: true,
      agentId: "a1",
      message: { content: [{ type: "tool_use", id: "dup", name: "Skill", input: { skill: "animate" } }] },
    });
    const r = analyze(parseTranscript([call, call].join("\n")), opts);
    expect(r.specialists.animate.skillCalls).toBe(1);
  });

  it("skips malformed lines", () => {
    expect(parseTranscript('not json\n{"type":"user"}\n\n')).toEqual([]);
  });
});

describe("trace-check CLI", () => {
  it("prints a summary without transcript content and exits 0 when the gate holds", () => {
    const out = execFileSync(
      "node",
      [script, fixture, "--target", opts.target, "--scratch", opts.scratch, "--require-gate"],
      { encoding: "utf8" },
    );
    expect(out).toContain("animate: ran (skill) (subagent)");
    expect(out).toContain("Gate: ok");
    expect(out).not.toContain("SECRET");
  });

  it("exits 1 with --require-gate when the target was written before building", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pivot-trace-"));
    const file = path.join(dir, "early.jsonl");
    const line = (content) =>
      JSON.stringify({ type: "assistant", timestamp: "2026-11-03T10:00:00Z", message: { content } });
    fs.writeFileSync(
      file,
      line([{ type: "tool_use", id: "x", name: "Write", input: { file_path: "/work/target/a.ts" } }]),
    );
    let status = 0;
    try {
      execFileSync("node", [script, file, "--target", opts.target, "--require-gate", "--json"], { encoding: "utf8" });
    } catch (e) {
      status = e.status;
      expect(JSON.parse(e.stdout).gate.ok).toBe(false);
    }
    expect(status).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
