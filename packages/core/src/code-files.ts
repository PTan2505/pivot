// What every kind of saved code shares (docs/my-designs-plan.md): relative file paths, npm names, the hash of a set of
// files and the scan that flags what a reviewer should look at. Used by 21st components (components.ts) and by the
// owner's own designs (my-designs.ts). Pure: no database, no network.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ComponentScanFlag } from "./types";

/** npm's own rule for package names (lowercase, optional scope). */
export const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
/** A registry version or range only: no git, file, link, URL or alias specs, which npm would fetch from elsewhere. */
export const NPM_VERSION = /^[0-9A-Za-z.\-^~<>=*|+ ]{1,100}$/;

/** A relative path like `components/ui/orbit.tsx`: no leading `/`, no `..`, no backslashes, no empty parts. */
export const relativePath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((part) => part === ".." || part === ""),
    "must be a relative path like components/ui/orbit.tsx (no .., no leading /)",
  );

/** Values that look like a credential. */
export const SECRET_PATTERNS: RegExp[] = [
  /\b(sk|pk|rk)[-_](live|test|proj)?[-_]?[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b(token|secret|password|passwd|auth|access_key|apikey|key)=(?!\$)[^\s&"']{8,}/i,
];

/**
 * Credentials that are never a coincidence inside source code: provider keys with their own prefixes and private-key
 * blocks. Narrower than SECRET_PATTERNS, whose `key=value` rule would also match ordinary code.
 */
export const CODE_SECRET_PATTERNS: RegExp[] = [
  /\b(sk|rk)[-_](live|proj)[-_][A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/,
];

/** Where the first credential-looking value in this text is (1-based line), or null. Never returns the value. */
export function findSecretLine(text: string, patterns: RegExp[] = CODE_SECRET_PATTERNS): number | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) if (patterns.some((p) => p.test(lines[i]))) return i + 1;
  return null;
}

/**
 * Files PIVOT never stores, whatever the caller says: environment files, keys and certificates, npm and git config that
 * can hold tokens, and anything inside node_modules or .git.
 */
export function refusedFileReason(p: string): string | null {
  const parts = p.split("/");
  const base = parts[parts.length - 1].toLowerCase();
  if (parts.some((part) => part === "node_modules")) return "it is inside node_modules";
  if (parts.some((part) => part === ".git")) return "it is inside .git";
  if (base === ".env" || base.startsWith(".env.")) return "it is an environment file";
  if (/\.(pem|key|p12|pfx|crt|cer|der|keystore|jks)$/.test(base)) return "it is a key or certificate";
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base)) return "it is an SSH key";
  if (base === ".npmrc" || base === ".yarnrc.yml" || base === ".netrc" || base === ".git-credentials")
    return "it can hold registry or git tokens";
  return null;
}

/** sha256 over files in path order (path, then code), so the same set of files always gives the same hash. */
export function filesSha(files: { path: string; code: string }[]) {
  const h = createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path).update("\0").update(f.code).update("\0");
  }
  return h.digest("hex");
}

// ---- the scan --------------------------------------------------------------------------------------------------

type Rule = { kind: string; what: string; re: RegExp };

