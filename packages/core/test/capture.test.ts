import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SSRF guard blocks loopback; let the browser reach the local test server.
vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
}));

const { MAX_FULL_PAGE_HEIGHT, closeCaptureBrowser, playwrightStatus, screenshotUrl } = await import("../src/capture");

const chromium = await playwrightStatus();
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    // Never answers, like a page that hangs.
    if (url.pathname === "/hang") return;
    res.setHeader("content-type", "text/html");
    if (url.pathname === "/blocked") {
      res.statusCode = 403;
      return res.end("<title>Access denied</title><body>Sorry, you have been blocked</body>");
    }
    if (url.pathname === "/challenge") return res.end("<title>Just a moment...</title><body>Checking</body>");
    if (url.pathname === "/missing") {
      res.statusCode = 404;
      return res.end("<body>Not found</body>");
    }
    const height = Number(url.searchParams.get("h"));
    res.end(
      `<body style="margin:0"><div style="height:${height}px;background:linear-gradient(#123,#abc)"></div></body>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await closeCaptureBrowser();
  await new Promise((resolve) => server.close(resolve));
});

describe.skipIf(!chromium.installed)("screenshotUrl", () => {
  it("caps very tall pages instead of failing", { timeout: 60_000 }, async () => {
    // 1440 × 200000 is above sharp's default 268 MP input limit (fonts.google.com territory).
    const shots = await screenshotUrl(`${baseUrl}?h=200000`);
    expect(await sharp(shots.viewport).metadata()).toMatchObject({ width: 1440, height: 900 });
    expect(shots.full).not.toBeNull();
    expect(await sharp(shots.full!).metadata()).toMatchObject({ width: 1440, height: MAX_FULL_PAGE_HEIGHT });
  });

  it("keeps short pages at their real height", { timeout: 60_000 }, async () => {
    const shots = await screenshotUrl(`${baseUrl}?h=2000`);
    expect(await sharp(shots.full!).metadata()).toMatchObject({ width: 1440, height: 2000 });
  });

  it("fails on block, bot-check and error pages instead of saving them", { timeout: 60_000 }, async () => {
    await expect(screenshotUrl(`${baseUrl}blocked`)).rejects.toThrow(/blocked the screenshot \(HTTP 403\)/);
    await expect(screenshotUrl(`${baseUrl}challenge`)).rejects.toThrow(/blocked the screenshot/);
    await expect(screenshotUrl(`${baseUrl}missing`)).rejects.toThrow(/HTTP 404/);
  });

  it("gives up on a page that never loads", { timeout: 60_000 }, async () => {
    await expect(screenshotUrl(`${baseUrl}hang`, { timeoutMs: 3_000 })).rejects.toThrow(/longer than 3s/);
  });
});
