// Gate 1: references proposed for a design session. Library references link by id; external pages are checked (public
// only), previewed by PIVOT's own capture (stubbed here; the real capture runs in the end-to-end check), never added to
// the library, and only the user's pick, in their words, marks them selected.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let cands: typeof import("../src/design-candidates");
let design: typeof import("../src/design");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");
const captured: string[] = [];

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-candidates-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  cands = await import("../src/design-candidates");
  design = await import("../src/design");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
  cands.candidateDeps.capture = async (url: string) => {
    captured.push(url);
    if (url.includes("blocked")) throw new Error("The site blocks automated browsers (HTTP 403).");
    return Buffer.from(`webp:${url}`);
  };
});
afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

const session = async () =>
  (await design.saveDesignBrief({ title: "SaaS site", milestone: "initial", markdown: "## Brief" })).sessionId;

describe("references proposed for a design session", () => {
  it("numbers library and external references, previews external pages, and never saves them to the library", async () => {
    const id = await session();
    const lib = await resources.createResource({
      type: "reference",
      title: "Linear",
      sourceUrl: "https://linear.app/",
    });
    const before = (await resources.listResources({})).length;
    const added = await cands.addCandidates(
      id,
      [
        { resourceId: lib.id, why: "Calm dark hero", take: "type scale", avoid: "purple glow" },
        { url: "https://93.184.215.14/saas", title: "Example SaaS", source: "web search", why: "Pricing layout" },
        { url: "https://93.184.215.14/blocked", why: "Blocked page" },
        { resourceId: lib.id, why: "duplicate, skipped" },
      ],
      { wait: true },
    );
    expect(added.map((c) => [c.n, c.kind])).toEqual([
      [1, "library"],
      [2, "external"],
      [3, "external"],
    ]);
    expect((await resources.listResources({})).length).toBe(before);
    const s = (await design.getDesignSession(id))!;
    const [l, ext, blocked] = s.candidates;
    expect(l).toMatchObject({ resourceId: lib.id, url: "https://linear.app/", source: "library", take: "type scale" });
    expect(ext).toMatchObject({ previewStatus: "ready", previewUrl: `/api/design/candidates/${ext.id}/preview` });
    expect((await cands.candidatePreview(ext.id))!.toString()).toBe("webp:https://93.184.215.14/saas");
    expect(blocked).toMatchObject({ previewStatus: "failed", previewUrl: null });
    expect(blocked.previewError).toMatch(/HTTP 403/);
    // numbering continues; the same page isn't proposed twice. wait: a background capture could outlive afterAll's
    // closeDb and fail the run with "PGlite is closed"
    const more = await cands.addCandidates(
      id,
      [
        { url: "https://93.184.215.14/saas", why: "again" },
        { url: "https://93.184.215.14/other", why: "new" },
      ],
      { wait: true },
    );
    expect(more.map((c) => c.n)).toEqual([4]);
  });

  it("refuses private or non-web addresses, half-specified items, and sessions past exploring", async () => {
    const id = await session();
    for (const url of ["http://127.0.0.1:4321/api/settings/token", "http://10.0.0.1/", "file:///etc/passwd"])
      await expect(cands.addCandidates(id, [{ url, why: "x" }])).rejects.toThrow();
    await expect(cands.addCandidates(id, [{ why: "neither" }])).rejects.toThrow(/either resourceId/);
    await expect(
      cands.addCandidates(id, [{ url: "https://93.184.215.14/", resourceId: crypto.randomUUID(), why: "both" }]),
    ).rejects.toThrow(/either resourceId/);
    await expect(cands.addCandidates(id, [{ url: "https://93.184.215.14/", why: "  " }])).rejects.toThrow(/why/);
    expect(captured.some((u) => u.includes("127.0.0.1") || u.includes("10.0.0.1"))).toBe(false);
    const { sessionId } = await design.saveDesignBrief({ title: "Done", milestone: "initial", markdown: "x" });
    await design.setDesignSessionStatus(sessionId, "abandoned");
    await expect(cands.addCandidates(sessionId, [{ url: "https://93.184.215.14/", why: "x" }])).rejects.toThrow(
      /exploring/,
    );
    await expect(cands.selectCandidates(sessionId, { numbers: [1], userWords: "1" })).rejects.toThrow(/exploring/);
  });

  it("records exactly the user's pick, in their words", async () => {
    const id = await session();
    await cands.addCandidates(
      id,
      ["a", "b", "c"].map((p) => ({ url: `https://93.184.215.14/${p}`, why: p })),
      { wait: true },
    );
    await expect(cands.selectCandidates(id, { numbers: [2], userWords: "" })).rejects.toThrow(/own words/);
    await expect(cands.selectCandidates(id, { numbers: [9], userWords: "nine" })).rejects.toThrow(/numbered 9/);
    const picked = await cands.selectCandidates(id, { numbers: [1, 3], userWords: "1 and 3, the cards of 3" });
    expect(picked.map((c) => c.n)).toEqual([1, 3]);
    // a new pick replaces the old one
    await cands.selectCandidates(id, { numbers: [2], userWords: "actually just 2" });
    const s = (await design.getDesignSession(id))!;
    expect(s.candidates.map((c) => c.selected)).toEqual([false, true, false]);
    expect(s.candidates[1].selectedWords).toBe("actually just 2");
  });
});

