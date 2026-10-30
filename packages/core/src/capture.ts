import { and, eq, inArray } from "drizzle-orm";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { attachAsset, deleteOrphanAssets, saveAsset } from "./assets";
import { getDb } from "./db/client";
import { resourceAssets, resources } from "./db/schema";
import { fetchUrlMetadata } from "./metadata";
import { assertPublicUrl, safeFetch, UnsafeUrlError } from "./net-guard";
import { setResourceFields } from "./resources";

const VIEWPORT = { width: 1440, height: 900 };
/** Full-page shots keep only the top 12000px: frames below it are never shot. */
export const MAX_FULL_PAGE_HEIGHT = 12_000;
/** Upper bounds for walking a page before the full-page shot, so endless feeds still finish. */
const MAX_SCROLL_STEPS = 60;
const MAX_LOAD_MORE_CLICKS = 8;
const SCROLL_BUDGET_MS = 45_000;
/** A whole capture (load, walk, shots) is abandoned after this, so one frozen page can't stall the queue. */
const CAPTURE_TIMEOUT_MS = 120_000;
/** Titles of bot-check and block pages, which are served in place of the site. */
const CHALLENGE_TITLE = /^(just a moment|attention required|access denied|security check|verifying you are human)/i;
const IDLE_CLOSE_MS = 2 * 60 * 1000;

interface CaptureState {
  browser?: Promise<Browser>;
  idleTimer?: ReturnType<typeof setTimeout>;
  queue: string[];
  running: boolean;
}

const g = globalThis as unknown as { __pivotCapture?: CaptureState };
const state: CaptureState = (g.__pivotCapture ??= { queue: [], running: false });

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

/** Resolves once the page has had no request in flight for `quietMs`, or after `maxMs`. */
function networkQuiet(page: Page) {
  let inflight = 0;
  let last = Date.now();
  const up = () => {
    inflight++;
    last = Date.now();
  };
  const down = () => {
    inflight = Math.max(0, inflight - 1);
    last = Date.now();
  };
  page.on("request", up);
  page.on("requestfinished", down);
  page.on("requestfailed", down);
  return async (quietMs = 400, maxMs = 3000) => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (inflight === 0 && Date.now() - last >= quietMs) return;
      await page.waitForTimeout(100);
    }
  };
}

/**
 * Walks the page top to bottom before the full-page shot, so content that only appears on scroll is in it:
 * lazy images, reveal-on-scroll sections, infinite lists, and "Load more" buttons. Stops at the bottom once the
 * height stops growing, or when the page passes the full-page cap, or after the step/time budget.
 */
async function loadWholePage(page: Page, settle: ReturnType<typeof networkQuiet>) {
  // Pages that scroll an inner container instead of the document would otherwise shoot as one screen.
  await page.evaluate(UNLOCK_INNER_SCROLL).catch(() => {});
  await page.evaluate(EAGER_IMAGES).catch(() => {});

  const started = Date.now();
  let lastHeight = 0;
  let stableAtBottom = 0;
  let clicks = 0;
  // Scroll the way a visitor does, with the wheel, so pages that react to wheel or scroll events (reveals, lazy
  // sections, scroll-linked effects) load as they would for a person. The pointer sits mid-page.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  for (let step = 0; step < MAX_SCROLL_STEPS && Date.now() - started < SCROLL_BUDGET_MS; step++) {
    const before = await page.evaluate<{ bottom: number; height: number }>(SCROLL_POSITION);
    await page.mouse.wheel(0, Math.round(VIEWPORT.height * 0.85));
    await page.waitForTimeout(150);
    let { bottom, height } = await page.evaluate<{ bottom: number; height: number }>(SCROLL_POSITION);
    // the wheel landed on something that swallows it (a map, an iframe): scroll the page directly
    if (bottom <= before.bottom && bottom < height - 2)
      ({ bottom, height } = await page.evaluate<{ bottom: number; height: number }>(
        scrollStep(Math.round(VIEWPORT.height * 0.85)),
      ));
    await settle(250, 2500);
    if (height >= MAX_FULL_PAGE_HEIGHT) break;
    if (bottom < height - 2) {
      stableAtBottom = 0;
    } else if (clicks < MAX_LOAD_MORE_CLICKS && (await page.evaluate<boolean>(CLICK_LOAD_MORE).catch(() => false))) {
      clicks++;
      stableAtBottom = 0;
      await settle(500, 4000);
    } else {
      // At the bottom: give an infinite list a moment to append before deciding it's done.
      stableAtBottom = height === lastHeight ? stableAtBottom + 1 : 0;
      if (stableAtBottom >= 2) break;
      await page.waitForTimeout(500);
    }
    lastHeight = height;
  }
  await page.evaluate("scrollTo(0, 0)");
  await settle(300, 1500);
  await page.waitForTimeout(400);
}

