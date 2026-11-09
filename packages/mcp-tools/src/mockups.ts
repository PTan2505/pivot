import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Makes a mockup file self-contained before it is stored in PIVOT, which serves it sandboxed with no scripts and no
// other hosts. Runs where the files are (the agent's machine), and reads nothing outside the mockup's own folder:
//
// - The folder is the HTML file's directory, both as written and with symlinks followed (realpath). Each local
//   reference is resolved against the document or stylesheet that makes it, percent-decoded exactly once, and must
//   stay inside the folder before and after symlinks are followed. Only regular files are read: stylesheets for
//   <link> and @import, images and fonts for url() and image attributes.
// - Fail closed: a reference that could reach a file outside the folder (absolute and Windows paths, `..` that leaves
//   it, encoded traversal, NUL, backslashes, file: URLs, malformed percent-encoding, a symlink out, a directory or
//   device) fails the whole mockup with MockupRejected, and so does going over the 2 MB inlining budget. Nothing is
//   stored, and errors name the reference as written, never a file's contents.
// - Remote URLs, other URL schemes, scripts, frames and plugins are removed and listed in `dropped`. Local files that
//   don't exist are listed in `missing`. Files inside the folder that can't be inlined (another type, a circular
//   @import, one more than 4 levels deep) are left out and listed in `skipped`.

/** What one mockup may inline in total: stylesheets, plus images and fonts as data: URIs, counted at every use. */
export const INLINE_BUDGET = 2 * 1024 * 1024;
/** How many levels of @import are followed below a <link> or <style>. */
export const MAX_IMPORT_DEPTH = 4;

/** The files a static mockup may turn into data: URIs: images and fonts. Stylesheets are inlined as text. */
const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface InlineReport {
  html: string;
  /** Remote URLs, other schemes, scripts, frames and plugins that were removed: they would not load in PIVOT anyway. */
  dropped: string[];
  /** Local files inside the mockup's folder that the mockup points to but don't exist. */
  missing: string[];
  /** Files inside the folder that were left out, with the reason: another type, a circular or too deep @import. */
  skipped: string[];
}

/** The mockup reaches outside its folder or over the inlining budget; nothing from it may be stored. */
export class MockupRejected extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("; "));
    this.name = "MockupRejected";
    this.problems = problems;
  }
}

export type RefKind =
  | { kind: "keep" } // data:, about:, a #fragment or empty: left as written
  | { kind: "external"; why: string } // never fetched: removed and reported
  | { kind: "reject"; why: string } // could reach outside the folder: fails the mockup
  | { kind: "local"; rel: string }; // a relative path, decoded once, still to be contained

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE = /^[a-z]:/i;

