import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The SSRF guard blocks loopback; let the browser reach the local test server.
vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
}));

const { closeCaptureBrowser, playwrightStatus, screenshotUrl } = await import("../src/capture");

const chromium = await playwrightStatus();

const PAGES: Record<string, string> = {
  // Appends a 1000px block whenever the bottom comes into view, four times (5000px in all).
  "/infinite": `<body style="margin:0"><div id="list"><div style="height:1000px;background:#123"></div></div>
<script>
  let added = 0;
  addEventListener("scroll", () => {
    if (added >= 4 || scrollY + innerHeight < document.body.scrollHeight - 50) return;
    added++;
    setTimeout(() => {
      const d = document.createElement("div");
      d.style.cssText = "height:1000px;background:#" + (added * 2) + "4" + added;
      document.getElementById("list").appendChild(d);
    }, 100);
  });
</script></body>`,
  // A "Load more" button that adds 1500px per click, three times, then disappears.
  "/load-more": `<body style="margin:0"><div id="list" style="height:1000px;background:#321"></div>
<button id="more" style="display:block;height:60px">Load more</button>
<script>
  let n = 0;
  document.getElementById("more").onclick = () => {
    n++;
    const d = document.createElement("div");
    d.style.cssText = "height:1500px;background:#456";
    document.getElementById("list").after(d);
    if (n === 3) document.getElementById("more").remove();
  };
</script></body>`,
  // App-like layout: the document never scrolls, an inner panel does.
  "/inner": `<body style="margin:0;height:100vh;overflow:hidden">
<main style="height:100vh;overflow-y:auto"><div style="height:3000px;background:linear-gradient(#000,#fff)"></div></main></body>`,
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(PAGES[new URL(req.url!, "http://x").pathname] ?? "<body>?</body>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeCaptureBrowser();
  await new Promise((resolve) => server.close(resolve));
});

const fullHeight = async (path: string) => {
  const shots = await screenshotUrl(`${baseUrl}${path}`);
  return (await sharp(shots.full!).metadata()).height;
};

describe.skipIf(!chromium.installed)("full-page capture loads the whole page", () => {
  it("scrolls an infinite list until it stops growing", { timeout: 90_000 }, async () => {
    expect(await fullHeight("/infinite")).toBe(5000);
  });

  it("presses Load more until the button is gone", { timeout: 90_000 }, async () => {
    expect(await fullHeight("/load-more")).toBe(1000 + 3 * 1500);
  });

  it("captures a page that scrolls an inner panel", { timeout: 60_000 }, async () => {
    expect(await fullHeight("/inner")).toBeGreaterThanOrEqual(3000);
  });

  it("skips the full page when asked (sources)", { timeout: 60_000 }, async () => {
    const shots = await screenshotUrl(`${baseUrl}/inner`, { fullPage: false });
    expect(shots.full).toBeNull();
    expect(await sharp(shots.viewport).metadata()).toMatchObject({ width: 1440, height: 900 });
  });
});
