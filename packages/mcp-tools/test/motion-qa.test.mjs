// pivot-design's motion QA script (.claude/skills/pivot-design/scripts/motion-qa.mjs): the QA contract (Pass, Fail,
// Not Verified), tracing to the approved brief, the overall status, and one real browser run on its fixture page.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze, parseTranscript } from "../../../scripts/trace-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../../../.claude/skills/pivot-design/scripts/motion-qa.mjs");
const qa = await import(pathToFileURL(scriptPath).href);
const { validatePlan, parseBriefMotion, traceItems, judgeItem, aggregate, renderMarkdown, signature } = qa;

const DESKTOP = [{ name: "desktop", width: 1440, height: 900 }];
const obs = (o = {}) => ({
  executed: true,
  motion: true,
  properties: ["opacity", "transform"],
  animated: ["opacity", "transform"],
  declared: [{ name: "rise", durationMs: 400, easing: "ease-out" }],
  end: { opacity: "1", transform: "none" },
  cls: 0,
  longFrames: 0,
  evidence: [],
  ...o,
});
const still = (o = {}) => obs({ motion: false, properties: [], animated: [], declared: [], ...o });
const item = (o = {}) => ({
  id: "M1",
  name: "Hero entrance",
  tag: "essential",
  trigger: { type: "load" },
  target: "#hero",
  expect: { animates: true, properties: ["opacity", "transform"], end: { opacity: "1", transform: "none" } },
  reduced: { animates: false },
  ...o,
});
const runs = (full, reduced) => ({ desktop: { full, reduced } });
const statusOf = (j, check, mode = "full") => j.checks.find((c) => c.check === check && c.mode === mode)?.status;

describe("the plan and the approved brief", () => {
  it("refuses plans that can't be traced or aren't local previews", () => {
    const base = { target: { url: "http://127.0.0.1:5173/" }, items: [item()] };
    expect(validatePlan(base).errors).toEqual([]);
    expect(validatePlan(base).plan.viewports.map((v) => v.name)).toEqual(["desktop", "phone"]);
    for (const [bad, message] of [
      [{ ...base, target: { url: "https://example.com/" } }, "local preview"],
      [{ ...base, target: { url: "http://127.0.0.1/", file: "/x.html" } }, "exactly one"],
      [{ ...base, target: { viewer: "/mockups" } }, "target.version"],
      [{ ...base, items: [item({ id: "hero" })] }, "M1, M2"],
      [{ ...base, items: [item(), item()] }, "duplicate"],
      [{ ...base, items: [item({ tag: "nice" })] }, "essential or detail"],
      [{ ...base, items: [item({ trigger: { type: "swipe" } })] }, "trigger.type"],
      [{ ...base, items: [item({ expect: {} })] }, "expect.animates"],
      [{ ...base, items: [] }, "items is empty"],
    ])
      expect(validatePlan(bad).errors.join(" "), message).toContain(message);
    // an item that can't be triggered automatically needs no element or expectation
    expect(
      validatePlan({ ...base, items: [{ id: "M2", name: "Trail", tag: "detail", trigger: "other" }] }).errors,
    ).toEqual([]);
  });

  it("reads the Motion block's items, ids and tags, and nothing else", () => {
    const md = `## Brief\n| Reference | Take |\n| --- | --- |\n| Linear | header |\n\n**Motion:** advanced\n\n| Item | Trigger → behaviour | Timing | Reduced motion | Tag |\n| --- | --- | --- | --- | --- |\n| M1 · Hero entrance | load → fade up | 250 ms | at once | essential |\n| M2: Sticky header | scroll | none | same | detail |\n| Old row without id | hover | 200 ms | none | essential |\n\nText after.`;
    expect(parseBriefMotion(md)).toEqual([
      { id: "M1", name: "Hero entrance", tag: "essential" },
      { id: "M2", name: "Sticky header", tag: "detail" },
      { id: null, name: "Old row without id", tag: "essential" },
    ]);
  });

  it("traces the plan to the brief: unchecked items, checks the brief doesn't have, and the brief's tags", () => {
    const brief = [
      { id: "M1", name: "Hero", tag: "essential" },
      { id: "M2", name: "Header", tag: "detail" },
      { id: "M3", name: "Reveal", tag: "essential" },
    ];
    const t = traceItems([item(), item({ id: "M2", tag: "essential" }), item({ id: "M9" })], brief);
    expect(t).toMatchObject({
      checked: true,
      missing: [{ id: "M3" }],
      extra: ["M9"],
      tagMismatch: [{ id: "M2", plan: "essential", brief: "detail" }],
    });
    expect(traceItems([item()], null).checked).toBe(false);
  });
});

