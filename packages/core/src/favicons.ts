import * as cheerio from "cheerio";
import { and, ilike, isNull } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { safeFetch } from "./net-guard";
import { hostOf } from "./source-match";
import { writeStore } from "./storage";

/**
 * Site icons for cards, one per host. The first card that needs one fetches it from the site and keeps it in the
 * blob store (`favicons/<host>`), so later views and other resources on the same host never go back to the site.
 */

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const SIZE = 64;
const RETRY_AFTER_MS = 60 * 60 * 1000;
const failedAt = new Map<string, number>();
const inflight = new Map<string, Promise<Favicon | null>>();

export interface Favicon {
  data: Buffer;
  contentType: "image/png" | "image/x-icon";
}

const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const isIco = (b: Buffer) => b.length > 6 && b.readUInt32BE(0) === 0x00000100;

export function normalizeHost(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return HOST_RE.test(host) ? host : null;
}

function keyOf(host: string) {
  return `favicons/${host}`;
}

/**
 * Only hosts something in the library came from: the route can't be used to fetch arbitrary sites. A valid host has
 * no LIKE wildcards in it.
 */
async function inLibrary(host: string) {
  const db = await getDb();
  const rows = await db
    .select({ url: resources.sourceUrl })
    .from(resources)
    .where(and(isNull(resources.deletedAt), ilike(resources.sourceUrl, `%${host}%`)))
    .limit(50);
  return rows.some((r) => hostOf(r.url) === host);
}

/** The largest PNG frame inside an .ico file, if it has one (most modern .ico files do). */
function pngInIco(ico: Buffer): Buffer | null {
  const count = ico.readUInt16LE(4);
  let best: Buffer | null = null;
  let bestSize = 0;
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    if (at + 16 > ico.length) break;
    const size = ico[at] || 256;
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    const frame = ico.subarray(offset, offset + length);
    if (frame.length === length && isPng(frame) && size > bestSize) {
      best = frame;
      bestSize = size;
    }
  }
  return best;
}

/** A square PNG for anything sharp can read (PNG, SVG, WebP, JPEG, GIF); a bitmap-only .ico is kept as it is. */
async function normalize(bytes: Buffer): Promise<Favicon | null> {
  const input = isIco(bytes) ? (pngInIco(bytes) ?? bytes) : bytes;
  try {
    const data = await sharp(input, { animated: false, limitInputPixels: 4096 * 4096 })
      .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { data, contentType: "image/png" };
  } catch {
    return isIco(input) ? { data: input, contentType: "image/x-icon" } : null;
  }
}

/** Icon links on the site's home page, best first: SVG, then the PNG closest to 64px, then the touch icon. */
async function candidates(host: string): Promise<string[]> {
  const home = `https://${host}/`;
  const found: { href: string; rank: number }[] = [];
  try {
    const { url, response, body } = await safeFetch(home, {
      accept: "text/html",
      maxBytes: 1024 * 1024,
      timeoutMs: 8000,
    });
    if (response.ok && (response.headers.get("content-type") ?? "").includes("html")) {
      const $ = cheerio.load(body.toString("utf8"));
      $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').each((_, el) => {
        const raw = $(el).attr("href");
        if (!raw || raw.startsWith("data:")) return;
        let href: string;
        try {
          href = new URL(raw, url).toString();
        } catch {
          return;
        }
        const rel = ($(el).attr("rel") ?? "").toLowerCase();
        const type = ($(el).attr("type") ?? "").toLowerCase();
        const size = Number(($(el).attr("sizes") ?? "").split(/[x\s]/i)[0]) || 0;
        const rank = rel.includes("apple")
          ? 3
          : type.includes("svg") || /\.svg(\?|$)/i.test(href)
            ? 0
            : size >= 32
              ? 1 + Math.abs(size - SIZE) / 1000
              : 4;
        found.push({ href, rank });
      });
    }
  } catch {
    // the home page didn't answer; /favicon.ico may still
  }
  const list = found.sort((a, b) => a.rank - b.rank).map((c) => c.href);
  return [...new Set([...list.slice(0, 4), new URL("/favicon.ico", home).toString()])];
}

async function fetchFavicon(host: string): Promise<Favicon | null> {
  for (const href of await candidates(host)) {
    try {
      const { response, body } = await safeFetch(href, { accept: "image/*", maxBytes: 512 * 1024, timeoutMs: 8000 });
      if (!response.ok || !body.length) continue;
      const icon = await normalize(body);
      if (icon) return icon;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** The host's icon, from the blob store or (first time) from the site. Null when it has none we can use. */
export async function getFavicon(input: string): Promise<Favicon | null> {
  const host = normalizeHost(input);
  if (!host) return null;
  const store = writeStore();
  const cached = await store.get(keyOf(host));
  if (cached?.length) return { data: cached, contentType: isPng(cached) ? "image/png" : "image/x-icon" };

  const failed = failedAt.get(host);
  if (failed && Date.now() - failed < RETRY_AFTER_MS) return null;
  const pending = inflight.get(host);
  if (pending) return pending;

  const job = (async () => {
    if (!(await inLibrary(host))) return null;
    const icon = await fetchFavicon(host);
    if (!icon) {
      failedAt.set(host, Date.now());
      return null;
    }
    await store.put(keyOf(host), icon.data, icon.contentType);
    failedAt.delete(host);
    return icon;
  })().finally(() => inflight.delete(host));
  inflight.set(host, job);
  return job;
}
