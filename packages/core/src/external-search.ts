import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { externalSearchLinks } from "./known-sources";
import { safeFetch, urlKey } from "./net-guard";
import { parseQuery, toJsRegex } from "./query";
import { storeFor } from "./storage";
import { getSearchSettings } from "./settings";
import { hostOf } from "./source-match";
import {
  DIRECT_PROVIDER_IDS,
  type DirectProviderId,
  type DirectProviderInfo,
  type ExternalResult,
  type ExternalSearchPage,
  type ProviderResults,
  type SourceCategory,
} from "./types";

/**
 * Hybrid search, external side (docs/hybrid-search-plan.md). Each direct provider is a free, keyless public catalog
 * that PIVOT syncs (first use, then at most once a day, or on a manual refresh) and searches here, in memory, with the
 * library's own query parser. Searching never makes a network request, and nothing found is written to the database:
 * only an explicit Save (through /api/clip) keeps a result. Sites without a catalog stay link-outs.
 */

/** One item of a provider's catalog, reduced to what PIVOT may show. Never code. */
export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  url: string;
  linkVerified: boolean;
  categories: string[];
}

export interface Catalog {
  provider: DirectProviderId;
  syncedAt: string;
  items: CatalogItem[];
  /** Catalog entries left out because the provider's own free listing doesn't name them (Magic UI). */
  excluded?: string[];
}

interface DirectProvider {
  id: DirectProviderId;
  name: string;
  host: string;
  homepage: string;
  category: SourceCategory;
  /** Free-First: every direct provider is free to use and needs no key or account. Enforced by a test. */
  access: "free";
  auth: "none";
  licence: { name: string; url: string };
  /** `metadataAndLink`: the licence restricts the code, so only titles, descriptions and links are ever shown. */
  licenceMode: "full" | "metadataAndLink";
  /** The public catalog, plus the provider's sitemap to confirm item pages. Fixed URLs, never from a request. */
  catalogUrl: string;
  sitemapUrl?: string;
  /**
   * The provider's own list of its free components. When set, only components named in it are kept, and a sync that
   * can't read it fails (the last good catalog stays), so nothing unconfirmed is ever shown as free.
   */
  freeListUrl?: string;
  /** Reads the free list into component ids; an empty set means it couldn't be confirmed. */
  freeIds?(text: string): Set<string>;
  /**
   * Turns the raw catalog into items, given the sitemap's page URLs (when there is one) and the confirmed free ids
   * (when the provider has a free list). Throws on a bad shape.
   */
  parse(raw: unknown, pages: Set<string> | null, free: Set<string> | null): CatalogItem[];
}

