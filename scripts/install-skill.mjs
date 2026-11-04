// Links the repo's PIVOT skills (pivot-design, pivot-redesign) into ~/.claude/skills and its subagents
// (pivot-specialist, test-runner, qa-reviewer) into ~/.claude/agents, so every project's Claude Code sees them and
// edits in the repo apply at once. Refuses to replace anything that isn't already this link.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeDir = path.join(os.homedir(), ".claude");
const skillsDir = process.env.CLAUDE_SKILLS_DIR ?? path.join(claudeDir, "skills");
const agentsDir = process.env.CLAUDE_AGENTS_DIR ?? path.join(claudeDir, "agents");

/** [what is linked, the file that must exist in it, where the link goes, link type] */
const LINKS = [
  ...["pivot-design", "pivot-redesign"].map((name) => [
    path.join(repo, ".claude/skills", name),
    "SKILL.md",
    path.join(skillsDir, name),
    "dir",
  ]),
  ...["pivot-specialist", "test-runner", "qa-reviewer"].map((name) => [
    path.join(repo, ".claude/agents", `${name}.md`),
    "",
    path.join(agentsDir, `${name}.md`),
    "file",
  ]),
];

let failed = false;
for (const [source, mustHave, target, type] of LINKS) {
  if (!fs.existsSync(path.join(source, mustHave))) {
    console.error(`Nothing to link at ${source}.`);
    failed = true;
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let existing = null;
  try {
    existing = fs.lstatSync(target);
  } catch {
    // nothing there yet
  }
  if (existing) {
    if (existing.isSymbolicLink() && path.resolve(path.dirname(target), fs.readlinkSync(target)) === source) {
      console.log(`Already linked: ${target} → ${source}`);
      continue;
    }
    console.error(`${target} already exists and isn't a link to this repo. Move it away, then run this again.`);
    failed = true;
    continue;
  }
  fs.symlinkSync(source, target, type);
  console.log(`Linked ${target} → ${source}`);
}
if (failed) process.exit(1);
