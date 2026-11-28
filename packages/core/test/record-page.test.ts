// PIVOT's pictures of a built preview (record-page.ts), with Playwright's Chromium: the two screenshots at their sizes,
// a WebM video, and no request leaves the page.
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { playwrightStatus } from "../src/capture";
import { recordPage } from "../src/record-page";

const chromium = await playwrightStatus();
let tmp: string;
let server: http.Server;
let hits = 0;

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-record-"));
  server = http.createServer((_req, res) => {
    hits++;
    res.end("x");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
});
afterAll(async () => {
  server.close();
  await fsp.rm(tmp, { recursive: true, force: true });
});

describe.skipIf(!chromium.installed)("recording a built preview", () => {
  it("takes a desktop and a phone screenshot and a video, offline", async () => {
    const port = (server.address() as { port: number }).port;
    const html = `<!doctype html><html><body style="margin:0;background:#111;color:#eee">
<div style="height:2400px;font:48px sans-serif;padding:40px">A tall page</div>
<img src="http://127.0.0.1:${port}/beacon.png">
<script>fetch("http://127.0.0.1:${port}/api").catch(() => {});
requestAnimationFrame(() => requestAnimationFrame(() => parent.postMessage({ type: "21st-preview-ready" }, "*")));</script>
</body></html>`;
    const file = path.join(tmp, "page.html");
    await fsp.writeFile(file, html);
    const r = await recordPage(file, tmp);
    expect(await sharp(r.desktop).metadata()).toMatchObject({ format: "png", width: 2880, height: 1800 });
    expect(await sharp(r.mobile).metadata()).toMatchObject({ format: "png", width: 780, height: 1688 });
    // WebM starts with the EBML header
    expect(r.video.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    expect(r.video.byteLength).toBeGreaterThan(10_000);
    expect(hits).toBe(0);
  }, 60_000);
});
