import { and, eq, inArray } from "drizzle-orm";
import type { Browser } from "playwright";
import sharp from "sharp";
import { attachAsset, deleteOrphanAssets, saveAsset } from "./assets";
import { getDb } from "./db/client";
import { resourceAssets, resources } from "./db/schema";
import { fetchUrlMetadata } from "./metadata";
import { assertPublicUrl, safeFetch } from "./net-guard";
import { setResourceFields } from "./resources";

const VIEWPORT = { width: 1440, height: 900 };
/** Full-page shots keep only the top 12000px; Chromium never renders below the clip. */
export const MAX_FULL_PAGE_HEIGHT = 12_000;
// sharp rejects inputs above ~268 MP by default; size its limit to the clipped full-page shot.
const FULL_PAGE_PIXEL_LIMIT = VIEWPORT.width * MAX_FULL_PAGE_HEIGHT;
const IDLE_CLOSE_MS = 2 * 60 * 1000;

interface CaptureState {
  browser?: Promise<Browser>;
  idleTimer?: ReturnType<typeof setTimeout>;
  queue: string[];
  running: boolean;
}

const g = globalThis as unknown as { __stanBagCapture?: CaptureState };
const state: CaptureState = (g.__stanBagCapture ??= { queue: [], running: false });

async function browser(): Promise<Browser> {
  if (!state.browser) {
    state.browser = import("playwright")
      .then(({ chromium }) => chromium.launch())
      .catch((err: Error) => {
        state.browser = undefined;
        if (/Executable doesn't exist|browserType.launch/.test(err.message)) {
          throw new Error("Chromium for Playwright is not installed. Run `pnpm setup:browser`.");
        }
        throw err;
      });
  }
  return state.browser;
}

/** Closes the shared Chromium instance; the next capture launches a new one. */
export async function closeCaptureBrowser() {
  clearTimeout(state.idleTimer);
  const b = state.browser;
  state.browser = undefined;
  await (await b)?.close().catch(() => {});
}

function scheduleIdleClose() {
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(closeCaptureBrowser, IDLE_CLOSE_MS);
}

export async function screenshotUrl(url: string) {
  await assertPublicUrl(url);
  const b = await browser();
  const context = await b.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark" });
  // Re-check every navigation and subresource the page makes, so redirects can't reach private hosts.
  await context.route("**/*", async (route) => {
    try {
      const reqUrl = route.request().url();
      if (/^https?:/.test(reqUrl)) await assertPublicUrl(reqUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const viewport = await page.screenshot({ type: "png" });
    // A too-tall or broken full-page shot must not cost us the viewport shot.
    const full = await page
      .screenshot({
        type: "png",
        fullPage: true,
        // Playwright trims the clip to the document, so short pages keep their real height.
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: MAX_FULL_PAGE_HEIGHT },
      })
      .then((png) => sharp(png, { limitInputPixels: FULL_PAGE_PIXEL_LIMIT }).webp({ quality: 80 }).toBuffer())
      .catch(() => null);
    return {
      viewport: await sharp(viewport).webp({ quality: 85 }).toBuffer(),
      full,
    };
  } finally {
    await context.close();
    scheduleIdleClose();
  }
}

/** Detaches previous server screenshots and returns their asset ids. */
async function detachScreenshots(resourceId: string) {
  const db = await getDb();
  const old = await db
    .delete(resourceAssets)
    .where(
      and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.role, ["screenshot", "screenshot-full"])),
    )
    .returning({ assetId: resourceAssets.assetId });
  return old.map((o) => o.assetId);
}

async function captureOne(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!row?.sourceUrl) return;
  const host = new URL(row.sourceUrl).hostname.replace(/^www\./, "");
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const shots = await screenshotUrl(row.sourceUrl);
    const oldIds = await detachScreenshots(resourceId);
    const viewport = await saveAsset({
      data: shots.viewport,
      fileName: `${host}-${stamp}.webp`,
      sourceUrl: row.sourceUrl,
    });
    const full =
      shots.full &&
      (await saveAsset({ data: shots.full, fileName: `${host}-${stamp}-full.webp`, sourceUrl: row.sourceUrl }));
    await attachAsset(resourceId, viewport.id, "screenshot");
    if (full) await attachAsset(resourceId, full.id, "screenshot-full");
    // Keep a cover the user chose (or one clipped by the extension); replace only a previous server shot.
    const keepCover = row.coverAssetId && !oldIds.includes(row.coverAssetId);
    await setResourceFields(resourceId, {
      coverAssetId: keepCover ? row.coverAssetId : viewport.id,
      captureStatus: "done",
      captureError: null,
    });
    await deleteOrphanAssets(oldIds.filter((id) => id !== viewport.id && id !== full?.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fall back to the page's Open Graph image so the card still has a picture.
    const ogCover = await ogImageFallback(row.sourceUrl).catch(() => null);
    if (ogCover && !row.coverAssetId) {
      await attachAsset(resourceId, ogCover.id, "attachment");
      await setResourceFields(resourceId, { coverAssetId: ogCover.id });
    }
    await setResourceFields(resourceId, { captureStatus: "failed", captureError: message.slice(0, 500) });
  }
}

async function ogImageFallback(url: string) {
  const meta = await fetchUrlMetadata(url);
  if (!meta.imageUrl) return null;
  const { response, body } = await safeFetch(meta.imageUrl, { accept: "image/*", maxBytes: 15 * 1024 * 1024 });
  if (!response.ok) return null;
  const webp = await sharp(body).webp({ quality: 85 }).toBuffer();
  return saveAsset({ data: webp, fileName: `${new URL(url).hostname}-og.webp`, sourceUrl: meta.imageUrl });
}

async function drain() {
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length) {
      const id = state.queue.shift()!;
      await captureOne(id).catch(() => {});
    }
  } finally {
    state.running = false;
  }
}

/** Queues a background screenshot; progress is visible through resources.capture_status. */
export async function enqueueCapture(resourceId: string) {
  await setResourceFields(resourceId, { captureStatus: "pending", captureError: null });
  if (!state.queue.includes(resourceId)) state.queue.push(resourceId);
  void drain();
}

/** Captures interrupted by a server restart are still marked pending; queue them again. */
export async function resumePendingCaptures() {
  const db = await getDb();
  const rows = await db.select({ id: resources.id }).from(resources).where(eq(resources.captureStatus, "pending"));
  for (const r of rows) await enqueueCapture(r.id);
}

export async function playwrightStatus(): Promise<{ installed: boolean; path?: string }> {
  try {
    const { chromium } = await import("playwright");
    const path = chromium.executablePath();
    const fs = await import("node:fs");
    return { installed: fs.existsSync(path), path };
  } catch {
    return { installed: false };
  }
}
