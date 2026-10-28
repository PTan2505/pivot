// Pure helpers for sources: host matching, known-site lookup and bookmark parsing. Safe in the browser.
import { KNOWN_SOURCES, type KnownSource } from "./known-sources";
import { SOURCE_CATEGORIES, type SourceCategory } from "./types";

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The most specific of `hosts` that `host` belongs to, so styles.refero.design wins over refero.design. */
export function matchHost(host: string, hosts: Iterable<string>): string | null {
  let best: string | null = null;
  for (const h of hosts) {
    if ((host === h || host.endsWith(`.${h}`)) && (!best || h.length > best.length)) best = h;
  }
  return best;
}

const KNOWN_BY_HOST = new Map(KNOWN_SOURCES.flatMap((s) => [s.host, ...(s.aliases ?? [])].map((h) => [h, s] as const)));

export function knownSourceFor(url: string | null | undefined): KnownSource | null {
  const host = hostOf(url);
  const match = host && matchHost(host, KNOWN_BY_HOST.keys());
  return match ? KNOWN_BY_HOST.get(match)! : null;
}

/** The meta a new source starts with when its site is one we know. */
export function knownSourceMeta(url: string | null | undefined): Record<string, unknown> {
  const k = knownSourceFor(url);
  return k ? { category: k.category, searchUrl: k.searchUrl ?? "", pricing: k.pricing, platforms: k.platforms } : {};
}

/**
 * True when the URL is the site itself rather than one item on it:
 * dribbble.com is a source, dribbble.com/shots/123 is a reference found there.
 */
export function isSiteHome(url: string): boolean {
  const known = knownSourceFor(url);
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const home = known ? new URL(known.url).pathname.replace(/\/+$/, "") : "";
    return path === "" || path === home;
  } catch {
    return false;
  }
}

export interface Bookmark {
  url: string;
  title: string;
  /** Folder path from the outermost folder in, without the browser's root folders. */
  folders: string[];
}

const ROOT_FOLDERS =
  /^(bookmarks|bookmarks bar|bookmarks toolbar|favorites bar|favourites bar|other bookmarks|mobile bookmarks)$/i;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const text = (html: string) => decode(html.replace(/<[^>]+>/g, "")).trim();

/** Reads the Netscape bookmark file every browser exports (Chrome: Bookmarks manager → Export bookmarks). */
export function parseBookmarksHtml(html: string): Bookmark[] {
  const out: Bookmark[] = [];
  const stack: string[] = [];
  let pending: string | null = null;
  const re = /<h3\b[^>]*>([\s\S]*?)<\/h3>|<dl\b[^>]*>|<\/dl\s*>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      pending = text(m[1]);
    } else if (/^<dl/i.test(m[0])) {
      stack.push(pending ?? "");
      pending = null;
    } else if (/^<\/dl/i.test(m[0])) {
      stack.pop();
    } else {
      const href = /\bhref\s*=\s*"([^"]*)"/i.exec(m[2] ?? "")?.[1];
      if (!href) continue;
      const url = decode(href);
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({ url, title: text(m[3] ?? ""), folders: stack.filter((f) => f && !ROOT_FOLDERS.test(f)) });
    }
  }
  return out;
}

// Words in a folder name or title that hint at a category, checked innermost folder first.
const HINTS: [SourceCategory, RegExp][] = [
  ["type-color", /\b(fonts?|typography|typefaces?|colou?rs?|palettes?)\b/i],
  ["assets", /\b(icons?|illustrations?|assets?|svgs?|stock)\b/i],
  ["motion", /\b(motion|animations?|lottie|interactions?|transitions?)\b/i],
  ["components", /\b(components?|ui ?kits?|react|tailwind|shadcn|snippets?|code)\b/i],
  ["styles-systems", /\b(design ?systems?|styles?|tokens?|style ?guides?)\b/i],
  ["product-ui", /\b(apps?|mobile|ios|android|flows?|saas|product|screens?)\b/i],
  ["inspiration", /\b(inspo|inspiration|galler(y|ies)|references?|moodboards?|showcase|landing)\b/i],
];

export function guessCategory(b: Pick<Bookmark, "url" | "title" | "folders">): SourceCategory | null {
  const known = knownSourceFor(b.url);
  if (known) return known.category;
  for (const part of [...b.folders].reverse().concat(b.title)) {
    for (const [category, re] of HINTS) if (re.test(part)) return category;
  }
  return null;
}

export function categoryLabel(value: unknown): string | null {
  return SOURCE_CATEGORIES.find((c) => c.value === value)?.label ?? null;
}