const MAX_DESCRIPTION = 280;
const SLUG = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** Plain text: no tags, collapsed whitespace, clamped. Catalog text is data, never markup. */
export function plainText(value: unknown, max = MAX_DESCRIPTION) {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const titleCase = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** "ASCIIText" → "ASCII Text", "BlobCursor" → "Blob Cursor": PascalCase split into words, acronyms kept. */
export function splitWords(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

/** "ASCIIText" → "ascii-text", "BlobCursor" → "blob-cursor". */
export function kebab(name: string) {
  return splitWords(name).replace(/\s+/g, "-").toLowerCase();
}

function itemsOf(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) throw new Error("The catalog has no item list.");
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

/** The registry index lists files without their contents; a catalog that carries code is refused, never stored. */
function assertNoCode(item: Record<string, unknown>) {
  const files = item.files;
  if (Array.isArray(files) && files.some((f) => f && typeof f === "object" && "content" in f)) {
    throw new Error("The catalog carries component code; PIVOT never stores it.");
  }
}

function nonEmpty(items: CatalogItem[]) {
  if (!items.length) throw new Error("The catalog has no usable components.");
  return items;
}

const MAGICUI_DOCS = "https://magicui.design/docs/components";
/** Components documented on another component's page. */
const MAGICUI_PAGE_OF: Record<string, string> = { "client-tweet-card": "tweet-card" };

const PROVIDERS: DirectProvider[] = [
  {
    id: "magicui",
    name: "Magic UI",
    host: "magicui.design",
    homepage: "https://magicui.design",
    category: "components",
    access: "free",
    auth: "none",
    licence: { name: "MIT", url: "https://github.com/magicuidesign/magicui/blob/main/LICENSE.md" },
    licenceMode: "full",
    catalogUrl: "https://magicui.design/r/registry.json",
    sitemapUrl: "https://magicui.design/sitemap.xml",
    // Magic UI's own index of its free, MIT-licensed components (Magic UI Pro lives on pro.magicui.design).
    freeListUrl: "https://magicui.design/llms.txt",
    freeIds: (text) =>
      new Set(
        [...text.matchAll(/https:\/\/magicui\.design\/docs\/components\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g)].map(
          (m) => m[1],
        ),
      ),
    parse(raw, pages, free) {
      const out: CatalogItem[] = [];
      for (const item of itemsOf(raw)) {
        assertNoCode(item);
        // examples and styles aren't components with their own page
        if (item.type !== "registry:ui" || typeof item.name !== "string" || !SLUG.test(item.name)) continue;
        // not in Magic UI's own list of free components: left out
        if (!free?.has(item.name)) continue;
        const slug = item.name;
        const page = `${MAGICUI_DOCS}/${MAGICUI_PAGE_OF[slug] ?? slug}`;
        const known = pages ? pages.has(page) : false;
        out.push({
          id: slug,
          title: plainText(item.title, 120) || titleCase(slug),
          description: plainText(item.description),
          url: known ? page : MAGICUI_DOCS,
          linkVerified: known,
          categories: [],
        });
      }
      return nonEmpty(out);
    },
  },
  {
    id: "reactbits",
    name: "React Bits",
    host: "reactbits.dev",
    homepage: "https://reactbits.dev",
    category: "components",
    access: "free",
    auth: "none",
    licence: { name: "MIT + Commons Clause", url: "https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md" },
    licenceMode: "metadataAndLink",
    catalogUrl: "https://reactbits.dev/r/registry.json",
    sitemapUrl: "https://reactbits.dev/sitemap.xml",
    parse(raw, pages) {
      // Each component comes in four variants (JS/TS × CSS/Tailwind); other entries (sounds, tools) have no page.
      const VARIANT = /-(JS|TS)-(CSS|TW)$/;
      const bySlug = new Map<string, string>();
      for (const url of pages ?? []) {
        const parts = new URL(url).pathname.split("/").filter(Boolean);
        if (parts.length === 2 && parts[0] !== "c" && parts[0] !== "get-started") bySlug.set(parts[1], url);
      }
      const seen = new Set<string>();
      const out: CatalogItem[] = [];
      for (const item of itemsOf(raw)) {
        assertNoCode(item);
        if (typeof item.name !== "string" || !VARIANT.test(item.name)) continue;
        const base = item.name.replace(VARIANT, "");
        if (!SLUG.test(base) || seen.has(base)) continue;
        seen.add(base);
        const page = bySlug.get(kebab(base));
        out.push({
          id: base,
          title: splitWords(plainText(item.title, 120) || base),
          description: plainText(item.description),
          url: page ?? "https://reactbits.dev/",
          linkVerified: !!page,
          categories: page ? [titleCase(new URL(page).pathname.split("/")[1])] : [],
        });
      }
      return nonEmpty(out);
    },
  },
  {
    id: "shadcn",
    name: "shadcn/ui",
    host: "ui.shadcn.com",
    homepage: "https://ui.shadcn.com",
    category: "components",
    access: "free",
    auth: "none",
    licence: { name: "MIT", url: "https://github.com/shadcn-ui/ui/blob/main/LICENSE.md" },
    licenceMode: "full",
    catalogUrl: "https://ui.shadcn.com/r/index.json",
    parse(raw) {
      const out: CatalogItem[] = [];
      for (const item of itemsOf(raw)) {
        assertNoCode(item);
        if (item.type !== "registry:ui" || typeof item.name !== "string" || !SLUG.test(item.name)) continue;
        const links = ((item.meta as { links?: Record<string, { docs?: unknown }> } | undefined)?.links ??
          {}) as Record<string, { docs?: unknown }>;
        const docs = ["radix", "base", "aria"]
          .map((k) => links[k]?.docs)
          .find((d): d is string => typeof d === "string" && d.startsWith("https://ui.shadcn.com/"));
        out.push({
          id: item.name,
          title: titleCase(item.name),
          description: plainText(item.description),
          url: docs ?? `https://ui.shadcn.com/docs/components/${item.name}`,
          linkVerified: !!docs,
          categories: [],
        });
      }
      return nonEmpty(out);
    },
  },
];

/** The direct providers, in the order the owner chose (Magic UI, React Bits, shadcn/ui). */
export const DIRECT_PROVIDERS: readonly Omit<DirectProvider, "parse" | "freeIds">[] = PROVIDERS;

/**
 * Catalogs always live in the local data folder, never in R2 even when R2 is configured: they are a cache of public
 * data, and keeping them local means no cloud requests or costs come from searching.
 */
const catalogStore = () => storeFor("local");

/** Timing and network hooks. Exported so tests can stub the network and the clock. */
export const externalSearchDeps = {
  /** Fetches a catalog or sitemap from a fixed URL. */
  fetchText: async (url: string) => {
    const { response, body } = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 8 * 1024 * 1024 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body.toString("utf8");
  },
  now: () => Date.now(),
  /** A catalog younger than this is used as is. */
  maxAgeMs: 24 * 60 * 60 * 1000,
  /** A manual refresh within this long of the last sync is skipped, so a held-down button can't hammer a site. */
  minRefreshMs: 60 * 1000,
};

/** `synced`: this call downloaded the catalog (false when an existing copy answered). */
type Loaded = { catalog: Catalog; status: "ok" | "stale"; message?: string; synced: boolean };

const g = globalThis as unknown as { __pivotCatalogs?: Map<DirectProviderId, Catalog> };
const memory: Map<DirectProviderId, Catalog> = (g.__pivotCatalogs ??= new Map());
const inflight = new Map<DirectProviderId, Promise<Loaded>>();
const lastAttempt = new Map<DirectProviderId, number>();

const storeKey = (id: DirectProviderId) => `catalogs/${id}.json`;

function providerOf(id: DirectProviderId) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown provider ${id}`);
  return p;
}

async function stored(id: DirectProviderId): Promise<Catalog | null> {
  if (memory.has(id)) return memory.get(id)!;
  const buf = await catalogStore()
    .get(storeKey(id))
    .catch(() => null);
  if (!buf) return null;
  try {
    const catalog = JSON.parse(buf.toString("utf8")) as Catalog;
    if (catalog.provider !== id || !Array.isArray(catalog.items)) return null;
    memory.set(id, catalog);
    return catalog;
  } catch {
    return null;
  }
}

function sitemapPages(xml: string) {
  return new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/\/+$/, "")));
}

/** Downloads and checks a provider's catalog (and sitemap), then keeps it. Throws when it can't. */
async function syncCatalog(id: DirectProviderId): Promise<Catalog> {
  const p = providerOf(id);
  lastAttempt.set(id, externalSearchDeps.now());
  const text = await externalSearchDeps.fetchText(p.catalogUrl);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The catalog isn't JSON (the site may be down or blocking).");
  }
  // A missing sitemap only means the links can't be confirmed; the catalog still works.
  const pages = p.sitemapUrl
    ? await externalSearchDeps
        .fetchText(p.sitemapUrl)
        .then(sitemapPages)
        .catch(() => null)
    : null;
  // A provider with a free list must be confirmed against it; without it nothing is shown as free.
  let free: Set<string> | null = null;
  if (p.freeListUrl && p.freeIds) {
    const unconfirmed = `Couldn't confirm which ${p.name} components are free`;
    const text = await externalSearchDeps.fetchText(p.freeListUrl).catch((err: unknown) => {
      throw new Error(`${unconfirmed} (${err instanceof Error ? err.message : String(err)}).`);
    });
    free = p.freeIds(text);
    if (!free.size) throw new Error(`${unconfirmed}: their list names no components.`);
  }
  const items = p.parse(raw, pages, free);
  const excluded = free
    ? itemsOf(raw)
        .filter((i) => i.type === "registry:ui" && typeof i.name === "string" && !free!.has(i.name))
        .map((i) => String(i.name))
    : [];
  const catalog: Catalog = {
    provider: id,
    syncedAt: new Date(externalSearchDeps.now()).toISOString(),
    items,
    ...(excluded.length ? { excluded } : {}),
  };
  await catalogStore().put(storeKey(id), Buffer.from(JSON.stringify(catalog)), "application/json");
  memory.set(id, catalog);
  return catalog;
}

