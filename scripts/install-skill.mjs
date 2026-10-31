// Links the repo's pivot-design skill into ~/.claude/skills, so every project's Claude Code sees it and edits in the
// repo apply at once. Refuses to replace anything that isn't already this link.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.claude/skills/pivot-design");
const skillsDir = process.env.CLAUDE_SKILLS_DIR ?? path.join(os.homedir(), ".claude", "skills");
const target = path.join(skillsDir, "pivot-design");

if (!fs.existsSync(path.join(source, "SKILL.md"))) {
  console.error(`No skill at ${source}.`);
  process.exit(1);
}
fs.mkdirSync(skillsDir, { recursive: true });

let existing = null;
try {
  existing = fs.lstatSync(target);
} catch {
  // nothing there yet
}
if (existing) {
  if (existing.isSymbolicLink() && path.resolve(skillsDir, fs.readlinkSync(target)) === source) {
    console.log(`Already linked: ${target} → ${source}`);
    process.exit(0);
  }
  console.error(`${target} already exists and isn't a link to this repo. Move it away, then run this again.`);
  process.exit(1);
}
fs.symlinkSync(source, target, "dir");
console.log(`Linked ${target} → ${source}`);
