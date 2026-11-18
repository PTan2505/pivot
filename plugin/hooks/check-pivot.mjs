#!/usr/bin/env node
// SessionStart hook: checks that the PIVOT app answers at the plugin's address. Says nothing when it does; otherwise
// tells Claude (context) and the user (a system message) how to start it. Never fails the session.
const base = (process.env.CLAUDE_PLUGIN_OPTION_PIVOT_URL || "http://127.0.0.1:4321").replace(/\/+$/, "");

async function isPivot() {
  try {
    const res = await fetch(`${base}/api/capabilities`, { signal: AbortSignal.timeout(2500) });
    return res.ok && (await res.json())?.app === "pivot";
  } catch {
    return false;
  }
}

if (!(await isPivot())) {
  const message = `PIVOT isn't running at ${base}, so the pivot tools and /pivot:design can't reach your reference library. Start it with \`npm start\` in your PIVOT folder.`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: message,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: message },
    }),
  );
}
