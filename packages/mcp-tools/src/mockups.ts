import fs from "node:fs/promises";
import path from "node:path";

// Makes a mockup file self-contained before it is stored in PIVOT, which serves it sandboxed with no scripts and no
// other hosts. Runs where the files are (the agent's machine): local stylesheets and @imports become inline <style>,
// local images and fonts become data: URIs, and anything remote or scripted is removed and reported.

const MIME: Record<string, string> = {
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
  /** Remote URLs and scripts that were removed: they would not load in PIVOT anyway. */
  dropped: string[];
  /** Local files the mockup points to that don't exist. */
  missing: string[];
}

const isRemote = (ref: string) => /^(https?:)?\/\//i.test(ref);
const isInline = (ref: string) => /^(data:|#|about:)/i.test(ref) || ref === "";
const attr = (tag: string, name: string) =>
  tag
    .match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
    ?.slice(1)
    .find((v) => v != null);

export async function inlineMockup(file: string): Promise<InlineReport> {
  const report: InlineReport = { html: "", dropped: [], missing: [] };
  const local = (ref: string, from: string) => path.resolve(path.dirname(from), decodeURI(ref.replace(/[?#].*$/, "")));

  async function dataUri(ref: string, from: string): Promise<string | null> {
    if (isInline(ref)) return ref;
    if (isRemote(ref) || /^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      report.dropped.push(ref);
      return null;
    }
    const p = local(ref, from);
    try {
      const data = await fs.readFile(p);
      return `data:${MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream"};base64,${data.toString("base64")}`;
    } catch {
      report.missing.push(p);
      return null;
    }
  }

  async function css(text: string, from: string, depth = 0): Promise<string> {
    // @import first: inline local ones (a few levels deep), drop remote ones
    let out = "";
    let last = 0;
    for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)) {
      out += text.slice(last, m.index);
      last = m.index! + m[0].length;
      const ref = m[1];
      if (isRemote(ref) || depth > 4) {
        report.dropped.push(ref);
        continue;
      }
      const p = local(ref, from);
      try {
        out += await css(await fs.readFile(p, "utf8"), p, depth + 1);
      } catch {
        report.missing.push(p);
      }
    }
    text = out + text.slice(last);
    // then url(...): images and fonts
    out = "";
    last = 0;
    for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
      out += text.slice(last, m.index);
      last = m.index! + m[0].length;
      const uri = await dataUri(m[2].trim(), from);
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

  let html = await fs.readFile(file, "utf8");

  // scripts never run in PIVOT
  html = await replaceAll(html, /<script\b[^>]*>[\s\S]*?<\/script\s*>|<script\b[^>]*\/>/gi, async (m) => {
    report.dropped.push(attr(m[0], "src") ?? "inline <script>");
    return "";
  });
  // <link>: local stylesheets become <style>; everything else that points elsewhere goes
  html = await replaceAll(html, /<link\b[^>]*>/gi, async (m) => {
    const href = attr(m[0], "href") ?? "";
    const rel = (attr(m[0], "rel") ?? "").toLowerCase();
    if (rel.split(/\s+/).includes("stylesheet") && !isRemote(href) && !isInline(href)) {
      const p = local(href, file);
      try {
        return `<style>${await css(await fs.readFile(p, "utf8"), p)}</style>`;
      } catch {
        report.missing.push(p);
        return "";
      }
    }
    if (isRemote(href)) {
      report.dropped.push(href);
      return "";
    }
    return m[0];
  });
  html = await replaceAll(html, /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, async (m) => {
    return `<style${m[1]}>${await css(m[2], file)}</style>`;
  });
  html = await replaceAll(html, /\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, async (m) => {
    const q = m[1];
    return ` style=${q}${(await css(m[2], file)).replaceAll(q, q === '"' ? "'" : '"')}${q}`;
  });
  // images: <img src>, <source src>, <video poster>, <image href>; srcset keeps its first candidate
  html = await replaceAll(html, /<(img|source|video|image|input)\b[^>]*>/gi, async (m) => {
    let tag = m[0];
    const srcset = attr(tag, "srcset");
    if (srcset) tag = tag.replace(/\s(?:srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, "");
    for (const name of ["src", "poster", "href", "xlink:href"]) {
      const ref = attr(tag, name) ?? (name === "src" && srcset ? srcset.trim().split(/\s+/)[0] : undefined);
      if (ref == null || isInline(ref)) continue;
      const uri = (await dataUri(ref, file)) ?? "";
      const re = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
      tag = re.test(tag) ? tag.replace(re, ` ${name}="${uri}"`) : tag.replace(/^<\w+/, (t) => `${t} src="${uri}"`);
    }
    return tag;
  });

  report.html = html;
  report.dropped = [...new Set(report.dropped)];
  report.missing = [...new Set(report.missing)];
  return report;
}