describe("candidate edge cases", () => {
  it("one bad item in a batch stores nothing; a non-web sourceUrl is never offered as a link", async () => {
    const id = await session();
    await expect(
      cands.addCandidates(id, [
        { url: "https://93.184.215.14/fine", why: "ok" },
        { url: "http://127.0.0.1/", why: "private" },
      ]),
    ).rejects.toThrow();
    expect((await design.getDesignSession(id))!.candidates).toEqual([]);
    const bad = await resources.createResource({
      type: "reference",
      title: "Odd link",
      sourceUrl: "javascript:alert(document.domain)//",
    });
    const [c] = await cands.addCandidates(id, [{ resourceId: bad.id, why: "x" }]);
    expect(c.url).toBeNull();
  });
});

describe("UI layouts and components", () => {
  it("infers the category from the library type or the catalog site", () => {
    expect(cands.inferCategory({ resourceType: "reference" })).toBe("layout");
    expect(cands.inferCategory({ resourceType: "library" })).toBe("component");
    expect(cands.inferCategory({ resourceType: "animation" })).toBe("component");
    expect(cands.inferCategory({ resourceType: "snippet" })).toBe("component");
    expect(cands.inferCategory({ url: "https://reactbits.dev/components/animated-list" })).toBe("component");
    expect(cands.inferCategory({ url: "https://www.ui.shadcn.com/docs/components/table" })).toBe("component");
    expect(cands.inferCategory({ url: "https://magicui.design/docs/components/marquee" })).toBe("component");
    expect(cands.inferCategory({ url: "https://www.shadcn.io/blocks/sidebar-ai-assistant" })).toBe("component");
    expect(cands.inferCategory({ url: "https://land-book.com/websites/1" })).toBe("layout");
    expect(cands.inferCategory({ url: "https://notreactbits.dev/x" })).toBe("layout");
    expect(cands.inferCategory({ url: null })).toBe("layout");
  });

  it("stores the agent's category, infers it when left out, and refuses an unknown one", async () => {
    const id = await session();
    const page = await resources.createResource({
      type: "reference",
      title: "Stripe",
      sourceUrl: "https://stripe.com/",
    });
    const lib = await resources.createResource({ type: "library", title: "Radix", sourceUrl: "https://radix-ui.com/" });
    const added = await cands.addCandidates(
      id,
      [
        { resourceId: page.id, why: "page" },
        { resourceId: lib.id, why: "primitives" },
        { url: "https://93.184.215.14/list", title: "Animated list", category: "component", why: "list" },
        { url: "https://93.184.215.14/site", title: "Gallery site", why: "layout" },
      ],
      { wait: true },
    );
    expect(added.map((c) => [c.n, c.category])).toEqual([
      [1, "layout"],
      [2, "component"],
      [3, "component"],
      [4, "layout"],
    ]);
    expect((await cands.listCandidates(id)).map((c) => c.category)).toEqual([
      "layout",
      "component",
      "component",
      "layout",
    ]);
    await expect(
      cands.addCandidates(id, [{ url: "https://93.184.215.14/x", why: "x", category: "page" as never }]),
    ).rejects.toThrow(/category is "layout" or "component"/);
  });

  it("infers a category for references proposed before it existed (null in the database)", async () => {
    const id = await session();
    const lib = await resources.createResource({
      type: "snippet",
      title: "Toggle",
      sourceUrl: "https://example.com/t",
    });
    const [c] = await cands.addCandidates(id, [{ resourceId: lib.id, why: "toggle" }], { wait: true });
    const { designCandidates } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    await (await db.getDb()).update(designCandidates).set({ category: null }).where(eq(designCandidates.id, c.id));
    expect((await cands.listCandidates(id))[0].category).toBe("component");
  });
});

