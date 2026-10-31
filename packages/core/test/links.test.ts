import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SSRF guard blocks loopback; let the visibility check reach the local test server.
vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
  // safeFetch checks each hop internally; here it follows redirects without the guard
  safeFetch: async (input: string) => {
    let url = input;
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(url, { redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).toString();
        continue;
      }
      return { url, response, body: Buffer.from(await response.arrayBuffer()) };
    }
    throw new Error("Too many redirects.");
  },
}));

let tmp: string;
let server: http.Server;
let base: string;
let links: typeof import("../src/links");
let resources: typeof import("../src/resources");
let visibility: typeof import("../src/visibility");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-links-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  server = http.createServer((req, res) => {
    if (req.url === "/private") {
      res.writeHead(302, { location: "/login?next=/private" });
      return res.end();
    }
    if (req.url === "/forbidden") {
      res.statusCode = 403;
      return res.end("no");
    }
    if (req.url?.startsWith("/login")) return res.end(`<form><input type="password"></form>`);
    res.end("<h1>Public page</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  links = await import("../src/links");
  resources = await import("../src/resources");
  visibility = await import("../src/visibility");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("links between references", () => {
  it("links a section to its page, and two saves of one page to each other, but not by website alone", async () => {
    const page = await resources.createResource({
      type: "reference",
      title: "Acme",
      sourceUrl: "https://acme.io/pricing",
    });
    const section = await resources.createResource({
      type: "reference",
      title: "Pricing — acme.io",
      sourceUrl: "https://acme.io/pricing",
      meta: { section: { type: "Pricing", rect: { x: 0, y: 900, width: 1280, height: 700 } } },
    });
    const other = await resources.createResource({
      type: "reference",
      title: "Acme home",
      sourceUrl: "https://acme.io/",
    });
    expect(await links.autoLinkSamePage(section.id)).toBe(1);
    expect(await links.autoLinkSamePage(other.id)).toBe(0);

    const ofSection = await links.listLinks(section.id);
    expect(ofSection).toMatchObject([{ kind: "part_of", direction: "out", origin: "auto", confirmed: true }]);
    expect((await links.listLinks(page.id))[0]).toMatchObject({ kind: "part_of", direction: "in" });

    const again = await resources.createResource({
      type: "reference",
      title: "Acme again",
      sourceUrl: "https://acme.io/pricing",
    });
    await links.autoLinkSamePage(again.id);
    const kinds = (await links.listLinks(again.id)).map((l) => l.kind).sort();
    expect(kinds).toEqual(["part_of", "same_source_page"]);
  });

  it("keeps one row for a symmetric link and confirms a suggestion when it is made by hand", async () => {
    const a = await resources.createResource({ type: "reference", title: "A", sourceUrl: "https://a.dev/" });
    const b = await resources.createResource({ type: "reference", title: "B", sourceUrl: "https://b.dev/" });
    const id = await links.createLink({
      fromId: a.id,
      toId: b.id,
      kind: "related_to",
      confirmed: false,
      origin: "agent",
    });
    expect((await links.listLinks(a.id))[0].confirmed).toBe(false);
    expect(await links.createLink({ fromId: b.id, toId: a.id, kind: "related_to" })).toBe(id);
    expect((await links.listLinks(b.id))[0]).toMatchObject({ confirmed: true, direction: "in" });
    await expect(links.createLink({ fromId: a.id, toId: a.id, kind: "variant_of" })).rejects.toThrow(/itself/);
    await links.deleteLink(id);
    expect(await links.listLinks(a.id)).toEqual([]);
  });

  it("drops links to trashed references from the list", async () => {
    const a = await resources.createResource({ type: "reference", title: "Kept", sourceUrl: "https://k.dev/" });
    const b = await resources.createResource({ type: "reference", title: "Trashed", sourceUrl: "https://t.dev/" });
    await links.createLink({ fromId: a.id, toId: b.id, kind: "variant_of" });
    await resources.trashResources([b.id]);
    expect(await links.listLinks(a.id)).toEqual([]);
  });
});

describe("private page check", () => {
  it("tells public pages from sign-in walls and errors", async () => {
    expect((await visibility.checkVisibility(`${base}/`)).private).toBe(false);
    expect(await visibility.checkVisibility(`${base}/private`)).toMatchObject({ private: true });
    expect((await visibility.checkVisibility(`${base}/forbidden`)).reason).toMatch(/HTTP 403/);
    expect((await visibility.checkVisibility("http://127.0.0.1:1/")).private).toBeNull();
    expect(visibility.looksLikeAppUrl("https://app.linear.app/team")).toBe(true);
    expect(visibility.looksLikeAppUrl("https://linear.app/pricing")).toBe(false);
  });
});
