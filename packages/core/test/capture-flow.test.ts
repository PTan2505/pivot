import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SSRF guard blocks loopback; let the browser reach the local test server.
vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
}));

let tmp: string;
let server: http.Server;
let baseUrl: string;
/** What the test server answers: a page whose colour changes per capture, or a block page. */
let mode: "page" | "blocked" = "page";
let hits = 0;

let capture: typeof import("../src/capture");
let resources: typeof import("../src/resources");
let assets: typeof import("../src/assets");
let db: typeof import("../src/db/client");

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pivot-capture-"));
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
  });
  delete process.env.DATABASE_URL;
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    if (mode === "blocked") {
      res.statusCode = 403;
      return res.end("<title>Access denied</title><body>Sorry, you have been blocked</body>");
    }
    // the capture first asks where redirects lead with a plain request; only the browser's load counts as a capture
    if (req.headers["user-agent"]?.includes("Chrome")) hits++;
    res.end(`<body style="margin:0;background:#${hits % 2 ? "234" : "543"}"><div style="height:1200px"></div></body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  capture = await import("../src/capture");
  resources = await import("../src/resources");
  assets = await import("../src/assets");
  db = await import("../src/db/client");
});

afterAll(async () => {
  await capture.closeCaptureBrowser();
  await new Promise((resolve) => server.close(resolve));
  await db.closeDb();
  await fs.rm(tmp, { recursive: true, force: true });
});

const settled = async (id: string) => {
  for (let i = 0; i < 120; i++) {
    const r = (await resources.getResource(id))!;
    if (r.captureStatus !== "pending") return r;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("capture never finished");
};
const shotIds = async (id: string) =>
  (await assets.listResourceAssets(id))
    .filter((a) => a.role !== "attachment")
    .map((a) => `${a.role}:${a.id}`)
    .sort();

describe.skipIf(!(await (await import("../src/capture")).playwrightStatus()).installed)("captureOne", () => {
  it(
    "keeps the old screenshots when a retake is blocked, and swaps them when it works",
    { timeout: 120_000 },
    async () => {
      const r = await resources.createResource({ type: "reference", title: "Page", sourceUrl: baseUrl });
      await capture.enqueueCapture(r.id);
      const first = await settled(r.id);
      expect(first.captureStatus).toBe("done");
      const before = await shotIds(r.id);
      expect(before.map((s) => s.split(":")[0]).sort()).toEqual(["screenshot", "screenshot-full"]);

      // Retake against a block page: marked failed, nothing lost.
      mode = "blocked";
      await capture.enqueueCapture(r.id);
      const blocked = await settled(r.id);
      expect(blocked.captureStatus).toBe("failed");
      expect(blocked.captureError).toMatch(/blocked the screenshot \(HTTP 403\)/);
      expect(await shotIds(r.id)).toEqual(before);
      expect(blocked.coverAssetId).toBe(first.coverAssetId);

      // Retake that works: new shots replace the old ones, and the new viewport becomes the cover.
      mode = "page";
      await capture.enqueueCapture(r.id);
      const again = await settled(r.id);
      expect(again.captureStatus).toBe("done");
      const after = await shotIds(r.id);
      expect(after).toHaveLength(2);
      expect(after).not.toEqual(before);
      expect(again.coverAssetId).not.toBe(first.coverAssetId);

      // An uploaded image replaces both captured shots and becomes the cover, so the card shows it.
      const sharp = (await import("sharp")).default;
      const png = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#f60" } })
        .png()
        .toBuffer();
      const upload = await assets.saveAsset({ data: png, fileName: "mine.png" });
      await capture.replaceScreenshot(r.id, upload.id);
      const replaced = (await resources.getResource(r.id))!;
      expect(await shotIds(r.id)).toEqual([`screenshot:${upload.id}`]);
      expect(replaced.coverAssetId).toBe(upload.id);
      expect(replaced.fullShot).toBeNull();
    },
  );

  it(
    "adds only the full page when the extension's view of the page is already the cover",
    { timeout: 60_000 },
    async () => {
      mode = "page";
      const sharp = (await import("sharp")).default;
      const view = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#0a7" } })
        .webp()
        .toBuffer();
      const r = await resources.createResource({ type: "reference", title: "Clipped", sourceUrl: `${baseUrl}?clip` });
      // What /api/clip does with the screenshot the extension took.
      const shot = await assets.saveAsset({ data: view, fileName: "page-view.webp" });
      await assets.attachAsset(r.id, shot.id, "attachment");
      await resources.setResourceFields(r.id, { coverAssetId: shot.id });

      await capture.enqueueCapture(r.id);
      const done = await settled(r.id);
      expect(done.captureStatus).toBe("done");
      const roles = (await assets.listResourceAssets(r.id)).map((a) => a.role).sort();
      expect(roles).toEqual(["attachment", "screenshot-full"]);
      expect(done.coverAssetId).toBe(shot.id);
    },
  );

  it("marks a resource without a usable URL as failed instead of leaving it pending", { timeout: 30_000 }, async () => {
    const r = await resources.createResource({ type: "reference", title: "No URL" });
    await capture.enqueueCapture(r.id);
    const done = await settled(r.id);
    expect(done.captureStatus).toBe("failed");
    expect(done.captureError).toMatch(/no URL/);
  });
});