describe("a component's own preview image (previewImageUrl)", () => {
  const IMG = "https://cdn.21st.dev/u/ink-orbit-pricing/default/preview.1.webp";
  const png = () =>
    sharp({ create: { width: 2000, height: 1500, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();

  it("stores the image instead of capturing the page, scaled to WebP; other pages are still captured", async () => {
    const id = await session();
    const fetched: string[] = [];
    const body = await png();
    cands.candidateDeps.fetchImage = async (url: string) => {
      fetched.push(url);
      return { body, contentType: "image/png" };
    };
    captured.length = 0;
    const added = await cands.addCandidates(
      id,
      [
        { url: "https://93.184.215.14/components/pricing", previewImageUrl: IMG, why: "the component" },
        { url: "https://93.184.215.14/page", why: "a page" },
      ],
      { wait: true },
    );
    expect(fetched).toEqual([IMG]);
    expect(captured).toEqual(["https://93.184.215.14/page"]);
    const [img, page] = (await design.getDesignSession(id))!.candidates;
    expect(img).toMatchObject({ previewStatus: "ready", previewKind: "image", previewImageUrl: IMG });
    expect(page).toMatchObject({ previewStatus: "ready", previewKind: "capture", previewImageUrl: null });
    const meta = await sharp((await cands.candidatePreview(added[0].id))!).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1440, height: 1080 });
  });

  it("falls back to capturing the page when the image can't be used", async () => {
    const id = await session();
    const cases: Record<string, () => Promise<{ body: Buffer; contentType: string }>> = {
      html: async () => ({ body: Buffer.from("<html></html>"), contentType: "text/html" }),
      broken: async () => ({ body: Buffer.from("not really a png"), contentType: "image/png" }),
      down: async () => {
        throw new Error("HTTP 404");
      },
    };
    let which = "";
    cands.candidateDeps.fetchImage = async () => cases[which]();
    for (const k of Object.keys(cases)) {
      which = k;
      captured.length = 0;
      await cands.addCandidates(id, [{ url: `https://93.184.215.14/c/${k}`, previewImageUrl: IMG, why: k }], {
        wait: true,
      });
      expect(captured).toEqual([`https://93.184.215.14/c/${k}`]);
    }
    const all = (await design.getDesignSession(id))!.candidates;
    for (const c of all)
      expect(c).toMatchObject({ previewStatus: "ready", previewKind: "capture", previewImageUrl: IMG });
  });

  it("accepts only https images on an allowed host, and only for external pages", async () => {
    const id = await session();
    const lib = await resources.createResource({ type: "reference", title: "Lib", sourceUrl: "https://linear.app/" });
    const bad: [Record<string, string>, RegExp][] = [
      [
        { url: "https://93.184.215.14/a", previewImageUrl: "https://evil.example/x.png" },
        /only come from cdn\.21st\.dev/,
      ],
      [{ url: "https://93.184.215.14/a", previewImageUrl: "http://cdn.21st.dev/x.png" }, /must be an https image/],
      [{ url: "https://93.184.215.14/a", previewImageUrl: "not a url" }, /isn't a valid URL/],
      [{ resourceId: lib.id, previewImageUrl: IMG }, /for an external page/],
    ];
    for (const [item, msg] of bad)
      await expect(cands.addCandidates(id, [{ ...item, why: "x" }], { wait: true })).rejects.toThrow(msg);
    expect(await cands.listCandidates(id)).toEqual([]);
    expect(cands.PREVIEW_IMAGE_HOSTS).toEqual(["cdn.21st.dev"]);
  });
});
