import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let tmp: string;
let ext: typeof import("../src/external-search");
let resources: typeof import("../src/resources");
let settings: typeof import("../src/settings");
let db: typeof import("../src/db/client");

const FIXTURES = path.resolve(__dirname, "fixtures/catalogs");
const files: Record<string, string> = {
  "https://magicui.design/r/registry.json": "magicui-registry.json",
  "https://magicui.design/sitemap.xml": "magicui-sitemap.xml",
  "https://reactbits.dev/r/registry.json": "reactbits-registry.json",
  "https://reactbits.dev/sitemap.xml": "reactbits-sitemap.xml",
  "https://ui.shadcn.com/r/index.json": "shadcn-index.json",
};
let calls: string[] = [];
let offline = new Set<string>();
let overrides: Record<string, string> = {};
let clock = Date.parse("2026-11-01T10:00:00Z");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-hybrid-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  ext = await import("../src/external-search");
  resources = await import("../src/resources");
  settings = await import("../src/settings");
  db = await import("../src/db/client");
  ext.externalSearchDeps.now = () => clock;
  ext.externalSearchDeps.fetchText = async (url: string) => {
    calls.push(url);
    if (offline.has(url)) throw new Error("HTTP 503");
    if (url in overrides) return overrides[url];
    const name = files[url];
    if (!name) throw new Error(`unexpected request to ${url}`);
    return fs.readFile(path.join(FIXTURES, name), "utf8");
  };
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  calls = [];
  offline = new Set();
  overrides = {};
  clock = Date.parse("2026-11-01T10:00:00Z");
  ext.resetCatalogMemory();
  await fs.rm(path.join(tmp, "data", "catalogs"), { recursive: true, force: true });
  for (const id of ["magicui", "reactbits", "shadcn"] as const) await settings.setProviderEnabled(id, true);
});

const first = (page: Awaited<ReturnType<typeof ext.externalSearch>>, id: string) =>
  page.providers.find((p) => p.id === id)!;

