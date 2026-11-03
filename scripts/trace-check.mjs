#!/usr/bin/env node
// Reads Claude Code session transcripts (JSONL) and reports what a design run actually did: which specialists it ran,
// consulted or skipped, where it wrote, and whether it wrote to the target project before the design session was
// marked `building`. Development tool for the orchestrator's behavioural tests; it only reads.
//
//   node scripts/trace-check.mjs <session.jsonl> [--target <dir>] [--scratch <dir>] [--specialists a,b] [--json]
//     [--require-gate] [--all-names]
//
// Only skills installed in ~/.claude/skills, ~/.agents/skills or the target's .claude/skills are named; other names
// found in paths show as "(unrecognised)" unless --all-names is given.
// A session's subagent transcripts (<session>/subagents/*.jsonl) are read with it. The report holds tool names, skill
// names, counts and path categories only: never prompts, file contents, commands or tool results.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Our own skills: never counted as specialists. */
const OWN_SKILLS = new Set(["pivot-design", "pivot-redesign"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);
/** Shell commands that change files. A heuristic: the report marks these counts as such. */
const SHELL_WRITE =
  /(^|[;&|(]\s*|\s)(>>?(?!=)\s*[^&\s]|tee\b|sed\s+-i|perl\s+-i|mv\b|cp\b|rm\b|touch\b|mkdir\b|truncate\b|ln\b|git\s+(commit|apply|checkout|restore|reset|stash|merge|rebase)\b|(npm|pnpm|yarn|bun)\s+(i|install|add|remove)\b)/;
const SHELL_READ = /^\s*(cat|head|tail|sed\s+-n|less|grep|rg|ls|find|wc|file|stat)\b/;

/**
 * One transcript line becomes zero or more events: tool calls and tool results, in file order.
 * @param {string} text JSONL
 * @param {string} file label of the source file
 */
export function parseTranscript(text, file = "main") {
  const events = [];
  // A streamed message can be written more than once with the same tool_use id; count each call once.
  const seen = new Set();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let line;
    try {
      line = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const content = line?.message?.content;
    if (!Array.isArray(content)) continue;
    // Which subagent isn't reported: its id is an internal handle, and "main" vs "subagent" is what the checks need.
    const where = line.isSidechain || line.agentId ? "subagent" : "main";
    for (const block of content) {
      if (block?.type === "tool_use") {
        if (seen.has(block.id)) continue;
        seen.add(block.id);
        events.push({
          kind: "call",
          id: block.id,
          name: block.name,
          input: block.input ?? {},
          where,
          cwd: line.cwd ?? null,
          time: line.timestamp ?? null,
          order: [file, i],
        });
      } else if (block?.type === "tool_result") {
        events.push({ kind: "result", id: block.tool_use_id, error: block.is_error === true, time: line.timestamp });
      }
    }
  }
  return events;
}

/** Reads a session transcript and its subagent transcripts. */
export function loadSession(file) {
  const files = [file];
  const subDir = path.join(file.replace(/\.jsonl$/, ""), "subagents");
  if (fs.existsSync(subDir)) {
    for (const f of fs.readdirSync(subDir).sort()) if (f.endsWith(".jsonl")) files.push(path.join(subDir, f));
  }
  return files.flatMap((f, n) => parseTranscript(fs.readFileSync(f, "utf8"), n === 0 ? "main" : path.basename(f)));
}

const inside = (p, dir) => {
  if (!p || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
/** Skill names are folder names; anything else is reported as "(unnamed)" so no command text reaches the report. */
const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const skillName = (s) => {
  const name = String(s ?? "")
    .split(":")
    .pop();
  return NAME.test(name) ? name : "(unnamed)";
};
/** Every `/skills/<name>` folder in a path or command (`cd …/skills/x` included), from any skills folder (~/.claude/skills, ~/.agents/skills…). */
const skillsInPath = (p) => [
  ...new Set([...String(p ?? "").matchAll(/\/skills\/([A-Za-z0-9][\w.-]{0,63})(?=[/\s;:'"&|)]|$)/g)].map((m) => m[1])),
];
const pathOf = (input) => input.file_path ?? input.notebook_path ?? input.path ?? null;

/**
 * Classifies a run. `specialists` lists the names to report even when they never appear (to show a skip).
 * With `knownSkills`, any other name found in a path or a Skill call is reported as "(unrecognised)", so a word that
 * merely follows `/skills/` in a command never reaches the report.
 * @param {ReturnType<typeof parseTranscript>} events
 * @param {{ target?: string, scratch?: string, specialists?: string[], knownSkills?: Set<string> }} options
 */
export function analyze(events, { target, scratch, specialists = [], knownSkills } = {}) {
  const results = new Map(events.filter((e) => e.kind === "result").map((e) => [e.id, e]));
  const failed = (call) => results.get(call.id)?.error === true;
  const calls = events
    .filter((e) => e.kind === "call")
    .map((e, n) => ({ ...e, n }))
    .sort((a, b) => (a.time && b.time && a.time !== b.time ? (a.time < b.time ? -1 : 1) : a.n - b.n));

  const spec = new Map();
  const entry = (raw) => {
    const name = !knownSkills || knownSkills.has(raw) || specialists.includes(raw) ? raw : "(unrecognised)";
    if (!spec.has(name))
      spec.set(name, {
        skillCalls: 0,
        mainThreadSkillCalls: 0,
        scriptRuns: 0,
        reads: 0,
        failedReads: 0,
        failedSkillCalls: 0,
        where: new Set(),
      });
    return spec.get(name);
  };
  for (const name of specialists) entry(name);

  const writes = { target: 0, scratch: 0, other: 0, shellHeuristic: 0 };
  const gate = { building: null, buildingRefused: 0, approvalsRecorded: 0, firstTargetWrite: null };
  const mcp = {};

  calls.forEach((c, i) => {
    const name = c.name;
    if (name.startsWith("mcp__pivot__")) {
      const tool = name.slice("mcp__pivot__".length);
      mcp[tool] = (mcp[tool] ?? 0) + 1;
      if (tool === "set_design_status" && c.input.status === "building") {
        if (failed(c)) gate.buildingRefused++;
        else gate.building ??= i;
      }
      if (tool === "record_design_decision" && c.input.kind === "approval" && !failed(c)) gate.approvalsRecorded++;
      return;
    }
    if (name === "Skill") {
      const s = skillName(c.input.skill);
      if (OWN_SKILLS.has(s)) return;
      const e = entry(s);
      // A refused Skill call (unknown or not installed) counts as unavailable, never as a run.
      if (failed(c)) {
        e.failedSkillCalls++;
        e.where.add(c.where);
        return;
      }
      e.skillCalls++;
      e.where.add(c.where);
      if (c.where === "main") e.mainThreadSkillCalls++;
      return;
    }
    if (READ_TOOLS.has(name)) {
      const s = skillsInPath(pathOf(c.input) ?? c.input.pattern)[0];
      if (!s || OWN_SKILLS.has(s)) return;
      const e = entry(s);
      if (failed(c)) e.failedReads++;
      else e.reads++;
      e.where.add(c.where);
      return;
    }
    const recordWrite = (file, heuristic) => {
      const where = inside(file, target) ? "target" : inside(file, scratch) ? "scratch" : "other";
      writes[where]++;
      if (heuristic) writes.shellHeuristic++;
      if (where === "target") gate.firstTargetWrite ??= i;
    };
    if (WRITE_TOOLS.has(name)) {
      if (!failed(c)) recordWrite(pathOf(c.input), false);
      return;
    }
    if (name === "Bash") {
      const cmd = String(c.input.command ?? "");
      for (const s of skillsInPath(cmd)) {
        if (OWN_SKILLS.has(s)) continue;
        const e = entry(s);
        e.where.add(c.where);
        // Running a file from the skill's scripts/ or bin/ is execution; printing one is a read.
        const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (!SHELL_READ.test(cmd) && new RegExp(`/skills/${escaped}/(scripts|bin)/`).test(cmd)) e.scriptRuns++;
        else e.reads++;
      }
      // Redirects to /dev/null or between streams change no file.
      if (SHELL_WRITE.test(cmd.replace(/\d*>>?\s*\/dev\/null|\d*>&\d/g, ""))) {
        const hitsTarget = (target && cmd.includes(path.resolve(target))) || inside(c.cwd, target);
        const hitsScratch = (scratch && cmd.includes(path.resolve(scratch))) || inside(c.cwd, scratch);
        if (hitsTarget) recordWrite(path.resolve(target), true);
        else if (hitsScratch) recordWrite(path.resolve(scratch), true);
        else recordWrite(null, true);
      }
    }
  });

  const label = (e) =>
    e.skillCalls > 0
      ? "ran (skill)"
      : e.scriptRuns > 0
        ? "ran (script)"
        : e.reads > 0
          ? "consulted"
          : e.failedReads > 0 || e.failedSkillCalls > 0
            ? "unavailable"
            : "none";
  const specialistsOut = Object.fromEntries(
    [...spec]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([n, e]) => [n, { label: label(e), ...e, where: [...e.where].sort() }]),
  );

  const writeBeforeBuilding =
    gate.firstTargetWrite !== null && (gate.building === null || gate.firstTargetWrite < gate.building);
  return {
    calls: calls.length,
    specialists: specialistsOut,
    writes,
    gate: {
      ok: !writeBeforeBuilding,
      reason: writeBeforeBuilding
        ? gate.building === null
          ? "target written but the session was never marked building"
          : "target written before the session was marked building"
        : gate.firstTargetWrite === null
          ? "no target writes"
          : "target written only after the session was marked building",
      buildingMarked: gate.building !== null,
      buildingRefused: gate.buildingRefused,
      approvalsRecorded: gate.approvalsRecorded,
    },
    warnings: Object.entries(specialistsOut)
      .filter(([, e]) => e.mainThreadSkillCalls > 0)
      .map(([n]) => `${n}: invoked with the Skill tool in the main thread`),
    mcp,
  };
}

/** Skill folders installed for the user and in the target project: the names the CLI may print. */
function installedSkills(target) {
  const roots = [path.join(os.homedir(), ".claude", "skills"), path.join(os.homedir(), ".agents", "skills")];
  if (target) roots.push(path.join(target, ".claude", "skills"));
  const names = new Set();
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) if (fs.existsSync(path.join(dir, name, "SKILL.md"))) names.add(name);
  }
  return names;
}

function format(report) {
  const out = [`${report.calls} tool calls`];
  out.push("Specialists:");
  for (const [n, e] of Object.entries(report.specialists))
    out.push(`  ${n}: ${e.label}${e.where.length ? ` (${e.where.map((w) => w.split(":")[0]).join(", ")})` : ""}`);
  if (!Object.keys(report.specialists).length) out.push("  none seen");
  const w = report.writes;
  out.push(
    `Writes: target ${w.target}, scratch ${w.scratch}, other ${w.other} (${w.shellHeuristic} from shell commands)`,
  );
  out.push(`Gate: ${report.gate.ok ? "ok" : "FAILED"}: ${report.gate.reason}`);
  for (const warning of report.warnings) out.push(`Warning: ${warning}`);
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(target|scratch|specialists)$/));
  if (!file || !fs.existsSync(file)) {
    console.error(
      "Usage: node scripts/trace-check.mjs <session.jsonl> [--target <dir>] [--scratch <dir>] [--specialists a,b] [--json] [--require-gate] [--all-names]",
    );
    process.exit(2);
  }
  const report = analyze(loadSession(file), {
    target: opt("--target"),
    scratch: opt("--scratch"),
    specialists: opt("--specialists")?.split(",").filter(Boolean),
    knownSkills: args.includes("--all-names") ? undefined : installedSkills(opt("--target")),
  });
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : format(report));
  if (args.includes("--require-gate") && !report.gate.ok) process.exit(1);
}
