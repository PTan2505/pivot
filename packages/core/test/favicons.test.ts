import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** What each "site" answers, by URL; anything else is a 404. */
const site = new Map<string, { type: string; body: Buffer }>();
const fetched: string[] = [];

vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  safeFetch: async (url: string) => {
    fetched.push(url);
    const hit = site.get(url);
    const response = new Response(null, {
      status: hit ? 200 : 404,
      headers: { "content-type": hit?.type ?? "text/plain" },
    });
    return { url, response, body: hit?.body ?? Buffer.alloc(0) };
  },
}));

let tmp: string;
let favicons: typeof import("../src/favicons");
let resources: typeof import("../src/resources");
let db: typeof import("../src/db/client");

const png = (size: number) =>
  sharp({ create: { width: size, height: size, channels: 4, background: "#ff6a13" } })
    .png()
    .toBuffer();

/** An .ico with one PNG frame, the way most sites ship favicon.ico today. */
function icoWith(frame: Buffer, size: number) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = size;
  head[7] = size;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(frame.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, frame]);
}

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-favicons-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  favicons = await import("../src/favicons");
  resources = await import("../src/resources");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("favicons", () => {
  it("accepts host names only", () => {
    expect(favicons.normalizeHost("WWW.Attio.com")).toBe("attio.com");
    expect(favicons.normalizeHost("styles.refero.design")).toBe("styles.refero.design");
    for (const bad of ["", "localhost", "a/b", "attio.com:8080", "-x.com", "https://attio.com"])
      expect(favicons.normalizeHost(bad)).toBeNull();
  });

  it("never fetches a host nothing in the library came from", async () => {
    fetched.length = 0;
    expect(await favicons.getFavicon("not-saved.example")).toBeNull();
    expect(fetched).toEqual([]);
  });

  it("takes the page's best icon, stores it as a 64px PNG and serves it from storage after that", async () => {
    await resources.createResource({ type: "reference", title: "Shop", sourceUrl: "https://www.shop.example/p/1" });
    site.set("https://shop.example/", {
      type: "text/html",
      body: Buffer.from(
        '<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" sizes="16x16" href="/16.png">' +
          '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
      ),
    });
    site.set("https://shop.example/icon.svg", {
      type: "image/svg+xml",
      body: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#f60"/></svg>',
      ),
    });
    fetched.length = 0;
    const icon = await favicons.getFavicon("shop.example");
    expect(icon?.contentType).toBe("image/png");
    expect(fetched).toEqual(["https://shop.example/", "https://shop.example/icon.svg"]);
    const meta = await sharp(icon!.data).metadata();
    expect([meta.width, meta.height]).toEqual([64, 64]);

    fetched.length = 0;
    expect((await favicons.getFavicon("www.shop.example"))?.data.equals(icon!.data)).toBe(true);
    expect(fetched).toEqual([]);
  });

  it("falls back to /favicon.ico and reads the PNG inside it", async () => {
    await resources.createResource({ type: "reference", title: "Blog", sourceUrl: "https://blog.example/" });
    site.set("https://blog.example/favicon.ico", { type: "image/x-icon", body: icoWith(await png(32), 32) });
    const icon = await favicons.getFavicon("blog.example");
    expect(icon?.contentType).toBe("image/png");
    expect((await sharp(icon!.data).metadata()).width).toBe(64);
  });

  it("gives up on a site without an icon and doesn't ask it again right away", async () => {
    await resources.createResource({ type: "reference", title: "Bare", sourceUrl: "https://bare.example/" });
    fetched.length = 0;
    expect(await favicons.getFavicon("bare.example")).toBeNull();
    expect(fetched).toEqual(["https://bare.example/", "https://bare.example/favicon.ico"]);
    fetched.length = 0;
    expect(await favicons.getFavicon("bare.example")).toBeNull();
    expect(fetched).toEqual([]);
  });
});