/** The catalog to search: fresh enough as is, synced when it's older than a day, the last good copy when that fails. */
async function loadCatalog(id: DirectProviderId, { refresh = false } = {}): Promise<Loaded> {
  const running = inflight.get(id);
  if (running) return running;
  const job = (async (): Promise<Loaded> => {
    const have = await stored(id);
    const age = have ? externalSearchDeps.now() - Date.parse(have.syncedAt) : Infinity;
    const recentTry = externalSearchDeps.now() - (lastAttempt.get(id) ?? -Infinity) < externalSearchDeps.minRefreshMs;
    if (have && (age < externalSearchDeps.maxAgeMs || recentTry) && !(refresh && !recentTry)) {
      return { catalog: have, status: "ok", synced: false };
    }
    if (!have && recentTry) throw new Error("The catalog couldn't be downloaded a moment ago; try again shortly.");
    try {
      return { catalog: await syncCatalog(id), status: "ok", synced: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (have) return { catalog: have, status: "stale", message, synced: false };
      throw new Error(message);
    }
  })().finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

/** Library items with the same URL as a result, so the result says "in your library" instead of offering Save. */
async function savedByUrl(urls: string[]) {
  const hosts = [...new Set(urls.map((u) => hostOf(u)).filter((h): h is string => !!h))];
  const saved = new Map<string, string>();
  if (!hosts.length) return saved;
  const db = await getDb();
  const rows = await db
    .select({ id: resources.id, url: resources.sourceUrl })
    .from(resources)
    .where(and(isNull(resources.deletedAt), or(...hosts.map((h) => ilike(resources.sourceUrl, `%${h}%`)))));
  for (const r of rows) if (r.url) saved.set(urlKey(r.url), r.id);
  return saved;
}

/** Ranks like the library: the whole query as the title, then inside it, then every word in the title, then the rest. */
export function searchCatalog(items: CatalogItem[], query: string) {
  const terms = parseQuery(query).map((t) => t.patterns.map(toJsRegex));
  if (!terms.length) return [];
  const q = query.trim().toLowerCase();
  const hit = (text: string, t: RegExp[]) => t.some((re) => re.test(text));
  const scored: { tier: number; item: CatalogItem }[] = [];
  for (const item of items) {
    const hay = `${item.title} ${item.id.replace(/-/g, " ")} ${item.description} ${item.categories.join(" ")}`;
    if (!terms.every((t) => hit(hay, t))) continue;
    const title = item.title.toLowerCase();
    const tier = title === q ? 0 : title.includes(q) ? 1 : terms.every((t) => hit(item.title, t)) ? 2 : 3;
    scored.push({ tier, item });
  }
  return scored.sort((a, b) => a.tier - b.tier || a.item.title.localeCompare(b.item.title)).map((s) => s.item);
}

export class ExternalSearchInputError extends Error {}

/**
 * Searches the enabled direct providers (or the ones asked for) and lists link-outs for the sites without a catalog.
 * Each provider answers on its own: one that can't sync is a status, never an error for the whole search.
 */
export async function externalSearch({
  query,
  providers,
  category,
  limit = 6,
}: {
  query: string;
  providers?: DirectProviderId[];
  category?: SourceCategory;
  limit?: number;
}): Promise<ExternalSearchPage> {
  const q = query.trim();
  if (!q) throw new ExternalSearchInputError("Type something to search for.");
  if (q.length > 120) throw new ExternalSearchInputError("The search is longer than 120 characters.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ExternalSearchInputError("limit must be 1–20.");
  const { disabled } = await getSearchSettings();
  const wanted = PROVIDERS.filter(
    (p) => (!providers?.length || providers.includes(p.id)) && (!category || p.category === category),
  );

  const answers = await Promise.all(
    wanted.map(async (p): Promise<Omit<ProviderResults, "results"> & { matches: CatalogItem[] }> => {
      const base = { id: p.id, name: p.name, host: p.host, homepage: p.homepage, licence: p.licence };
      if (disabled.includes(p.id)) return { ...base, status: "disabled", syncedAt: null, total: 0, matches: [] };
      try {
        const { catalog, status, message } = await loadCatalog(p.id);
        const matches = searchCatalog(catalog.items, q);
        return { ...base, status, message, syncedAt: catalog.syncedAt, total: matches.length, matches };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ...base, status: "unavailable", message, syncedAt: null, total: 0, matches: [] };
      }
    }),
  );

  const shown = answers.flatMap((a) => a.matches.slice(0, limit).map((m) => m.url));
  const saved = await savedByUrl(shown);
  const page: ExternalSearchPage = {
    query: q,
    providers: answers.map(({ matches, ...a }) => ({
      ...a,
      results: matches.slice(0, limit).map((m): ExternalResult => ({
        kind: "external",
        provider: a.id,
        providerName: a.name,
        externalId: m.id,
        title: m.title,
        description: m.description,
        url: m.url,
        linkVerified: m.linkVerified,
        categories: m.categories,
        licence: a.licence,
        licenceMode: providerOf(a.id).licenceMode,
        attribution: `${a.name} (${a.host}) · ${a.licence.name}`,
        verified: true,
        retrievedAt: a.syncedAt ?? new Date(externalSearchDeps.now()).toISOString(),
        // the provider's catalog page stands in for an unconfirmed item page, so it isn't "this item"
        saved: m.linkVerified && saved.has(urlKey(m.url)) ? { resourceId: saved.get(urlKey(m.url))! } : null,
      })),
    })),
    linkOuts: [],
  };

  const db = await getDb();
  const sources = await db
    .select({ url: resources.sourceUrl })
    .from(resources)
    .where(and(isNull(resources.deletedAt), eq(resources.type, "source")));
  page.linkOuts = externalSearchLinks(q, {
    savedHosts: sources.map((s) => hostOf(s.url) ?? "").filter(Boolean),
    category,
    limit: 12,
  }).map((l) => ({ kind: "linkOut", ...l, searchUrl: l.url, verified: false }));
  return page;
}

/** Re-downloads one provider's catalog now (at most once a minute). */
export async function refreshCatalog(id: DirectProviderId) {
  const { catalog, status, message, synced } = await loadCatalog(id, { refresh: true });
  // Nothing was downloaded: either a sync ran less than a minute ago, or this one failed and the old copy answered.
  const waitMs = synced
    ? 0
    : Math.max(0, (lastAttempt.get(id) ?? 0) + externalSearchDeps.minRefreshMs - externalSearchDeps.now());
  return {
    id,
    status,
    message,
    refreshed: synced,
    ...(waitMs > 0 && status === "ok" ? { retryInMs: waitMs } : {}),
    syncedAt: catalog.syncedAt,
    items: catalog.items.length,
  };
}

/** Settings › Search: each provider with its switch and what's synced, without downloading anything. */
export async function listDirectProviders(): Promise<DirectProviderInfo[]> {
  const { disabled } = await getSearchSettings();
  return Promise.all(
    PROVIDERS.map(async (p) => {
      const catalog = await stored(p.id);
      return {
        id: p.id,
        name: p.name,
        host: p.host,
        homepage: p.homepage,
        licence: p.licence,
        licenceMode: p.licenceMode,
        enabled: !disabled.includes(p.id),
        syncedAt: catalog?.syncedAt ?? null,
        items: catalog?.items.length ?? null,
      };
    }),
  );
}

export const isDirectProviderId = (v: unknown): v is DirectProviderId =>
  typeof v === "string" && (DIRECT_PROVIDER_IDS as readonly string[]).includes(v);

/** Forgets catalogs held in memory (tests). */
export function resetCatalogMemory() {
  memory.clear();
  inflight.clear();
  lastAttempt.clear();
}
