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
    const height = Number(new URL(req.url!, "http://x").searchParams.get("h"));
    res.setHeader("content-type", "text/html");
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
});