describe("judging one item", () => {
  it("passes only when every check was executed and observed as briefed", () => {
    const j = judgeItem(item(), runs([obs(), obs()], [still(), still()]), DESKTOP);
    expect(j.result).toBe("Pass");
    expect(j.checks.every((c) => c.status === "pass")).toBe(true);
    expect(j.checks.map((c) => `${c.mode} ${c.check}`)).toEqual([
      "full trigger",
      "full moves",
      "full properties",
      "full final state",
      "full replay",
      "reduced moves",
      "reduced final state",
      "reduced replay",
    ]);
  });

  it("missing or failed execution is Not Verified, never Pass", () => {
    expect(judgeItem(item(), {}, DESKTOP).result).toBe("Not Verified");
    const notFound = judgeItem(
      item(),
      runs([{ executed: false, error: "element #hero not found" }], [still(), still()]),
      DESKTOP,
    );
    expect(notFound.result).toBe("Not Verified");
    expect(notFound.checks[0]).toMatchObject({
      check: "trigger",
      status: "not verified",
      detail: "element #hero not found",
    });
    const other = judgeItem(item({ trigger: { type: "other", note: "follows the pointer" } }), {}, DESKTOP);
    expect(other).toMatchObject({ result: "Not Verified", checks: [{ status: "not verified" }] });
    expect(other.checks[0].detail).toContain("follows the pointer");
  });

  it("fails when the motion doesn't happen, ends elsewhere or animates other properties", () => {
    expect(statusOf(judgeItem(item(), runs([still(), still()], [still(), still()]), DESKTOP), "moves")).toBe("fail");
    const wrongEnd = judgeItem(
      item(),
      runs([obs({ end: { opacity: "0.6", transform: "none" } }), obs()], [still(), still()]),
      DESKTOP,
    );
    expect(wrongEnd.result).toBe("Fail");
    expect(wrongEnd.checks.find((c) => c.check === "final state").detail).toBe("opacity 0.6 instead of 1");
    const onlyOpacity = obs({ properties: ["opacity"] });
    expect(
      statusOf(judgeItem(item(), runs([onlyOpacity, onlyOpacity], [still(), still()]), DESKTOP), "properties"),
    ).toBe("fail");
  });

  it("compares declared timing exactly as the brief writes it, and can't verify motion that declares none", () => {
    const timed = item({ expect: { ...item().expect, durationMs: 250, easing: "ease-out" } });
    const ok = obs({ declared: [{ name: "rise", durationMs: 250, easing: "ease-out" }] });
    expect(statusOf(judgeItem(timed, runs([ok, ok], [still(), still()]), DESKTOP), "timing")).toBe("pass");
    const slow = obs({ declared: [{ name: "rise", durationMs: 251, easing: "ease-out" }] });
    expect(statusOf(judgeItem(timed, runs([slow, slow], [still(), still()]), DESKTOP), "timing")).toBe("fail");
    const scripted = obs({ declared: [] });
    const j = judgeItem(timed, runs([scripted, scripted], [still(), still()]), DESKTOP);
    expect(statusOf(j, "timing")).toBe("not verified");
    expect(j.result).toBe("Not Verified");
  });

  it("a page that never stopped animating before the trigger can't pass", () => {
    const busy = obs({ unsettled: true });
    const j = judgeItem(item(), runs([busy, obs()], [still(), still()]), DESKTOP);
    expect(statusOf(j, "settled")).toBe("not verified");
    expect(j.result).toBe("Not Verified");
  });

  it("checks Replay: a second run that differs fails, a replay that didn't run isn't verified", () => {
    const differs = judgeItem(item(), runs([obs(), still()], [still(), still()]), DESKTOP);
    expect(statusOf(differs, "replay")).toBe("fail");
    expect(differs.checks.find((c) => c.check === "replay").detail).toContain("motion true then false");
    const noReplay = judgeItem(item(), runs([obs()], [still(), still()]), DESKTOP);
    expect(statusOf(noReplay, "replay")).toBe("not verified");
    expect(noReplay.result).toBe("Not Verified");
    expect(signature(obs())).toBe(signature(obs({ evidence: [{ file: "x.png" }], cls: 0.2 })));
  });

  it("reduced motion: content must still arrive, movement must go, and the brief must say what to expect", () => {
    // the common defect: `animation: none` leaves the element at its hidden starting state
    const hidden = still({ end: { opacity: "0", transform: "none" } });
    const j = judgeItem(item(), runs([obs(), obs()], [hidden, hidden]), DESKTOP);
    expect(j.result).toBe("Fail");
    expect(j.checks.find((c) => c.mode === "reduced" && c.check === "final state").detail).toBe(
      "opacity 0 instead of 1",
    );
    // a gentler alternative is allowed when briefed: a fade is fine, movement isn't
    const fadeOnly = item({ reduced: { animates: true, properties: ["opacity"], notProperties: ["transform"] } });
    const fade = obs({ properties: ["opacity"], animated: ["opacity"] });
    expect(judgeItem(fadeOnly, runs([obs(), obs()], [fade, fade]), DESKTOP).result).toBe("Pass");
    const stillMoves = obs();
    expect(
      statusOf(judgeItem(fadeOnly, runs([obs(), obs()], [stillMoves, stillMoves]), DESKTOP), "no movement", "reduced"),
    ).toBe("fail");
    // turning everything off isn't assumed to be right: without the brief's reduced behaviour, it isn't verified
    const unbriefed = judgeItem(item({ reduced: undefined }), runs([obs(), obs()]), DESKTOP);
    expect(unbriefed.result).toBe("Not Verified");
    expect(unbriefed.checks.at(-1).detail).toContain("no reduced-motion behaviour");
  });

  it("budgets come only from the brief; unmeasured is Not Verified", () => {
    const budget = item({ budgets: { cls: 0 } });
    expect(
      statusOf(judgeItem(budget, runs([obs({ cls: 0.05 }), obs()], [still(), still()]), DESKTOP), "layout shift"),
    ).toBe("fail");
    expect(
      statusOf(judgeItem(budget, runs([obs({ cls: null }), obs()], [still(), still()]), DESKTOP), "layout shift"),
    ).toBe("not verified");
    // without a budget the value is reported, never judged
    expect(judgeItem(item(), runs([obs({ cls: 0.3 }), obs()], [still(), still()]), DESKTOP).result).toBe("Pass");
  });

  it("a failure at any viewport fails the item", () => {
    const both = [...DESKTOP, { name: "phone", width: 390, height: 844 }];
    const r = {
      desktop: { full: [obs(), obs()], reduced: [still(), still()] },
      phone: { full: [still(), still()], reduced: [still(), still()] },
    };
    const j = judgeItem(item(), r, both);
    expect(j.result).toBe("Fail");
    expect(j.checks.find((c) => c.status === "fail").viewport).toBe("phone");
  });
});

