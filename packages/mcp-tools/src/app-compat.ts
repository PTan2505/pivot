import { API_FEATURES, type ApiFeature } from "@pivot/core/capabilities";
import required from "./required-app-features.json";
import { ToolError } from "./source";

/**
 * Which app this MCP server can work with. The plugin (MCP server, skills) updates from GitHub, the app from npm, so
 * an installed app can be older than the plugin that calls it. Like the extension, the server checks the features it
 * needs in `GET /api/capabilities` instead of comparing version numbers.
 */
export const REQUIRED_APP_FEATURES = required.features as ApiFeature[];

// A misspelt feature would block every app, so it fails here, at import, in the tests.
for (const f of REQUIRED_APP_FEATURES)
  if (!(API_FEATURES as readonly string[]).includes(f)) throw new Error(`Unknown app feature required: ${f}`);

/** The required features the app's `/api/capabilities` answer lacks (an unreadable answer lacks them all). */
export function missingAppFeatures(capabilities: unknown): ApiFeature[] {
  const listed = (capabilities as { features?: unknown } | null)?.features;
  const have = new Set(Array.isArray(listed) ? listed.filter((f): f is string => typeof f === "string") : []);
  return REQUIRED_APP_FEATURES.filter((f) => !have.has(f));
}

/** How to update the app, for both the MCP error and the SessionStart hook (which words it the same way). */
export const UPDATE_APP =
  "Update it: stop PIVOT, then start it again with `npx pivot-studio@latest` (or `git pull` and `npm start` in a PIVOT checkout).";

export function appOutdated(base: string, missing: string[]) {
  return new ToolError(
    "app_outdated",
    `The PIVOT app at ${base} is older than this plugin: it lacks ${missing.join(", ")}. ${UPDATE_APP} Then try again.`,
  );
}