// Scripts that run inside the captured page. Kept as strings: this package compiles without DOM types.

/** Lets an inner scroll container grow to its content, so a full-page shot of an app-like page includes it. */
const UNLOCK_INNER_SCROLL = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > innerHeight + 10) return;
  let best = null;
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (!/(auto|scroll)/.test(style.overflowY) || el.clientHeight < innerHeight * 0.5) continue;
    if (el.scrollHeight - el.clientHeight > 50 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
  }
  for (let el = best; el; el = el.parentElement) {
    el.style.setProperty("overflow", "visible", "important");
    el.style.setProperty("height", "auto", "important");
    el.style.setProperty("max-height", "none", "important");
  }
})()`;

const EAGER_IMAGES = `document.querySelectorAll("img[loading=lazy]").forEach((img) => { img.loading = "eager"; })`;

const SCROLL_POSITION = `(() => {
  const el = document.scrollingElement || document.documentElement;
  return { bottom: el.scrollTop + innerHeight, height: el.scrollHeight };
})()`;

/** Scrolls down by a step; returns how far down the page we are and how tall it is. */
const scrollStep = (by: number) => `(() => {
  scrollBy(0, ${by});
  const el = document.scrollingElement || document.documentElement;
  return { bottom: el.scrollTop + innerHeight, height: el.scrollHeight };
})()`;

/** Instant scrolling, so a frame is never shot halfway through a smooth scroll. */
const NO_SMOOTH_SCROLL = `for (const el of [document.documentElement, document.body])
  el && el.style.setProperty("scroll-behavior", "auto", "important")`;

const PAGE_HEIGHT = `Math.max(
  (document.scrollingElement || document.documentElement).scrollHeight,
  document.body ? document.body.scrollHeight : 0
)`;

/** Jumps to a position and returns where the page actually is (it may stop short at the bottom). */
const scrollToY = (y: number) => `(() => {
  scrollTo(0, ${y});
  return (document.scrollingElement || document.documentElement).scrollTop;
})()`;

/**
 * Hides wide fixed or sticky bars at the top or bottom edge (headers, cookie and promo bars, chat launchers), so they
 * appear once, in the first frame, instead of over every screen. Narrow ones such as a docs sidebar stay.
 */
const HIDE_REPEATING_BARS = `(() => {
  for (const el of document.querySelectorAll("body *")) {
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.width < innerWidth * 0.6 || r.height === 0 || r.height > innerHeight * 0.5) continue;
    if (r.top > 120 && r.bottom < innerHeight - 120) continue;
    el.style.setProperty("visibility", "hidden", "important");
  }
})()`;

/** Waits (up to 1.5s) for the images on screen to finish loading. */
const IMAGES_ON_SCREEN = `Promise.race([
  Promise.all([...document.images]
    .filter((img) => { const r = img.getBoundingClientRect(); return !img.complete && r.bottom > 0 && r.top < innerHeight; })
    .map((img) => new Promise((done) => { img.addEventListener("load", done, { once: true }); img.addEventListener("error", done, { once: true }); }))),
  new Promise((done) => setTimeout(done, 1500)),
])`;

/** How long each screen gets to finish its entrance animations before it is shot. */
const FRAME_SETTLE_MS = 500;

/**
 * The whole page as a visitor scrolling down sees it: one 1440×900 screen at a time, each shot after it has settled,
 * stitched top to bottom. A one-shot full-page screenshot resizes the window to the page's height instead, which
 * stretches 100vh sections and catches scroll-revealed content before it appears.
 */
async function stitchedFullPage(page: Page, settle: ReturnType<typeof networkQuiet>) {
  await page.evaluate(NO_SMOOTH_SCROLL).catch(() => {});
  const total = Math.min(MAX_FULL_PAGE_HEIGHT, await page.evaluate<number>(PAGE_HEIGHT));
  const frames: { input: Buffer; top: number; left: number }[] = [];
  for (let y = 0; y < total; y += VIEWPORT.height) {
    const at = await page.evaluate<number>(scrollToY(Math.min(y, Math.max(0, total - VIEWPORT.height))));
    // a page that won't scroll this far is done
    if (at < y - VIEWPORT.height + 1) break;
    if (y > 0) await page.evaluate(HIDE_REPEATING_BARS).catch(() => {});
    await settle(200, 1500);
    await page.evaluate(IMAGES_ON_SCREEN).catch(() => {});
    await page.waitForTimeout(FRAME_SETTLE_MS);
    const shot = await page.screenshot({ type: "png" });
    // The last screen stops at the bottom and overlaps the one before it: keep only what's new.
    const skip = Math.max(0, y - at);
    const height = Math.min(VIEWPORT.height - skip, total - y);
    if (height <= 0) break;
    frames.push({
      input: await sharp(shot).extract({ left: 0, top: skip, width: VIEWPORT.width, height }).toBuffer(),
      top: y,
      left: 0,
    });
  }
  const bottom = frames.length ? frames.at(-1)!.top + (await sharp(frames.at(-1)!.input).metadata()).height! : 0;
  if (!bottom) return null;
  return sharp({ create: { width: VIEWPORT.width, height: bottom, channels: 3, background: "#ffffff" } })
    .composite(frames)
    .webp({ quality: 80 })
    .toBuffer();
}

/** Clicks one visible "Load more"-style button. Buttons only, never links or form submits, so it can't navigate. */
const CLICK_LOAD_MORE = `(() => {
  const label = /^\\s*(load|show|view|see)\\s+more\\b|^\\s*(xem|tải)\\s+thêm\\b/i;
  for (const el of document.querySelectorAll("button, [role=button]")) {
    if (el.closest("a, form") || el.disabled) continue;
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim();
    const r = el.getBoundingClientRect();
    if (text.length > 40 || !label.test(text) || r.width === 0 || r.height === 0) continue;
    el.click();
    return true;
  }
  return false;
})()`;

/**
 * Where a URL's server redirects end up, checking every hop, so the browser starts at the final page and a redirect to a
 * private address is refused before the browser ever requests it. Falls back to the URL itself when the site doesn't
 * answer a plain request (the browser may still get through).
 */
async function followRedirects(url: string) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    let location: string | null;
    try {
      const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      await res.body?.cancel().catch(() => {});
      location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    } catch {
      return current;
    }
    if (!location) return current;
    current = new URL(location, current).toString();
  }
  return current;
}

/**
 * Screenshots a URL: the first screen, and (unless `fullPage` is false) the whole page after walking it so
 * scroll-loaded content is included.
 */
export async function screenshotUrl(
  url: string,
  { fullPage = true, timeoutMs = CAPTURE_TIMEOUT_MS }: { fullPage?: boolean; timeoutMs?: number } = {},
) {
  await assertPublicUrl(url);
  const start = await followRedirects(url);
  const b = await browser();
  // Service workers would answer requests the route below never sees.
  const context = await b.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    serviceWorkers: "block",
  });
  // Closing the context makes every pending page call reject, including a page.evaluate on a frozen page.
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => {});
  }, timeoutMs);
  // The first private address the page reached or tried to open; nothing is captured once there is one.
  let privateUrl: string | null = null;
  const checks: Promise<void>[] = [];
  const refuse = (target: string) => {
    privateUrl ??= target;
    void context.close().catch(() => {});
  };
  // Check every navigation and subresource the page makes before it goes out.
  await context.route("**/*", async (route) => {
    const request = route.request();
    try {
      if (/^https?:/.test(request.url())) await assertPublicUrl(request.url());
      await route.continue();
    } catch {
      // a page or frame heading for a private address is refused outright, not just left on the old page
      if (request.isNavigationRequest()) refuse(request.url());
      await route.abort("blockedbyclient").catch(() => {});
    }
  });
  // Playwright routes only the first request of a redirect chain, so each redirect hop is checked as it is made.
  context.on("request", (request) => {
    if (!request.redirectedFrom() || !/^https?:/.test(request.url())) return;
    checks.push(
      assertPublicUrl(request.url()).then(
        () => {},
        () => refuse(request.url()),
      ),
    );
  });
  const assertStayedPublic = async () => {
    await Promise.all(checks);
    if (privateUrl) throw new UnsafeUrlError("The page sent the browser to a private address, so it wasn't captured.");
  };
  try {
    const page = await context.newPage();
    const settle = networkQuiet(page);
    const response = await page.goto(start, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(800);
    // A block or error page is not a picture of the site; fail so the old screenshots stay.
    const status = response?.status() ?? 200;
    if ([401, 403, 429].includes(status) || CHALLENGE_TITLE.test((await page.title()).trim())) {
      throw new Error(
        `The site blocked the screenshot${status >= 400 ? ` (HTTP ${status})` : ""}. Try again later, or add a screenshot yourself.`,
      );
    }
    if (status >= 400) throw new Error(`The page answered with HTTP ${status}.`);
    await assertStayedPublic();
    const viewport = await page.screenshot({ type: "png" });
    let full: Buffer | null = null;
    if (fullPage) {
      await loadWholePage(page, settle).catch(() => {});
      // A broken full-page shot must not cost us the viewport shot.
      full = await stitchedFullPage(page, settle).catch(() => null);
    }
    // a redirect made while walking the page counts too
    await assertStayedPublic();
    return { viewport: await sharp(viewport).webp({ quality: 85 }).toBuffer(), full };
  } catch (err) {
    await Promise.all(checks);
    if (privateUrl) throw new UnsafeUrlError("The page sent the browser to a private address, so it wasn't captured.");
    if (timedOut) throw new Error(`The page took longer than ${Math.round(timeoutMs / 1000)}s to capture.`);
    throw err;
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
    scheduleIdleClose();
  }
}

/** Asset ids of the server screenshots currently linked to a resource. */
async function screenshotIds(resourceId: string) {
  const db = await getDb();
  const rows = await db
    .select({ assetId: resourceAssets.assetId })
    .from(resourceAssets)
    .where(
      and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.role, ["screenshot", "screenshot-full"])),
    );
  return rows.map((r) => r.assetId);
}

async function detachAssets(resourceId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  const db = await getDb();
  await db
    .delete(resourceAssets)
    .where(and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.assetId, assetIds)));
}

async function currentCover(resourceId: string) {
  const db = await getDb();
  const [now] = await db
    .select({ coverAssetId: resources.coverAssetId })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  return now;
}

async function captureOne(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!row) return;

  try {
    if (!row.sourceUrl) throw new Error("There is no URL to capture.");
    const host = new URL(row.sourceUrl).hostname.replace(/^www\./, "");
    const stamp = new Date().toISOString().slice(0, 10);
    // A source is a site you browse, not a page to study: its first screen is enough.
    const shots = await screenshotUrl(row.sourceUrl, { fullPage: row.type !== "source" });

    // Read the cover now, not before the capture: the user may have picked one meanwhile.
    const before = await currentCover(resourceId);
    if (!before) return; // deleted while capturing
    const previous = await screenshotIds(resourceId);
    // A cover you chose, or the view the extension took of the page, already shows the first screen; a
    // server viewport shot would repeat it, so only the full page is added.
    const ownCover = !!before.coverAssetId && !previous.includes(before.coverAssetId);
    const viewport = ownCover
      ? null
      : await saveAsset({ data: shots.viewport, fileName: `${host}-${stamp}.webp`, sourceUrl: row.sourceUrl });
    const full =
      shots.full &&
      (await saveAsset({ data: shots.full, fileName: `${host}-${stamp}-full.webp`, sourceUrl: row.sourceUrl }));
    const newIds = [viewport?.id, full?.id].filter((id): id is string => !!id);

    const now = await currentCover(resourceId);
    if (!now) {
      // Deleted while saving.
      await deleteOrphanAssets(newIds);
      return;
    }
    // Link the new shots before unlinking the old ones, so a failure never leaves the resource without any.
    const oldIds = previous.filter((id) => !newIds.includes(id));
    if (viewport) await attachAsset(resourceId, viewport.id, "screenshot");
    if (full) await attachAsset(resourceId, full.id, "screenshot-full");
    await detachAssets(resourceId, oldIds);
    // Keep a cover the user chose (or one clipped by the extension); replace only a previous server shot.
    const keepCover = now.coverAssetId && !oldIds.includes(now.coverAssetId);
    await setResourceFields(resourceId, {
      coverAssetId: keepCover ? now.coverAssetId : (viewport?.id ?? now.coverAssetId),
      captureStatus: "done",
      captureError: null,
    });
    await deleteOrphanAssets(oldIds);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fall back to the page's Open Graph image so the card still has a picture. It stands in for the
    // screenshot (same role), so the next successful capture replaces it.
    const ogCover = row.sourceUrl ? await ogImageFallback(row.sourceUrl).catch(() => null) : null;
    const now = await currentCover(resourceId);
    if (ogCover && now && !now.coverAssetId) {
      await attachAsset(resourceId, ogCover.id, "screenshot");
      await setResourceFields(resourceId, { coverAssetId: ogCover.id });
    }
    if (now) await setResourceFields(resourceId, { captureStatus: "failed", captureError: message.slice(0, 500) });
  }
}

/** Makes an uploaded image the resource's screenshot: it replaces the captured shots and becomes the cover. */
export async function replaceScreenshot(resourceId: string, assetId: string) {
  const oldIds = (await screenshotIds(resourceId)).filter((id) => id !== assetId);
  await attachAsset(resourceId, assetId, "screenshot");
  await detachAssets(resourceId, oldIds);
  await setResourceFields(resourceId, { coverAssetId: assetId, captureStatus: "done", captureError: null });
  await deleteOrphanAssets(oldIds);
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