/** Classifies a reference as written, without touching the disk. Local paths are percent-decoded exactly once. */
export function classifyRef(raw: string): RefKind {
  const ref = raw.trim();
  if (ref === "" || ref.startsWith("#") || /^(data|about):/i.test(ref)) return { kind: "keep" };
  if (ref.includes("\0")) return { kind: "reject", why: "contains a NUL byte" };
  if (ref.includes("\\")) return { kind: "reject", why: "contains a backslash" };
  if (ref.startsWith("//")) return { kind: "external", why: "remote" };
  if (DRIVE.test(ref)) return { kind: "reject", why: "is an absolute Windows path" };
  const scheme = SCHEME.exec(ref)?.[0].toLowerCase();
  if (scheme === "file:") return { kind: "reject", why: "is a file: URL" };
  if (scheme === "http:" || scheme === "https:") return { kind: "external", why: "remote" };
  if (scheme) return { kind: "external", why: `unsupported scheme ${scheme}` };
  const bare = ref.split(/[?#]/)[0];
  if (bare.startsWith("/")) return { kind: "reject", why: "is an absolute path" };
  let rel: string;
  try {
    rel = decodeURIComponent(bare);
  } catch {
    return { kind: "reject", why: "has malformed percent-encoding" };
  }
  if (rel.includes("\0") || rel.includes("\\") || rel.startsWith("/") || DRIVE.test(rel) || SCHEME.test(rel))
    return { kind: "reject", why: "decodes to a NUL byte, a backslash, an absolute path or a URL scheme" };
  return { kind: "local", rel };
}

/** Whether `p` is `root` or below it. Compares path segments, never string prefixes. */
export function within(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

const show = (ref: string) => JSON.stringify(ref.length > 160 ? `${ref.slice(0, 160)}…` : ref);
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

const attr = (tag: string, name: string) =>
  tag
    .match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
    ?.slice(1)
    .find((v) => v != null);

interface Located {
  /** The path as resolved from the reference, inside the folder as written. */
  lexical: string;
  /** The same file with symlinks followed, inside the folder's real path. */
  real: string;
}

export async function inlineMockup(file: string): Promise<InlineReport> {
  const dropped: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  const lexRoot = path.dirname(path.resolve(file));
  const realRoot = await fs.realpath(lexRoot);
  const cache = new Map<string, Buffer>();
  let used = 0;

  const reject = (ref: string, why: string) => problems.push(`${show(ref)} ${why}`);
  const overBudget = (ref: string): never => {
    throw new MockupRejected([
      ...new Set(problems),
      `${show(ref)} goes over the 2 MB inlining budget: use smaller or fewer images (screenshots as WebP or JPEG)`,
    ]);
  };

  /** Where a local reference leads, or null when it is dropped, rejected or missing (each recorded). */
  async function locate(raw: string, baseDir: string): Promise<Located | "keep" | null> {
    const ref = classifyRef(raw);
    if (ref.kind === "keep") return "keep";
    if (ref.kind === "external") {
      dropped.push(raw.trim());
      return null;
    }
    if (ref.kind === "reject") {
      reject(raw, ref.why);
      return null;
    }
    const lexical = path.resolve(baseDir, ref.rel);
    if (!within(lexRoot, lexical)) {
      reject(raw, "points outside the mockup's folder");
      return null;
    }
    let real: string;
    try {
      real = await fs.realpath(lexical);
    } catch {
      missing.push(lexical);
      return null;
    }
    if (!within(realRoot, real)) {
      reject(raw, "leads outside the mockup's folder through a symlink");
      return null;
    }
    // before any type check: a directory, FIFO, socket or device fails the mockup whatever its name
    const st = await fs.stat(real).catch(() => null);
    if (!st) {
      missing.push(lexical);
      return null;
    }
    if (!st.isFile()) {
      reject(raw, "is not a regular file");
      return null;
    }
    return { lexical, real };
  }

  /** Reads a contained regular file once, then charges `cost` of its size to the budget at every use. */
  async function read(raw: string, at: Located, cost: (size: number) => number): Promise<Buffer | null> {
    let data = cache.get(at.real);
    if (!data) {
      try {
        const before = await fs.stat(at.real);
        if (!before.isFile()) {
          reject(raw, "is not a regular file");
          return null;
        }
        // O_NOFOLLOW: the last part can't have become a symlink; O_NONBLOCK: a FIFO swapped in can't hang the open.
        const fh = await fs.open(at.real, OPEN_FLAGS);
        try {
          const st = await fh.stat();
          if (
            !st.isFile() ||
            st.ino !== before.ino ||
            st.dev !== before.dev ||
            (await fs.realpath(at.real)) !== at.real
          ) {
            reject(raw, "changed while it was being read");
            return null;
          }
          if (used + cost(st.size) > INLINE_BUDGET) overBudget(raw); // the size is checked before anything is read
          const buf = Buffer.alloc(st.size);
          const { bytesRead } = await fh.read(buf, 0, st.size, 0);
          data = buf.subarray(0, bytesRead);
        } finally {
          await fh.close();
        }
      } catch (e) {
        if (e instanceof MockupRejected) throw e;
        if ((e as NodeJS.ErrnoException).code === "ELOOP") reject(raw, "changed while it was being read");
        else missing.push(at.lexical);
        return null;
      }
      cache.set(at.real, data);
    }
    if (used + cost(data.length) > INLINE_BUDGET) overBudget(raw);
    used += cost(data.length);
    return data;
  }

  async function dataUri(raw: string, baseDir: string): Promise<string | null> {
    const at = await locate(raw, baseDir);
    if (at === "keep") return raw;
    if (at === null) return null;
    const mime = ASSET_TYPES[path.extname(at.real).toLowerCase()];
    if (!mime) {
      skipped.push(`${raw.trim()} (not an image or font)`);
      return null;
    }
    const prefix = `data:${mime};base64,`;
    const data = await read(raw, at, (n) => prefix.length + 4 * Math.ceil(n / 3));
    return data && prefix + data.toString("base64");
  }

  /** A stylesheet's text with its local @imports (≤ 4 levels, no cycles) and url()s inlined. */
  async function css(text: string, baseDir: string, depth: number, chain: string[]): Promise<string> {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)) {
      out += text.slice(last, m.index);
      last = m.index! + m[0].length;
      const raw = m[1];
      const at = await locate(raw, baseDir);
      if (at === "keep") dropped.push(raw);
      if (at === "keep" || at === null) continue;
      if (path.extname(at.real).toLowerCase() !== ".css") skipped.push(`${raw} (not a stylesheet)`);
      else if (chain.includes(at.real)) skipped.push(`${raw} (circular @import)`);
      else if (depth >= MAX_IMPORT_DEPTH) skipped.push(`${raw} (@import more than ${MAX_IMPORT_DEPTH} levels deep)`);
      else {
        const data = await read(raw, at, (n) => n);
        if (data) out += await css(data.toString("utf8"), path.dirname(at.lexical), depth + 1, [...chain, at.real]);
      }
    }
    text = out + text.slice(last);
    // then url(...): images and fonts
    out = "";
    last = 0;
    for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
      out += text.slice(last, m.index);
      last = m.index! + m[0].length;
      const uri = await dataUri(m[2].trim(), baseDir);
      out += uri ? `url("${uri}")` : "url()";
    }
    return out + text.slice(last);
  }

  async function replaceAll(text: string, re: RegExp, fn: (m: RegExpMatchArray) => Promise<string>) {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += text.slice(last, m.index) + (await fn(m));
      last = m.index! + m[0].length;
    }
    return out + text.slice(last);
  }

  // The HTML file itself: a regular file in its folder (not a symlink out of it), within the budget.
  const realFile = await fs.realpath(file);
  if (!within(realRoot, realFile))
    throw new MockupRejected([`${show(file)} is a symlink to a file outside its folder`]);
  const fh = await fs.open(realFile, OPEN_FLAGS);
  let html: string;
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new MockupRejected([`${show(file)} is not a regular file`]);
    if (st.size > INLINE_BUDGET) throw new MockupRejected([`${show(file)} is over 2 MB`]);
    const buf = Buffer.alloc(st.size);
    html = buf.subarray(0, (await fh.read(buf, 0, st.size, 0)).bytesRead).toString("utf8");
  } finally {
    await fh.close();
  }

  // scripts never run in PIVOT (an unclosed <script> runs to the end of the document, so it goes to the end too)
  html = await replaceAll(
    html,
    /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>|<script\b[^>]*>[\s\S]*$/gi,
    async (m) => {
      dropped.push(attr(m[0], "src") ?? "inline <script>");
      return "";
    },
  );
  // nor frames and plugins; and nothing may redirect or re-base the page or loosen its policy
  html = await replaceAll(html, /<(iframe|frame|object|embed|applet)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi, async (m) => {
    dropped.push(`<${m[1].toLowerCase()}>`);
    return "";
  });
  html = await replaceAll(
    html,
    /<base\b[^>]*>|<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy|set-cookie)\b[^>]*>/gi,
    async (m) => {
      dropped.push(m[0].toLowerCase().startsWith("<base") ? "<base>" : "<meta http-equiv>");
      return "";
    },
  );
  // <link>: local stylesheets become <style>; everything else that points elsewhere goes
  html = await replaceAll(html, /<link\b[^>]*>/gi, async (m) => {
    const href = attr(m[0], "href") ?? "";
    const rel = (attr(m[0], "rel") ?? "").toLowerCase();
    const ref = classifyRef(href);
    if (rel.split(/\s+/).includes("stylesheet") && ref.kind !== "keep") {
      const at = await locate(href, lexRoot);
      if (at === "keep" || at === null) return "";
      if (path.extname(at.real).toLowerCase() !== ".css") {
        skipped.push(`${href} (not a stylesheet)`);
        return "";
      }
      const data = await read(href, at, (n) => n);
      return data ? `<style>${await css(data.toString("utf8"), path.dirname(at.lexical), 0, [at.real])}</style>` : "";
    }
    if (ref.kind === "external" && ref.why === "remote") {
      dropped.push(href);
      return "";
    }
    return m[0];
  });
  html = await replaceAll(html, /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, async (m) => {
    return `<style${m[1]}>${await css(m[2], lexRoot, 0, [])}</style>`;
  });
  html = await replaceAll(html, /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, async (m) => {
    const q = m[1];
    return ` style=${q}${(await css(m[2], lexRoot, 0, [])).replaceAll(q, q === '"' ? "'" : '"')}${q}`;
  });
  // images: <img src>, <source src>, <video poster>, <image href>; srcset keeps its first candidate
  html = await replaceAll(html, /<(img|source|video|image|input)\b[^>]*>/gi, async (m) => {
    let tag = m[0];
    const srcset = attr(tag, "srcset");
    if (srcset) tag = tag.replace(/\s(?:srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    for (const name of ["src", "poster", "href", "xlink:href"]) {
      const ref = attr(tag, name) ?? (name === "src" && srcset ? srcset.trim().split(/\s+/)[0] : undefined);
      if (ref == null || classifyRef(ref).kind === "keep") continue;
      const uri = (await dataUri(ref, lexRoot)) ?? "";
      const re = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
      tag = re.test(tag) ? tag.replace(re, ` ${name}="${uri}"`) : tag.replace(/^<\w+/, (t) => `${t} src="${uri}"`);
    }
    return tag;
  });

  if (problems.length) throw new MockupRejected([...new Set(problems)]);
  return {
    html,
    dropped: [...new Set(dropped)],
    missing: [...new Set(missing)],
    skipped: [...new Set(skipped)],
  };
}
