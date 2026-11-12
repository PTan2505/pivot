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
  // A 100vh hero, then sections that fade in when they enter the viewport and fade out when they leave (the common
  // "reveal on scroll"), under a fixed top bar. A one-shot full-page screenshot stretches the hero to the page height and
  // catches the sections faded out.
  "/reveal": `<body style="margin:0;font:16px sans-serif">
<header style="position:fixed;top:0;left:0;right:0;height:80px;background:rgb(200,0,0);z-index:9"></header>
<div style="position:fixed;bottom:24px;left:520px;width:400px;height:48px;border-radius:24px;background:rgb(240,0,240);z-index:9"></div>
<section style="height:100vh;background:rgb(0,0,200)"></section>
${[1, 2, 3, 4]
  .map(
    (i) =>
      `<section style="height:700px;background:rgb(255,255,255);display:grid;place-items:center"><div class="r" style="width:600px;height:300px;background:rgb(0,160,0);opacity:0;transition:opacity .3s"></div></section>`,
  )
  .join("")}
<script>
  const io = new IntersectionObserver((es) => es.forEach((e) => (e.target.style.opacity = e.isIntersecting ? 1 : 0)), { threshold: 0.6 });
  document.querySelectorAll(".r").forEach((el) => io.observe(el));
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

const fullHeight = async (path: string, options: { expandContent?: boolean } = {}) => {
  const shots = await screenshotUrl(`${baseUrl}${path}`, options);
  return (await sharp(shots.full!).metadata()).height;
};

describe.skipIf(!chromium.installed)("full-page capture loads the whole page", () => {
  it("scrolls an infinite list until it stops growing", { timeout: 90_000 }, async () => {
    expect(await fullHeight("/infinite")).toBe(5000);
  });

  it("presses Load more until the button is gone when content expansion is on", { timeout: 90_000 }, async () => {
    expect(await fullHeight("/load-more", { expandContent: true })).toBe(1000 + 3 * 1500);
  });

  it("leaves Load more alone by default", { timeout: 90_000 }, async () => {
    expect(await fullHeight("/load-more")).toBeLessThan(2500);
  });

  it("captures a page that scrolls an inner panel", { timeout: 60_000 }, async () => {
    expect(await fullHeight("/inner")).toBeGreaterThanOrEqual(3000);
  });

  it("captures each part of the page the way a visitor scrolling through sees it", { timeout: 90_000 }, async () => {
    const shots = await screenshotUrl(`${baseUrl}/reveal`);
    const img = sharp(shots.full!);
    const { width, height } = await img.metadata();
    expect([width, height]).toEqual([1440, 900 + 4 * 700]);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const near = (c: number[], want: number[]) => c.every((v, k) => Math.abs(v - want[k]) < 40);
    // the hero keeps its 900px instead of stretching to the page
    expect(near(at(100, 850), [0, 0, 200])).toBe(true);
    expect(near(at(720, 960), [255, 255, 255])).toBe(true);
    // every section shows its revealed card
    for (let i = 0; i < 4; i++) expect(near(at(720, 900 + i * 700 + 350), [0, 160, 0])).toBe(true);
    // the fixed bar and the narrow pill floating at the bottom show once, in the first screen, not over every screen
    expect(near(at(720, 20), [200, 0, 0])).toBe(true);
    expect(near(at(720, 900 + 20), [200, 0, 0])).toBe(false);
    expect(near(at(720, 900 - 48), [240, 0, 240])).toBe(true);
    expect(near(at(720, 2 * 900 - 48), [240, 0, 240])).toBe(false);
  });

  it("skips the full page when asked (sources)", { timeout: 60_000 }, async () => {
    const shots = await screenshotUrl(`${baseUrl}/inner`, { fullPage: false });
    expect(shots.full).toBeNull();
    expect(await sharp(shots.viewport).metadata()).toMatchObject({ width: 1440, height: 900 });
  });
});
