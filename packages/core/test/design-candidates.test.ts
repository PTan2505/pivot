// Gate 1: references proposed for a design session. Library references link by id; external pages are checked (public
// only), previewed by PIVOT's own capture (stubbed here; the real capture runs in the end-to-end check), never added to
// the library, and only the user's pick, in their words, marks them selected.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    // numbering continues; the same page isn't proposed twice
    const more = await cands.addCandidates(id, [
      { url: "https://93.184.215.14/saas", why: "again" },
      { url: "https://93.184.215.14/other", why: "new" },
    ]);
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