describe("overall status", () => {
  const traced = { checked: true, missing: [], extra: [], unnamed: 0, tagMismatch: [] };
  const it2 = (id, tag, result) => ({ id, tag, result });

  it("is Pass only when every essential item of the approved brief passed", () => {
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "detail", "Pass")], traced).status).toBe("Pass");
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "essential", "Fail")], traced).status).toBe("Fail");
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "essential", "Not Verified")], traced).status).toBe(
      "Not Verified",
    );
    // Fail wins over Not Verified
    expect(aggregate([it2("M1", "essential", "Not Verified"), it2("M2", "essential", "Fail")], traced).status).toBe(
      "Fail",
    );
  });

  it("can't pass without the brief, with an unchecked essential item, an untraced check, or nothing essential", () => {
    const ok = [it2("M1", "essential", "Pass")];
    expect(aggregate(ok, { ...traced, checked: false }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, missing: [{ id: "M2", tag: "essential" }] }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, extra: ["M9"] }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, unnamed: 1 }).status).toBe("Not Verified");
    expect(aggregate([it2("M1", "detail", "Pass")], traced).status).toBe("Not Verified");
    // a detail item that wasn't checked doesn't block, but it is listed
    const r = aggregate(ok, { ...traced, missing: [{ id: "M2", tag: "detail" }] });
    expect(r.status).toBe("Pass");
  });

  it("detail failures don't decide the status but are reported", () => {
    const r = aggregate([it2("M1", "essential", "Pass"), it2("M2", "detail", "Fail")], traced);
    expect(r).toMatchObject({ status: "Pass", detailFailures: ["M2"], counts: { Fail: { essential: 0, detail: 1 } } });
  });
});

describe("the report", () => {
  it("says where each result comes from and what wasn't verified", () => {
    const report = {
      tool: { version: "1.0.0" },
      project: "Orbit",
      implementation: "git abc123",
      brief: { label: "session s1, approved brief", sha256: "f".repeat(64) },
      target: { label: "http://127.0.0.1:5173/" },
      environment: {
        browser: "Chromium 1",
        playwright: "1.64.1",
        os: "Darwin",
        node: "Node v26",
        reducedMotion: "browser emulation (Playwright reducedMotion: reduce / no-preference), Chromium only",
      },
      viewports: DESKTOP,
      plan: { sha256: "a".repeat(64) },
      startedAt: "2026-11-04T00:00:00Z",
      trace: { missing: [{ id: "M3", name: "Reveal", tag: "essential" }] },
      items: [
        {
          ...item(),
          result: "Fail",
          intent: "fade up",
          checks: [
            {
              viewport: "desktop",
              mode: "reduced",
              check: "final state",
              status: "fail",
              detail: "opacity 0 instead of 1",
            },
          ],
          observations: [],
        },
      ],
      overall: { status: "Fail", reasons: ["essential items failed: M1"] },
      limitations: [
        "Reduced motion was browser emulation in Chromium (Playwright). The OS setting and real devices weren't checked",
      ],
      specialists: [{ name: "animation-performance", phase: "qa", run: "consulted" }],
    };
    const md = renderMarkdown(report);
    expect(md).toContain("# Motion QA: Orbit — Fail");
    expect(md).toContain("- Implementation: git abc123");
    expect(md).toContain("| M3 | Reveal | essential | – | Not Verified (no check) | – |");
    expect(md).toContain("**Fail** (desktop, reduced) final state: opacity 0 instead of 1");
    expect(md).toContain("real devices weren't checked");
    expect(md).toContain("Specialists (declared by the agent, not checked here; trace-check verifies them)");
    expect(md).toContain("- animation-performance — qa — consulted");
  });
});

