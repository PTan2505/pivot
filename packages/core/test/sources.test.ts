import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guessCategory, isSiteHome, knownSourceFor, matchHost, parseBookmarksHtml } from "../src/source-match";
import { sourceSearchUrl } from "../src/types";

let tmp: string;
let sources: typeof import("../src/sources");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

// The shape Chrome exports, folders nested in <DL> lists.
const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><H3 ADD_DATE="1">Design &amp; UI</H3>
        <DL><p>
            <DT><A HREF="https://dribbble.com/" ADD_DATE="1" ICON="data:image/png;base64,AAAA">Dribbble - Discover</A>
            <DT><A HREF="https://dribbble.com/shots/123-Pricing" ADD_DATE="1">Pricing shot</A>
            <DT><A HREF="https://mobbin.com" ADD_DATE="1">Mobbin</A>
            <DT><H3 ADD_DATE="1">Fonts</H3>
            <DL><p>
                <DT><A HREF="https://some-type-foundry.example/" ADD_DATE="1">A foundry</A>
            </DL><p>
        </DL><p>
        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1">Hacker News</A>
        <DT><A HREF="javascript:alert(1)" ADD_DATE="1">Bookmarklet</A>
    </DL><p>
</DL><p>`;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "stan-bag-sources-"));
  Object.assign(process.env, {
    STAN_BAG_DATA_DIR: path.join(tmp, "data"),
    STAN_BAG_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  sources = await import("../src/sources");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("source matching", () => {
  it("parses bookmark folders and skips non-web links", () => {
    const list = parseBookmarksHtml(BOOKMARKS);
    expect(list.map((b) => b.title)).toEqual([
      "Dribbble - Discover",
      "Pricing shot",
      "Mobbin",
      "A foundry",
      "Hacker News",
    ]);
    expect(list[0].folders).toEqual(["Design & UI"]);
    expect(list[3].folders).toEqual(["Design & UI", "Fonts"]);
    expect(list[4].folders).toEqual([]);
  });

  it("knows sites, tells a site from a page on it, and guesses categories", () => {
    expect(knownSourceFor("https://www.dribbble.com/shots/1")?.name).toBe("Dribbble");
    expect(isSiteHome("https://dribbble.com/")).toBe(true);
    expect(isSiteHome("https://dribbble.com/shots/123")).toBe(false);
    expect(matchHost("styles.refero.design", ["refero.design", "styles.refero.design"])).toBe("styles.refero.design");
    expect(matchHost("cdn.dribbble.com", ["dribbble.com"])).toBe("dribbble.com");
    expect(matchHost("notdribbble.com", ["dribbble.com"])).toBeNull();
    expect(guessCategory({ url: "https://mobbin.com", title: "", folders: [] })).toBe("product-ui");
    // Unknown site: the innermost folder name decides.
    expect(guessCategory({ url: "https://x.example", title: "", folders: ["Design & UI", "Fonts"] })).toBe(
      "type-color",
    );
    expect(guessCategory({ url: "https://x.example", title: "Hacker News", folders: [] })).toBeNull();
    expect(sourceSearchUrl("https://dribbble.com/search/{q}", "pricing page")).toBe(
      "https://dribbble.com/search/pricing%20page",
    );
  });
});

describe("bookmark import", () => {
  it("suggests known home pages, imports them with details, and attributes references by host", async () => {
    const rows = await sources.previewBookmarkImport(BOOKMARKS);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(rows.filter((r) => r.suggested).map((r) => r.title)).toEqual(["Dribbble - Discover", "Mobbin"]);
    expect(byTitle["Pricing shot"]).toMatchObject({ suggestedType: "reference", suggested: false });
    expect(byTitle["A foundry"]).toMatchObject({ suggestedType: "source", category: "type-color", suggested: false });

    const res = await sources.importBookmarks({
      capture: false,
      items: [
        { url: "https://dribbble.com/", title: "Dribbble - Discover", type: "source" },
        { url: "https://dribbble.com/shots/123-Pricing", title: "Pricing shot", type: "reference" },
        { url: "https://some-type-foundry.example/", title: "A foundry", type: "source", category: "type-color" },
        { url: "https://dribbble.com", title: "Same site again", type: "source" },
      ],
    });
    expect(res.created).toHaveLength(3);
    expect(res.skipped).toEqual([{ url: "https://dribbble.com/", reason: "Already in the library" }]);

    const dribbble = (await resources.getResource(res.created[0]))!;
    expect(dribbble.meta).toMatchObject({ category: "inspiration", searchUrl: expect.stringContaining("{q}") });
    expect((await resources.getResource(res.created[2]))!.meta).toEqual({ category: "type-color" });

    // A reference saved later from the same site counts toward it.
    await resources.createResource({
      type: "reference",
      title: "Another shot",
      sourceUrl: "https://dribbble.com/shots/9",
    });
    expect((await resources.sourceStats())[dribbble.id]).toBe(2);
    const via = await resources.listResources({ via: dribbble.id });
    expect(via.map((r) => r.title).sort()).toEqual(["Another shot", "Pricing shot"]);

    // Already-saved rows are flagged on the next preview.
    const again = await sources.previewBookmarkImport(BOOKMARKS);
    expect(again.find((r) => r.title === "Dribbble - Discover")?.duplicate).toBe(true);
  });
});