describe("hybrid search: external providers", () => {
  it("only uses free providers that need no key (cost guard)", () => {
    expect(ext.DIRECT_PROVIDERS.map((p) => p.id)).toEqual(["magicui", "reactbits", "shadcn"]);
    for (const p of ext.DIRECT_PROVIDERS) {
      expect(p.access).toBe("free");
      expect(p.auth).toBe("none");
      for (const url of [p.catalogUrl, p.sitemapUrl].filter(Boolean) as string[]) {
        expect(new URL(url).protocol).toBe("https:");
        expect(new URL(url).hostname.replace(/^www\./, "")).toBe(p.host);
      }
    }
    // no provider settings take a key, a token or a URL
    expect(Object.keys(ext.externalSearchDeps).sort()).toEqual(["fetchText", "maxAgeMs", "minRefreshMs", "now"]);
  });

  it("syncs a catalog once, then searches it locally with no network and no database writes", async () => {
    const before = (await resources.listResources({})).length;
    const page = await ext.externalSearch({ query: "marquee", providers: ["magicui"] });
    expect(calls).toEqual(["https://magicui.design/r/registry.json", "https://magicui.design/sitemap.xml"]);
    const magic = first(page, "magicui");
    expect(magic.status).toBe("ok");
    expect(magic.results[0]).toMatchObject({
      kind: "external",
      verified: true,
      title: "Marquee",
      url: "https://magicui.design/docs/components/marquee",
      linkVerified: true,
      licence: { name: "MIT" },
      attribution: "Magic UI (magicui.design) · MIT",
      saved: null,
    });

    calls = [];
    for (const q of ["border beam", "animated list", "number ticker", "zzzz qqq"]) {
      const p = first(await ext.externalSearch({ query: q, providers: ["magicui"] }), "magicui");
      if (q === "zzzz qqq") expect(p.results).toEqual([]);
      else expect(p.results[0].title.toLowerCase()).toBe(q);
    }
    expect(calls).toEqual([]);
    expect((await resources.listResources({})).length).toBe(before);
  });

  it("maps every result to a confirmed page, titles untitled items, and never indexes examples", async () => {
    const magic = first(await ext.externalSearch({ query: "tweet", providers: ["magicui"], limit: 20 }), "magicui");
    expect(magic.results.map((r) => [r.externalId, r.url])).toEqual([
      ["client-tweet-card", "https://magicui.design/docs/components/tweet-card"],
      ["tweet-card", "https://magicui.design/docs/components/tweet-card"],
    ]);
    const cursor = first(await ext.externalSearch({ query: "smooth cursor", providers: ["magicui"] }), "magicui");
    expect(cursor.results[0].title).toBe("Smooth Cursor");
    const demo = first(await ext.externalSearch({ query: "marquee demo", providers: ["magicui"] }), "magicui");
    expect(demo.results.map((r) => r.externalId)).not.toContain("marquee-demo");
  });

  it("merges React Bits variants into one component and links its page from the sitemap", async () => {
    const page = await ext.externalSearch({ query: "ascii", providers: ["reactbits"] });
    const rb = first(page, "reactbits");
    expect(rb.results).toHaveLength(1);
    expect(rb.results[0]).toMatchObject({
      externalId: "ASCIIText",
      title: "ASCII Text",
      url: "https://reactbits.dev/text-animations/ascii-text",
      linkVerified: true,
      categories: ["Text Animations"],
      licence: { name: "MIT + Commons Clause" },
    });
    // a component the sitemap doesn't list links to the catalog, marked as not confirmed; sounds aren't components
    const all = first(await ext.externalSearch({ query: "eye", providers: ["reactbits"] }), "reactbits");
    expect(all.results[0]).toMatchObject({ externalId: "EvilEye", url: "https://reactbits.dev/", linkVerified: false });
    const sound = first(await ext.externalSearch({ query: "sound engine", providers: ["reactbits"] }), "reactbits");
    expect(sound.results).toEqual([]);
  });

  it("takes shadcn/ui's own docs links", async () => {
    const sh = first(await ext.externalSearch({ query: "accordion", providers: ["shadcn"] }), "shadcn");
    expect(sh.results[0]).toMatchObject({
      title: "Accordion",
      url: "https://ui.shadcn.com/docs/components/radix/accordion",
      linkVerified: true,
    });
  });

  it("resyncs after a day, keeps the last good copy when that fails, and reports a provider with none", async () => {
    await ext.externalSearch({ query: "globe", providers: ["magicui"] });
    calls = [];
    clock += 23 * 60 * 60 * 1000;
    await ext.externalSearch({ query: "globe", providers: ["magicui"] });
    expect(calls).toEqual([]);

    clock += 2 * 60 * 60 * 1000;
    offline.add("https://magicui.design/r/registry.json");
    const stale = first(await ext.externalSearch({ query: "globe", providers: ["magicui"] }), "magicui");
    expect(stale.status).toBe("stale");
    expect(stale.message).toContain("503");
    expect(stale.results[0].title).toBe("Globe");

    // the copy survives a restart: it comes back from storage, not memory
    ext.resetCatalogMemory();
    offline = new Set(["https://ui.shadcn.com/r/index.json"]);
    const page = await ext.externalSearch({ query: "globe" });
    expect(first(page, "magicui").status).toBe("ok");
    expect(first(page, "shadcn")).toMatchObject({ status: "unavailable", results: [] });
  });

  it("refuses broken catalogs and catalogs that carry code, without failing the search", async () => {
    overrides["https://magicui.design/r/registry.json"] = "<title>Just a moment…</title>";
    expect(first(await ext.externalSearch({ query: "x", providers: ["magicui"] }), "magicui")).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("isn't JSON"),
    });
    ext.resetCatalogMemory();
    overrides["https://magicui.design/r/registry.json"] = JSON.stringify({
      items: [{ name: "leaky", type: "registry:ui", files: [{ path: "a.tsx", content: "export {}" }] }],
    });
    expect(first(await ext.externalSearch({ query: "leaky", providers: ["magicui"] }), "magicui").message).toContain(
      "never stores",
    );
    ext.resetCatalogMemory();
    overrides["https://magicui.design/r/registry.json"] = JSON.stringify({
      items: [{ name: "../etc/passwd", type: "registry:ui", title: "<b>x</b>" }],
    });
    expect(first(await ext.externalSearch({ query: "x", providers: ["magicui"] }), "magicui").status).toBe(
      "unavailable",
    );
  });

  it("strips markup from catalog text", async () => {
    overrides["https://magicui.design/r/registry.json"] = JSON.stringify({
      items: [
        {
          name: "evil",
          type: "registry:ui",
          title: "<img src=x onerror=alert(1)>Evil",
          description: `<script>alert(1)</script>${"long ".repeat(200)}`,
        },
      ],
    });
    const r = first(await ext.externalSearch({ query: "evil", providers: ["magicui"] }), "magicui").results[0];
    expect(r.title).toBe("Evil");
    expect(r.description).not.toMatch(/[<>]/);
    expect(r.description.length).toBeLessThanOrEqual(280);
  });

  it("marks results already in the library, skips switched-off providers and refreshes at most once a minute", async () => {
    const saved = await resources.createResource({
      type: "reference",
      title: "Marquee",
      sourceUrl: "https://magicui.design/docs/components/marquee/",
    });
    const magic = first(await ext.externalSearch({ query: "marquee", providers: ["magicui"] }), "magicui");
    expect(magic.results[0].saved).toEqual({ resourceId: saved.id });

    await settings.setProviderEnabled("reactbits", false);
    calls = [];
    const page = await ext.externalSearch({ query: "blob" });
    expect(first(page, "reactbits")).toMatchObject({ status: "disabled", results: [] });
    expect(calls.some((u) => u.includes("reactbits"))).toBe(false);
    expect((await ext.listDirectProviders()).find((p) => p.id === "reactbits")?.enabled).toBe(false);

    calls = [];
    await ext.refreshCatalog("magicui");
    expect(calls).toEqual([]); // synced moments ago
    clock += 2 * 60 * 1000;
    const refreshed = await ext.refreshCatalog("magicui");
    expect(calls).toContain("https://magicui.design/r/registry.json");
    expect(refreshed).toMatchObject({ status: "ok", items: 11 });
  });

  it("lists link-outs for sites without a catalog, never as verified results, and validates the query", async () => {
    const page = await ext.externalSearch({ query: "pricing table", providers: ["magicui"] });
    expect(page.linkOuts.length).toBeGreaterThan(0);
    for (const l of page.linkOuts) {
      expect(l).toMatchObject({ kind: "linkOut", verified: false });
      expect(l.searchUrl).toMatch(/^https:\/\//);
    }
    const hosts = page.linkOuts.map((l) => l.host);
    expect(hosts).toContain("dribbble.com");
    // paid sources stay link-outs; the direct providers never appear as one
    expect(hosts).toContain("mobbin.com");
    expect(hosts.some((h) => ["magicui.design", "reactbits.dev", "ui.shadcn.com"].includes(h))).toBe(false);

    await expect(ext.externalSearch({ query: "  " })).rejects.toThrow(/Type something/);
    await expect(ext.externalSearch({ query: "x".repeat(121) })).rejects.toThrow(/120/);
  });
});
