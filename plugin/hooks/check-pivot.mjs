#!/usr/bin/env node
// SessionStart hook: checks that the PIVOT app answers at the plugin's address, and that it isn't older than the plugin
// (it lists every feature in required-features.json, a copy pnpm mcp:build makes of the MCP server's list). Says
// nothing when all is well; otherwise tells Claude (context) and the user (a system message) what to do. Never fails
// the session.
import fs from "node:fs";

const base = (process.env.CLAUDE_PLUGIN_OPTION_PIVOT_URL || "http://127.0.0.1:4321").replace(/\/+$/, "");

function requiredFeatures() {
  try {
    return JSON.parse(fs.readFileSync(new URL("./required-features.json", import.meta.url), "utf8")).features ?? [];
  } catch {
    return [];
  }
}

/** The app's /api/capabilities answer, or null when PIVOT isn't what answers. */
async function capabilities() {
  try {
    const res = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(2500) });
    const body = res.ok ? await res.json() : null;
    return body?.app === "pivot" ? body : null;
  } catch {
    return null;
  }
}

const caps = await capabilities();
const have = new Set(Array.isArray(caps?.features) ? caps.features : []);
const missing = caps ? requiredFeatures().filter((f) => !have.has(f)) : [];
const message = !caps
  ? `PIVOT isn't running at ${base}, so the pivot tools and /pivot:design can't reach your reference library. Start it with \`npx pivot-studio\` (or \`npm start\` in a PIVOT checkout).`
  : missing.length
    ? `The PIVOT app at ${base} is older than the pivot plugin: it lacks ${missing.join(", ")}, so some pivot tools will fail. Update it: stop PIVOT, then start it again with \`npx pivot-studio@latest\` (or \`git pull\` and \`npm start\` in a PIVOT checkout).`
    : "";

if (message) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
    }),
  );
}
