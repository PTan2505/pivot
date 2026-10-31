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
/**
 * What the test server answers: a page whose colour changes per capture, a block page, a sign-in wall, a 503 the
 * first time it is asked (then the page), a 429 with Retry-After the first time, or a page that never finishes.
 */
let mode: "page" | "blocked" | "signin" | "flaky" | "limited" | "slow" = "page";
let hits = 0;
let failuresLeft = 0;

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
    const browser = req.headers["user-agent"]?.includes("Chrome");
    if (browser && (mode === "flaky" || mode === "limited") && failuresLeft > 0) {
      failuresLeft--;
      res.statusCode = mode === "flaky" ? 503 : 429;
      if (mode === "limited") res.setHeader("retry-after", "1");
      return res.end("<title>Busy</title><body>Try again</body>");
    }
    if (mode === "slow" && browser) return; // never answers
    if (mode === "signin") {
      return res.end(
        `<title>Sign in</title><body style="margin:0;background:#fff"><h1>Sign in</h1><form><input name="u"><input type="password" name="p"></form></body>`,
      );
    }
    // the capture first asks where redirects lead with a plain request; only the browser's load counts as a capture
    if (browser) hits++;
    res.end(
      `<body style="margin:0;background:#${hits % 2 ? "234" : "543"}"><h1 style="color:#fff;font:64px sans-serif">Capture ${hits}</h1><div style="height:1200px"></div></body>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  capture = await import("../src/capture");
  capture.captureTiming.retryDelaysMs = [200, 200];
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

      // Retake that works: new shots become the Latest, the first ones are kept as the Original, and the new
      // viewport becomes the cover.
      mode = "page";
      await capture.enqueueCapture(r.id);
      const again = await settled(r.id);
      expect(again.captureStatus).toBe("done");
      expect(again.captureQuality).toBe("looks_good");
      const after = await shotIds(r.id);
      expect(after.map((s) => s.split(":")[0]).sort()).toEqual([
        "screenshot",
        "screenshot-full",
        "screenshot-full-original",
        "screenshot-original",
      ]);
      const originals = before.map((s) =>
        s.replace(/^screenshot(-full)?:/, (_, full) => `screenshot${full ?? ""}-original:`),
      );
      expect(after).toEqual(expect.arrayContaining(originals));
      expect(again.coverAssetId).not.toBe(first.coverAssetId);

      // A third capture replaces the Latest; the Original stays and the in-between shots are deleted.
      await capture.enqueueCapture(r.id);
      await settled(r.id);
      const third = await shotIds(r.id);
      expect(third).toHaveLength(4);
      expect(third).toEqual(expect.arrayContaining(originals));
      const between = after.filter((s) => !s.includes("original")).map((s) => s.split(":")[1]);
      for (const id of between) expect(await assets.getAsset(id)).toBeNull();

      // Every run is in the capture history, newest first.
      const history = await capture.listCaptureAttempts(r.id);
      expect(history.map((a) => a.status)).toEqual(["completed", "completed", "failed", "completed"]);
      expect(history[0].context).toMatchObject({ colorScheme: "dark", expandContent: false });

      // An uploaded image replaces the Latest shots and becomes the cover, so the card shows it; the Original stays.
      const sharp = (await import("sharp")).default;
      const png = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "#f60" } })
        .png()
        .toBuffer();
      const upload = await assets.saveAsset({ data: png, fileName: "mine.png" });
      await capture.replaceScreenshot(r.id, upload.id);
      const replaced = (await resources.getResource(r.id))!;
      expect((await shotIds(r.id)).filter((s) => !s.includes("original"))).toEqual([`screenshot:${upload.id}`]);
      expect(await shotIds(r.id)).toEqual(expect.arrayContaining(originals));
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

describe.skipIf(!(await (await import("../src/capture")).playwrightStatus()).installed)("capture reliability", () => {
  it("doesn't replace a good screenshot with a sign-in wall", { timeout: 90_000 }, async () => {
    mode = "page";
    const r = await resources.createResource({ type: "reference", title: "Wall", sourceUrl: `${baseUrl}?wall` });
    await capture.enqueueCapture(r.id);
    const good = await settled(r.id);
    const before = await shotIds(r.id);

    mode = "signin";
    await capture.enqueueCapture(r.id);
    const kept = await settled(r.id);
    expect(kept.captureStatus).toBe("done");
    expect(kept.captureError).toMatch(/sign-in form.*previous screenshot was kept/);
    expect(await shotIds(r.id)).toEqual(before);
    expect(kept.coverAssetId).toBe(good.coverAssetId);
    const [last] = await capture.listCaptureAttempts(r.id);
    expect(last).toMatchObject({ status: "completed", quality: "needs_review", qualityReasons: ["sign_in_page"] });
  });

  it("flags a sign-in wall when there is no earlier screenshot", { timeout: 60_000 }, async () => {
    mode = "signin";
    const r = await resources.createResource({ type: "reference", title: "Wall 2", sourceUrl: `${baseUrl}?wall2` });
    await capture.enqueueCapture(r.id);
    const done = await settled(r.id);
    expect(done.captureQuality).toBe("needs_review");
    expect(done.captureError).toMatch(/may look wrong: it shows a sign-in form/);
  });

  it("retries a 503 and succeeds", { timeout: 90_000 }, async () => {
    mode = "flaky";
    failuresLeft = 1;
    const r = await resources.createResource({ type: "reference", title: "Flaky", sourceUrl: `${baseUrl}?flaky` });
    await capture.enqueueCapture(r.id);
    const done = await settled(r.id);
    expect(done.captureStatus).toBe("done");
    const [attempt] = await capture.listCaptureAttempts(r.id);
    expect(attempt.status).toBe("completed");
    expect(attempt.context.retries).toBe(1);
  });

  it("waits for Retry-After on a 429, then succeeds", { timeout: 90_000 }, async () => {
    mode = "limited";
    failuresLeft = 1;
    const r = await resources.createResource({ type: "reference", title: "Limited", sourceUrl: `${baseUrl}?limited` });
    await capture.enqueueCapture(r.id);
    const done = await settled(r.id);
    expect(done.captureStatus).toBe("done");
    const [attempt] = await capture.listCaptureAttempts(r.id);
    expect(attempt.context.retries).toBe(1);
  });

  it("doesn't retry a blocked page", { timeout: 60_000 }, async () => {
    mode = "blocked";
    const r = await resources.createResource({ type: "reference", title: "Blocked", sourceUrl: `${baseUrl}?blocked` });
    await capture.enqueueCapture(r.id);
    const done = await settled(r.id);
    expect(done.captureStatus).toBe("failed");
    const [attempt] = await capture.listCaptureAttempts(r.id);
    expect(attempt).toMatchObject({ status: "failed", quality: "unavailable" });
    expect(attempt.context.retries).toBeUndefined();
  });

  it("cancels a running capture and keeps what was saved", { timeout: 60_000 }, async () => {
    mode = "slow";
    const r = await resources.createResource({ type: "reference", title: "Slow", sourceUrl: `${baseUrl}?slow` });
    await capture.enqueueCapture(r.id);
    // let the browser start loading the page
    for (let i = 0; i < 40; i++) {
      const [a] = await capture.listCaptureAttempts(r.id);
      if (a?.status === "capturing") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(await capture.cancelCapture(r.id)).toBe(true);
    const done = await settled(r.id);
    expect(done.captureStatus).toBe("cancelled");
    const [attempt] = await capture.listCaptureAttempts(r.id);
    expect(attempt.status).toBe("cancelled");
    mode = "page";
  });

  it("keeps the capture settings and lets one capture override them", { timeout: 60_000 }, async () => {
    const settings = await import("../src/settings");
    expect(await settings.getCaptureSettings()).toEqual({ expandContent: false, theme: "dark" });
    await settings.setCaptureSettings({ theme: "light", expandContent: "yes", junk: 1 });
    expect(await settings.getCaptureSettings()).toEqual({ expandContent: false, theme: "light" });
    mode = "page";
    const r = await resources.createResource({ type: "reference", title: "Light", sourceUrl: `${baseUrl}?light` });
    await capture.enqueueCapture(r.id, { expandContent: true });
    await settled(r.id);
    const [attempt] = await capture.listCaptureAttempts(r.id);
    expect(attempt.context).toMatchObject({ theme: "light", colorScheme: "light", expandContent: true });
    const shot = (await assets.listResourceAssets(r.id)).find((a) => a.role === "screenshot")!;
    expect(shot.meta).toMatchObject({ colorScheme: "light", method: "server" });
    await settings.setCaptureSettings({ theme: "dark" });
  });
});

describe.skipIf(!(await (await import("../src/capture")).playwrightStatus()).installed)("capture extras", () => {
  it(
    "captures tablet and mobile at their real sizes in the same reference, and replaces them next time",
    { timeout: 120_000 },
    async () => {
      mode = "page";
      const r = await resources.createResource({
        type: "reference",
        title: "Responsive",
        sourceUrl: `${baseUrl}?resp`,
      });
      await capture.enqueueCapture(r.id, { viewports: ["tablet", "mobile"] });
      await settled(r.id);
      const shots = (await assets.listResourceAssets(r.id)).filter((a) => a.role === "screenshot-responsive");
      expect(shots.map((a) => [a.meta.viewportName, a.width]).sort()).toEqual([
        ["mobile", 390],
        ["tablet", 820],
      ]);
      await capture.enqueueCapture(r.id, { viewports: ["mobile"] });
      await settled(r.id);
      const again = (await assets.listResourceAssets(r.id)).filter((a) => a.role === "screenshot-responsive");
      expect(again.filter((a) => a.meta.viewportName === "mobile")).toHaveLength(1);
      expect(again.filter((a) => a.meta.viewportName === "tablet")).toHaveLength(1);
      const [attempt] = await capture.listCaptureAttempts(r.id);
      expect(attempt.context.extras).toMatchObject({ mobile: "done" });
    },
  );

  it("records motion as a video with keyframes", { timeout: 120_000 }, async () => {
    mode = "page";
    const r = await resources.createResource({ type: "reference", title: "Motion", sourceUrl: `${baseUrl}?motion` });
    await capture.enqueueCapture(r.id, { motion: true });
    await settled(r.id);
    const list = await assets.listResourceAssets(r.id);
    const video = list.find((a) => a.role === "motion-video");
    expect(video?.mimeType).toBe("video/webm");
    expect(video?.size).toBeGreaterThan(1000);
    // a rest on the first screen, the glide down, a rest at the bottom
    expect(video?.meta.durationMs).toBeGreaterThanOrEqual(2000);
    const keyframes = list.filter((a) => a.role === "motion-keyframe");
    expect(keyframes.map((k) => k.meta.scrollY)).toEqual([0, expect.any(Number)]);
    // the page is about 1360px tall in a 900px window: the recording reaches its bottom
    expect(keyframes[1].meta.scrollY).toBeGreaterThan(400);
  });

  it("keeps a capture-later request waiting until it is run", { timeout: 60_000 }, async () => {
    mode = "page";
    const r = await resources.createResource({ type: "reference", title: "Later", sourceUrl: `${baseUrl}?later` });
    const id = await capture.enqueueCapture(r.id, {}, { defer: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await resources.getResource(r.id))!.captureStatus).toBeNull();
    expect((await capture.listCaptureAttempts(r.id))[0].status).toBe("deferred");
    // a restart doesn't run it either
    await capture.resumePendingCaptures();
    expect((await capture.listCaptureAttempts(r.id))[0].status).toBe("deferred");
    expect(await capture.runDeferredCapture(id)).toBe(true);
    expect((await settled(r.id)).captureStatus).toBe("done");
    expect(await capture.runDeferredCapture(id)).toBe(false);
  });

  it(
    "compares Original and Latest, saves a new design version, and reports repeated failures",
    { timeout: 120_000 },
    async () => {
      const compare = await import("../src/compare");
      const links = await import("../src/links");
      mode = "page";
      const r = await resources.createResource({
        type: "reference",
        title: "Versions",
        sourceUrl: `${baseUrl}?versions`,
      });
      await capture.enqueueCapture(r.id);
      await settled(r.id);
      await capture.enqueueCapture(r.id);
      await settled(r.id);
      const pair = (await compare.originalAndLatest(r.id))!;
      const diff = await compare.diffAssets(pair.original, pair.latest);
      // the test page swaps its background colour between captures: almost everything changed
      expect(diff.changedRatio).toBeGreaterThan(0.5);
      expect(diff.image.subarray(1, 4).toString()).toBe("PNG");

      const newer = await compare.createDesignVersion(r.id);
      const v = (await resources.getResource(newer))!;
      expect(v.title).toMatch(/^Versions \(\d{4}-\d{2}\)$/);
      expect(v.assets.map((a) => a.id).sort()).toEqual(
        (await assets.listResourceAssets(r.id))
          .filter((a) => a.role === "screenshot" || a.role === "screenshot-full")
          .map((a) => a.id)
          .sort(),
      );
      expect((await links.listLinks(newer))[0]).toMatchObject({ kind: "newer_version_of", direction: "out" });
      // the old reference keeps its Original
      expect((await assets.listResourceAssets(r.id)).some((a) => a.role === "screenshot-original")).toBe(true);

      mode = "blocked";
      const sad = await resources.createResource({ type: "reference", title: "Sad", sourceUrl: `${baseUrl}?sad` });
      for (let i = 0; i < 3; i++) {
        await capture.enqueueCapture(sad.id);
        await settled(sad.id);
      }
      const health = await compare.captureHealth();
      expect(health.failingSites.find((h) => h.host === "127.0.0.1")?.failures).toBeGreaterThanOrEqual(3);
      mode = "page";
    },
  );
});