describe("in a transcript", () => {
  const line = (i, name, input, error = false) => [
    JSON.stringify({
      type: "assistant",
      timestamp: `2026-11-04T10:00:${String(i).padStart(2, "0")}.000Z`,
      cwd: "/work/target",
      message: { content: [{ type: "tool_use", id: `t${i}`, name, input }] },
    }),
    JSON.stringify({
      type: "user",
      timestamp: `2026-11-04T10:00:${String(i).padStart(2, "0")}.500Z`,
      message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "ok", is_error: error }] },
    }),
  ];
  it("trace-check counts motion QA runs apart from specialists, and never as a specialist run", () => {
    const skill = "/Users/u/.claude/skills/pivot-design/scripts/motion-qa.mjs";
    const text = [
      ...line(0, "Bash", { command: `node ${skill} /tmp/s/plan.json --out /tmp/s/qa --brief /tmp/s/brief.md` }, true),
      ...line(1, "Bash", { command: `node ${skill} --self-test --out /tmp/s/self` }),
      ...line(2, "Bash", { command: `cat ${skill}` }),
      // a read inside a compound command isn't a run (seen in a real trace)
      ...line(4, "Bash", { command: `P=/tmp/s; cat $P/brief.md; sed -n 1,200p ${skill}` }, true),
      ...line(5, "Bash", { command: `cd /tmp/s && sed -n 1000,1200p ${skill} | grep -n argv` }),
      ...line(3, "Read", { file_path: "/Users/u/.claude/skills/review-animations/SKILL.md" }),
    ].join("\n");
    const r = analyze(parseTranscript(text), { target: "/work/target", scratch: "/tmp/s" });
    expect(r.motionQa).toEqual({ runs: 1, selfTests: 1, nonZeroExits: 1 });
    expect(Object.keys(r.specialists)).toEqual(["review-animations"]);
    expect(r.specialists["review-animations"].label).toBe("consulted");
    expect(r.writes.target).toBe(0);
  });
});

describe("in a browser", () => {
  it("fails clearly, with exit code 3, where PIVOT's Playwright can't be found", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-alone-"));
    try {
      const copy = path.join(dir, "motion-qa.mjs");
      fs.copyFileSync(scriptPath, copy);
      fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ target: { file: copy }, items: [item()] }));
      const env = { ...process.env };
      delete env.PIVOT_REPO;
      let out = null;
      try {
        execFileSync(process.execPath, [copy, path.join(dir, "plan.json"), "--out", path.join(dir, "qa")], {
          env,
          stdio: "pipe",
        });
      } catch (err) {
        out = { status: err.status, stderr: String(err.stderr) };
      }
      expect(out?.status).toBe(3);
      expect(out?.stderr).toContain("Playwright not found");
      expect(out?.stderr).toContain("Not Verified");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("on the fixture page: catches the defects, repeats on Replay, keeps evidence with its provenance", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-test-"));
    try {
      const r = await qa.selfTest({ out, viewports: ["desktop"] });
      expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
      expect(r.ok).toBe(true);
      const { report } = r;
      expect(report.overall.status).toBe("Fail");
      expect(report.environment.browser).toMatch(/^Chromium \d/);
      expect(report.environment.reducedMotion).toContain("browser emulation");
      expect(report.limitations.join(" ")).toContain("real devices weren't checked");
      expect(report.target.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(report.brief.sha256).toMatch(/^[0-9a-f]{64}$/);
      // every observation of an executed item ran twice per mode: the first run and the Replay
      const m1 = report.items.find((i) => i.id === "M1");
      expect(m1.observations.map((o) => `${o.mode}/${o.run}`)).toEqual([
        "full/first",
        "full/replay",
        "reduced/first",
        "reduced/replay",
      ]);
      expect(m1.observations.every((o) => o.executed && o.evidence.length)).toBe(true);
      expect(fs.existsSync(path.join(out, "run", "report.md"))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
