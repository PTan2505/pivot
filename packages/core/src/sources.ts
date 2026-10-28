// Bookmark import: parse a browser export, suggest which entries are sources, then create them.
import { isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { normalizeUrl, urlKey } from "./net-guard";
import { createResource } from "./resources";
import { guessCategory, hostOf, isSiteHome, knownSourceFor, parseBookmarksHtml } from "./source-match";
import { SOURCE_CATEGORIES, type SourceCategory } from "./types";

export interface BookmarkRow {
  url: string;
  title: string;
  folders: string[];
  host: string;
  /** Known site: its name, for the "Dribbble" hint next to the row. */
  knownName: string | null;
  category: SourceCategory | null;
  /** The site itself (a source) or one item on it (a reference). */
  suggestedType: "source" | "reference";
  /** Pre-ticked in the review list: known sites' home pages that aren't saved yet. */
  suggested: boolean;
  /** Already in the library (same URL). */
  duplicate: boolean;
}

export async function previewBookmarkImport(html: string): Promise<BookmarkRow[]> {
  const db = await getDb();
  const saved = await db
    .select({ type: resources.type, sourceUrl: resources.sourceUrl })
    .from(resources)
    .where(isNull(resources.deletedAt));
  const savedKeys = new Set(saved.flatMap((r) => (r.sourceUrl ? [urlKey(r.sourceUrl)] : [])));
  const savedSourceHosts = new Set(saved.flatMap((r) => (r.type === "source" ? [hostOf(r.sourceUrl)] : [])));

  const seen = new Set<string>();
  const rows: BookmarkRow[] = [];
  for (const b of parseBookmarksHtml(html)) {
    let url: string;
    try {
      url = normalizeUrl(b.url);
    } catch {
      continue;
    }
    const key = urlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostOf(url) ?? url;
    const known = knownSourceFor(url);
    const home = isSiteHome(url);
    const duplicate = savedKeys.has(key) || (home && savedSourceHosts.has(host));
    rows.push({
      url,
      title: b.title || known?.name || host,
      folders: b.folders,
      host,
      knownName: known?.name ?? null,
      category: guessCategory(b),
      suggestedType: home ? "source" : "reference",
      suggested: !!known && home && !duplicate,
      duplicate,
    });
  }
  // Known sites first, then the rest in bookmark order.
  return rows.sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

export const bookmarkImportInput = z.object({
  items: z
    .array(
      z.object({
        url: z.string().min(1),
        title: z.string().default(""),
        type: z.enum(["source", "reference"]),
        category: z.enum(SOURCE_CATEGORIES.map((c) => c.value) as [SourceCategory, ...SourceCategory[]]).nullish(),
      }),
    )
    .min(1)
    .max(5000),
  capture: z.boolean().default(true),
});

/** Creates the chosen bookmarks. Known sites get their details filled in by `createResource`. */
export async function importBookmarks(input: z.input<typeof bookmarkImportInput>) {
  const data = bookmarkImportInput.parse(input);
  const db = await getDb();
  const saved = await db.select({ sourceUrl: resources.sourceUrl }).from(resources).where(isNull(resources.deletedAt));
  const savedKeys = new Set(saved.flatMap((r) => (r.sourceUrl ? [urlKey(r.sourceUrl)] : [])));

  const created: string[] = [];
  const skipped: { url: string; reason: string }[] = [];
  for (const item of data.items) {
    let url: string;
    try {
      url = normalizeUrl(item.url);
    } catch {
      skipped.push({ url: item.url, reason: "Invalid URL" });
      continue;
    }
    if (savedKeys.has(urlKey(url))) {
      skipped.push({ url, reason: "Already in the library" });
      continue;
    }
    savedKeys.add(urlKey(url));
    const r = await createResource({
      type: item.type,
      title: item.title.trim() || knownSourceFor(url)?.name || hostOf(url) || url,
      sourceUrl: url,
      meta: item.type === "source" && item.category ? { category: item.category } : {},
    });
    created.push(r.id);
  }
  return { created, skipped, capture: data.capture };
}
