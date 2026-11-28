// The npm packages a component's or a design's script files import, read from the code itself. 21st's own answer
// often lists none (its `npmDependencies` came back empty for code that imports `motion`), so the preview build adds
// what the code imports and the save answer names what is missing. Pure: no Node APIs, so the MCP server can use it.

const SCRIPT = /\.[cm]?[jt]sx?$/;

// import x from "p" · import "p" · import type x from "p" · export * from "p" · import("p") · require("p")
const SPECIFIER =
  /\bimport\s+(type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"'\n]+)["']|\bexport\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']|\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)|\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

const NODE_BUILTINS = new Set(
  "assert buffer child_process crypto dns events fs http http2 https module net os path perf_hooks process querystring readline stream string_decoder timers tls url util v8 vm worker_threads zlib".split(
    " ",
  ),
);

const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** The npm package an import specifier names, or null for a relative, aliased, built-in or URL import. */
export function packageOf(spec: string): string | null {
  if (/^(?:\.|\/|@\/|~\/|#|node:|[a-z][a-z0-9+.-]*:)/i.test(spec)) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (NODE_BUILTINS.has(name) || !NPM_NAME.test(name)) return null;
  return name;
}

/** Every npm package the script files import at runtime (type-only imports left out), in first-seen order. */
export function importedPackages(files: { path: string; code: string }[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    if (!SCRIPT.test(f.path)) continue;
    for (const m of f.code.matchAll(SPECIFIER)) {
      if (m[1] || m[3]) continue; // import type / export type
      const name = packageOf(m[2] ?? m[4] ?? m[5] ?? m[6]);
      if (name) out.add(name);
    }
  }
  return [...out];
}

/** The imported packages a dependency list doesn't name (React and React DOM are always there). */
export function missingDependencies(files: { path: string; code: string }[], deps: { name: string }[]): string[] {
  const have = new Set(["react", "react-dom", ...deps.map((d) => d.name)]);
  return importedPackages(files).filter((n) => !have.has(n));
}