const LINE_RULES: Rule[] = [
  { kind: "network", what: "fetch(", re: /\bfetch\s*\(/ },
  { kind: "network", what: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { kind: "network", what: "WebSocket", re: /\bnew\s+WebSocket\b/ },
  { kind: "network", what: "EventSource", re: /\bnew\s+EventSource\b/ },
  { kind: "network", what: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { kind: "network", what: "a source set at runtime (.src =)", re: /\.src\s*=(?!=)/ },
  { kind: "dynamic-code", what: "eval(", re: /(^|[^.\w])eval\s*\(/ },
  { kind: "dynamic-code", what: "new Function(", re: /\bnew\s+Function\s*\(/ },
  { kind: "dynamic-code", what: "a timer run from a string", re: /\bset(Timeout|Interval)\s*\(\s*["'`]/ },
  { kind: "dynamic-code", what: "import() of a URL", re: /\bimport\s*\(\s*["'`]https?:/ },
  { kind: "dynamic-code", what: "a script element made at runtime", re: /createElement\s*\(\s*["'`]script["'`]/i },
  { kind: "dynamic-code", what: "document.write", re: /\bdocument\.write(ln)?\s*\(/ },
  {
    kind: "dynamic-code",
    what: "dangerouslySetInnerHTML with a value that isn't a literal",
    re: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!["'`])/,
  },
  { kind: "beyond-component", what: "document.cookie", re: /\bdocument\.cookie\b/ },
  { kind: "beyond-component", what: "localStorage / sessionStorage", re: /\b(localStorage|sessionStorage)\b/ },
  { kind: "beyond-component", what: "reading the clipboard", re: /\bnavigator\.clipboard\.read/ },
  { kind: "beyond-component", what: "navigator.credentials", re: /\bnavigator\.credentials\b/ },
  {
    kind: "beyond-component",
    what: "the parent or top window",
    re: /\bwindow\.(parent|top|opener)\b|\b(top|parent)\.location\b/,
  },
  { kind: "beyond-component", what: 'postMessage to "*"', re: /postMessage\s*\([^)]*,\s*["'`]\*["'`]\s*\)/ },
  { kind: "obfuscation", what: "atob(", re: /\batob\s*\(/ },
  { kind: "obfuscation", what: "a run of escaped characters", re: /(\\x[0-9a-fA-F]{2}){8,}|(\\u[0-9a-fA-F]{4}){8,}/ },
];

const LONG_STRING = /[A-Za-z0-9+/=_-]{200,}/;
const LONG_LINE = 1000;
/** Hosts every SVG or XML file names: never a request. */
const QUIET_HOSTS = new Set(["www.w3.org"]);
export const MAX_FLAGS = 200;

export function excerpt(line: string, index: number) {
  const t = line.trim();
  if (t.length <= 160) return t;
  const start = Math.max(0, index - 60);
  return `${start > 0 ? "…" : ""}${line.slice(start, start + 160).trim()}…`;
}

/**
 * Network use and hosts, code run from strings, reaching beyond the code's own element, obfuscation: what a reviewer
 * should look at before this code goes into a project. Flags only: it never blocks.
 */
export function scanFiles(files: { path: string; code: string }[]): {
  flags: ComponentScanFlag[];
  hosts: string[];
} {
  const flags: ComponentScanFlag[] = [];
  const hosts = new Set<string>();
  const add = (f: ComponentScanFlag) => flags.length < MAX_FLAGS && flags.push(f);
  for (const file of files) {
    const lines = file.code.split("\n");
    lines.forEach((line, i) => {
      for (const r of LINE_RULES) {
        const m = r.re.exec(line);
        if (m) add({ kind: r.kind, what: r.what, file: file.path, line: i + 1, excerpt: excerpt(line, m.index) });
      }
      const long = LONG_STRING.exec(line);
      if (long) {
        add({
          kind: "obfuscation",
          what: `an encoded-looking string of ${long[0].length} characters`,
          file: file.path,
          line: i + 1,
          excerpt: excerpt(line, long.index),
        });
      }
      if (line.length > LONG_LINE) {
        add({
          kind: "obfuscation",
          what: `a line of ${line.length} characters`,
          file: file.path,
          line: i + 1,
          excerpt: excerpt(line, 0),
        });
      }
      for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = m[1].toLowerCase();
        if (QUIET_HOSTS.has(host) || hosts.has(host)) continue;
        hosts.add(host);
        add({ kind: "host", what: host, file: file.path, line: i + 1, excerpt: excerpt(line, m.index ?? 0) });
      }
    });
  }
  return { flags, hosts: [...hosts].sort() };
}
