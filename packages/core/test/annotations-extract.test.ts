import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
  safeFetch: async (input: string) => {
    const response = await fetch(input);
    return { url: input, response, body: Buffer.from(await response.arrayBuffer()) };
  },
}));

let tmp: string;
let server: http.Server;
let base: string;
let annotations: typeof import("../src/annotations");
let extract: typeof import("../src/extract");
let resources: typeof import("../src/resources");
let assets: typeof import("../src/assets");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-annot-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#f60" } })
    .png()
    .toBuffer();
  server = http.createServer((req, res) => {
    if (req.url === "/logo.png") {
      res.setHeader("content-type", "image/png");
      return res.end(png);
    }
    res.setHeader("content-type", "text/html");
    res.end("<p>not an image</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  annotations = await import("../src/annotations");
  extract = await import("../src/extract");
  resources = await import("../src/resources");
  assets = await import("../src/assets");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("annotations", () => {
  it("pins notes to a reference's own screenshot, keeps boxes inside the image, and shows them with the reference", async () => {
    const sharp = (await import("sharp")).default;
    const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#123" } })
      .png()
      .toBuffer();
    const r = await resources.createResource({ type: "reference", title: "Annotated" });
    const shot = await assets.saveAsset({ data: img, fileName: "shot.png" });
    await assets.attachAsset(r.id, shot.id, "screenshot");
    const other = await assets.saveAsset({ data: Buffer.concat([img, Buffer.from("x")]), fileName: "other.png" });

    const box = await annotations.addAnnotation(r.id, {
      assetId: shot.id,
      x: 0.8,
      y: 0.1,
      width: 0.5,
      height: 0.2,
      note: "Sticky CTA",
    });
    expect(box.width).toBeCloseTo(0.2);
    await annotations.addAnnotation(r.id, { assetId: shot.id, kind: "pin", x: 0.5, y: 0.5, note: "Price" });
    await expect(annotations.addAnnotation(r.id, { assetId: other.id, x: 0, y: 0 })).rejects.toThrow(/doesn't belong/);
    await expect(annotations.addAnnotation(r.id, { assetId: shot.id, x: 2, y: 0 })).rejects.toThrow();

    await annotations.updateAnnotation(box.id, { note: "Sticky CTA on scroll" });
    // a partial edit keeps everything else
    const moved = await annotations.updateAnnotation(box.id, { x: 0.7 });
    expect(moved).toMatchObject({ x: 0.7, y: 0.1, note: "Sticky CTA on scroll", kind: "region" });
    expect(moved!.width).toBeCloseTo(0.2);
    const detail = (await resources.getResource(r.id))!;
    expect(detail.annotations!.map((a) => [a.kind, a.note])).toEqual([
      ["region", "Sticky CTA on scroll"],
      ["pin", "Price"],
    ]);
    // the screenshot itself is untouched
    expect((await assets.getAsset(shot.id))!.sha256).toBe(shot.sha256);
    await annotations.deleteAnnotation(box.id);
    expect(await annotations.listAnnotations(r.id)).toHaveLength(1);
  });
});

describe("asset extraction", () => {
  it("keeps picked files with their source, font names without files, and gradients; refuses bulk", async () => {
    const r = await resources.createResource({ type: "reference", title: "Assets", sourceUrl: `${base}/page` });
    const res = await extract.extractAssets(r.id, {
      images: [{ url: `${base}/logo.png` }, { url: `${base}/not-image` }],
      svgs: [
        { markup: '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>', name: "square icon" },
        { markup: "<div/>" },
      ],
      fonts: [{ family: "Inter", weight: "400", style: "normal", src: `${base}/inter.woff2` }],
      gradients: ["linear-gradient(90deg, #f60, #000)"],
    });
    expect(res.saved).toHaveLength(2);
    expect(res.failed.map((f) => f.error)).toEqual([
      expect.stringMatching(/not an image/),
      expect.stringMatching(/not an inline SVG/),
    ]);
    const after = (await resources.getResource(r.id))!;
    expect(after.assets.map((a) => [a.kind, a.sourceUrl]).sort()).toEqual([
      ["image", `${base}/logo.png`],
      ["svg", `${base}/page`],
    ]);
    expect(after.meta.fonts).toEqual(["Inter"]);
    expect(after.meta.gradients).toEqual(["linear-gradient(90deg, #f60, #000)"]);
    await expect(
      extract.extractAssets(r.id, { images: Array.from({ length: 21 }, (_, i) => ({ url: `${base}/${i}.png` })) }),
    ).rejects.toThrow(/at most 20/);
  });
});
