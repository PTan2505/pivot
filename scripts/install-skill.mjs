// Links the repo's PIVOT skills (pivot-design, pivot-redesign) into ~/.claude/skills, so every project's Claude Code
// sees them and edits in the repo apply at once. Refuses to replace anything that isn't already this link.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = ["pivot-design", "pivot-redesign"];
const repoSkills = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/skills");
const skillsDir = process.env.CLAUDE_SKILLS_DIR ?? path.join(os.homedir(), ".claude", "skills");
fs.mkdirSync(skillsDir, { recursive: true });

let failed = false;
for (const name of SKILLS) {
  const source = path.join(repoSkills, name);
  const target = path.join(skillsDir, name);
  if (!fs.existsSync(path.join(source, "SKILL.md"))) {
    console.error(`No skill at ${source}.`);
    failed = true;
    continue;
  }
  let existing = null;
  try {
    existing = fs.lstatSync(target);
  } catch {
    // nothing there yet
  }
  if (existing) {
    if (existing.isSymbolicLink() && path.resolve(skillsDir, fs.readlinkSync(target)) === source) {
      console.log(`Already linked: ${target} → ${source}`);
      continue;
    }
    console.error(`${target} already exists and isn't a link to this repo. Move it away, then run this again.`);
    failed = true;
    continue;
  }
  fs.symlinkSync(source, target, "dir");
  console.log(`Linked ${target} → ${source}`);
}
if (failed) process.exit(1);
