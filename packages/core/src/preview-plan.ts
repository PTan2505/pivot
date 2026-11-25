// Whether and how a saved design's live preview is built (docs/my-designs-plan.md, Phase 3). No Node imports: the
// design's page uses it too, to offer Build preview only when a build can work.
import type { MyDesignMeta } from "./types";

const SCRIPT_FILE = /\.(tsx|ts|jsx|js|mjs)$/;
const HTML_FILE = /\.html?$/i;

/** How a saved design's preview is built: from its HTML demo, as a React component, or not at all (and why). */
export function myDesignPreviewPlan(
  d: Pick<MyDesignMeta, "files" | "dependencies">,
): { kind: "html"; file: string } | { kind: "react" } | { kind: "none"; reason: string } {
  const html =
    d.files.find((f) => f.role === "demo" && HTML_FILE.test(f.path)) ??
    d.files.find((f) => /(^|\/)index\.html?$/i.test(f.path));
  if (html) return { kind: "html", file: html.path };
  const usesReact = d.dependencies.some((x) => x.name === "react");
  if (
    d.files.some(
      (f) =>
        (f.role === "demo" || f.role === "component") &&
        (/\.(tsx|jsx)$/.test(f.path) || (usesReact && SCRIPT_FILE.test(f.path))),
    )
  )
    return { kind: "react" };
  return {
    kind: "none",
    reason:
      "PIVOT builds a live preview of a React design or of a design with an HTML demo page; this one has neither, so its screenshots stand in.",
  };
}
