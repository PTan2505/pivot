import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { attachAsset, deleteOrphanAssets, saveAsset } from "./assets";
import { getDb } from "./db/client";
import { assets, captureAttempts, resourceAssets, resources } from "./db/schema";
import { fetchUrlMetadata } from "./metadata";
import { assertPublicUrl, safeFetch, UnsafeUrlError } from "./net-guard";
import { setResourceFields } from "./resources";
import { getCaptureSettings } from "./settings";
import {
  RESPONSIVE_VIEWPORTS,
  type AssetRole,
  type CaptureAttemptDTO,
  type CaptureOptions,
  type CaptureQuality,
  type CaptureTheme,
  type ResponsiveViewport,
} from "./types";

const DESKTOP = { width: 1440, height: 900 };
const VIEWPORT = DESKTOP;
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

/** Waits between automatic retries. Exported so tests can shorten them. */
export const captureTiming = {
  /** Before the 1st and 2nd retry of a timeout, network error or HTTP 502/503/504. */
  retryDelaysMs: [5_000, 20_000],
  /** A 429 asking to wait longer than this fails instead of retrying. */
  maxRetryAfterMs: 10 * 60_000,
  /** A 429 without a Retry-After header waits this long. */
  defaultRetryAfterMs: 60_000,
};
const MAX_RETRIES = 2;

export type CaptureErrorKind =
  "blocked" | "rate_limited" | "unavailable" | "http" | "timeout" | "network" | "unsafe" | "cancelled" | "other";

/** A capture failure with enough detail to decide whether to retry it. */
export class CaptureError extends Error {
  constructor(
    message: string,
    readonly kind: CaptureErrorKind,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Plain-language versions of the quality flags, for messages. */
export const QUALITY_REASON_TEXT: Record<string, string> = {
  blank: "the first screen is blank",
  sign_in_page: "it shows a sign-in form",
  broken_images: "some images didn't load",
  fonts_not_loaded: "the web fonts hadn't loaded",
  repeated_frames: "the full page repeats the same screen",
};

export function describeQuality(reasons: string[]) {
  return reasons.map((r) => QUALITY_REASON_TEXT[r] ?? r).join(", ");
}

interface Job {
  resourceId: string;
  attemptId: string;
}

interface CaptureState {
  browser?: Promise<Browser>;
  idleTimer?: ReturnType<typeof setTimeout>;
  queue: Job[];
  running: boolean;
  /** The job being captured now, and how to stop it. */
  current?: { job: Job; abort: AbortController };
  /** Jobs waiting to be retried, by resource id. */
  timers: Map<string, { job: Job; timer: ReturnType<typeof setTimeout> }>;
}

const g = globalThis as unknown as { __pivotCaptureJobs?: CaptureState };
const state: CaptureState = (g.__pivotCaptureJobs ??= { queue: [], running: false, timers: new Map() });

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
 * lazy images, reveal-on-scroll sections and infinite lists. "Load more" buttons are clicked only when
 * `expandContent` is on. Stops at the bottom once the
 * height stops growing, or when the page passes the full-page cap, or after the step/time budget.
 */
async function loadWholePage(page: Page, settle: ReturnType<typeof networkQuiet>, expandContent: boolean) {
  // Pages that scroll an inner container instead of the document would otherwise shoot as one screen.
  await page.evaluate(UNLOCK_INNER_SCROLL).catch(() => {});
  await page.evaluate(EAGER_IMAGES).catch(() => {});

  const started = Date.now();
  let lastHeight = 0;
  let stableAtBottom = 0;
  let clicks = 0;
  // Scroll the way a visitor does, with the wheel, so pages that react to wheel or scroll events (reveals, lazy
  // sections, scroll-linked effects) load as they would for a person. The pointer sits mid-page.
  const vp = page.viewportSize() ?? VIEWPORT;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let step = 0; step < MAX_SCROLL_STEPS && Date.now() - started < SCROLL_BUDGET_MS; step++) {
    const before = await page.evaluate<{ bottom: number; height: number }>(SCROLL_POSITION);
    await page.mouse.wheel(0, Math.round(vp.height * 0.85));
    await page.waitForTimeout(150);
    let { bottom, height } = await page.evaluate<{ bottom: number; height: number }>(SCROLL_POSITION);
    // the wheel landed on something that swallows it (a map, an iframe): scroll the page directly
    if (bottom <= before.bottom && bottom < height - 2)
      ({ bottom, height } = await page.evaluate<{ bottom: number; height: number }>(
        scrollStep(Math.round(vp.height * 0.85)),
      ));
    await settle(250, 2500);
    if (height >= MAX_FULL_PAGE_HEIGHT) break;
    if (bottom < height - 2) {
      stableAtBottom = 0;
    } else if (
      expandContent &&
      clicks < MAX_LOAD_MORE_CLICKS &&
      (await page.evaluate<boolean>(CLICK_LOAD_MORE).catch(() => false))
    ) {
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
 * Hides fixed or sticky pieces that would repeat over every screen, so they appear once, in the first frame: wide bars at
 * the top edge (headers), and anything floating at the bottom edge (cookie and promo bars, "start a project" pills, chat
 * launchers), however narrow. Tall narrow ones such as a docs sidebar stay.
 */
const HIDE_REPEATING_BARS = `(() => {
  for (const el of document.querySelectorAll("body *")) {
    const position = getComputedStyle(el).position;
    if (position !== "fixed" && position !== "sticky") continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.height > innerHeight * 0.5) continue;
    const header = r.top <= 120 && r.width >= innerWidth * 0.6;
    const floatingAtBottom = r.bottom >= innerHeight - 120;
    if (header || floatingAtBottom) el.style.setProperty("visibility", "hidden", "important");
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
  const VIEWPORT = page.viewportSize() ?? DESKTOP;
  await page.evaluate(NO_SMOOTH_SCROLL).catch(() => {});
  const total = Math.min(MAX_FULL_PAGE_HEIGHT, await page.evaluate<number>(PAGE_HEIGHT));
  const frames: { input: Buffer; top: number; left: number }[] = [];
  // A page that stops scrolling halfway shoots the same screen again and again.
  let previous = "";
  let sameInARow = 0;
  let repeated = false;
  for (let y = 0; y < total; y += VIEWPORT.height) {
    const at = await page.evaluate<number>(scrollToY(Math.min(y, Math.max(0, total - VIEWPORT.height))));
    // a page that won't scroll this far is done
    if (at < y - VIEWPORT.height + 1) break;
    if (y > 0) await page.evaluate(HIDE_REPEATING_BARS).catch(() => {});
    await settle(200, 1500);
    await page.evaluate(IMAGES_ON_SCREEN).catch(() => {});
    await page.waitForTimeout(FRAME_SETTLE_MS);
    const shot = await page.screenshot({ type: "png" });
    const digest = crypto.createHash("sha1").update(shot).digest("hex");
    sameInARow = digest === previous ? sameInARow + 1 : 0;
    if (sameInARow >= 2) repeated = true;
    previous = digest;
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
  const image = await sharp({ create: { width: VIEWPORT.width, height: bottom, channels: 3, background: "#ffffff" } })
    .composite(frames)
    .webp({ quality: 80 })
    .toBuffer();
  return { image, repeated };
}

/** Signs that a shot may not show the real page: a sign-in form, broken images, fonts still loading. */
const PAGE_ISSUES = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const password = [...document.querySelectorAll("input[type=password]")].some(visible);
  const images = [...document.images].filter(visible);
  const broken = images.filter((img) => img.complete && img.naturalWidth === 0).length;
  return {
    password,
    broken,
    images: images.length,
    fonts: document.fonts ? document.fonts.status : "loaded",
    text: (document.body ? document.body.innerText : "").trim().length,
    // running CSS/Web animations, videos and canvases: the page probably moves, so a recording may say more
    moving:
      (document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").length : 0) +
      document.querySelectorAll("video, canvas").length,
  };
})()`;

/** Turns what the page reported, and the first-screen image, into quality flags. */
async function qualityIssues(page: Page, viewport: Buffer) {
  const issues: string[] = [];
  const info = await page
    .evaluate<{ password: boolean; broken: number; images: number; fonts: string; text: number; moving: number }>(
      PAGE_ISSUES,
    )
    .catch(() => null);
  if (info?.password && info.text < 3000) issues.push("sign_in_page");
  if (info && (info.broken >= 3 || (info.broken > 0 && info.broken / info.images > 0.3))) issues.push("broken_images");
  if (info && info.fonts !== "loaded") issues.push("fonts_not_loaded");
  const stats = await sharp(viewport).stats();
  if (stats.channels.slice(0, 3).every((c) => c.stdev < 3)) issues.push("blank");
  return { issues, motionLikely: (info?.moving ?? 0) >= 2 };
}

/** Seconds or an HTTP date, as in a Retry-After header. */
function parseRetryAfter(value: string | undefined) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** A phone's user agent, so sites that pick a layout by device serve their mobile one. */
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
/** The recording plays at this rate; every frame is a screenshot taken at its own scroll position. */
const MOTION_FPS = 30;
/** Cruising scroll speed in the video, px per second of video. */
const MOTION_SPEED = 900;
/** Time the scroll takes to reach that speed, and to slow to a stop at the bottom. */
const MOTION_EASE_S = 0.6;
/** The video rests this long on the first and the last screen. */
const MOTION_HOLD_S = 1;
/** Wall-clock limit for taking the frames; a slower page ends its video where the scroll got to. */
const MOTION_BUDGET_MS = 75_000;
const MAX_KEYFRAMES = 8;

/** Scrolls to a position; returns where the page is and how far it can scroll (up to the full-page cap). */
const scrollAndMeasure = (y: number) => `(() => {
  scrollTo(0, ${y});
  const el = document.scrollingElement || document.documentElement;
  return { at: el.scrollTop, max: Math.max(0, Math.min(${MAX_FULL_PAGE_HEIGHT}, el.scrollHeight) - innerHeight) };
})()`;

/**
 * Playwright's own ffmpeg, installed next to its Chromium by `pnpm setup:browser` (it is what `recordVideo` uses);
 * `PIVOT_FFMPEG` overrides it, and one on the PATH is the last resort.
 */
async function ffmpegPath() {
  if (process.env.PIVOT_FFMPEG) return process.env.PIVOT_FFMPEG;
  const { chromium } = await import("playwright");
  // …/ms-playwright/chromium-1234/chrome-mac/…: the ffmpeg-NNNN folder sits beside chromium-NNNN
  let dir = path.dirname(chromium.executablePath());
  while (dir !== path.dirname(dir) && !/^chromium(_headless_shell)?-\d+$/.test(path.basename(dir))) {
    dir = path.dirname(dir);
  }
  const root = path.dirname(dir);
  const exe =
    process.platform === "darwin" ? "ffmpeg-mac" : process.platform === "win32" ? "ffmpeg-win64.exe" : "ffmpeg-linux";
  const folders = (await fs.readdir(root).catch(() => [] as string[]))
    .filter((name) => /^ffmpeg-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(7)) - Number(a.slice(7)));
  for (const folder of folders) {
    const file = path.join(root, folder, exe);
    if (
      await fs.stat(file).then(
        () => true,
        () => false,
      )
    )
      return file;
  }
  return "ffmpeg";
}

/** An ffmpeg process turning the JPEG frames written to it into a VP9 webm at `file`. */
async function startEncoder(file: string) {
  const proc = spawn(
    await ffmpegPath(),
    [
      ...["-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(MOTION_FPS), "-i", "pipe:0"],
      ...["-c:v", "libvpx-vp9", "-crf", "28", "-b:v", "0", "-deadline", "good", "-cpu-used", "5", "-row-mt", "1"],
      ...["-pix_fmt", "yuv420p", "-an", "-y", file],
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  // a write after ffmpeg died fails here instead of crashing the process; `exited` reports why
  proc.stdin.on("error", () => {});
  const exited = new Promise<void>((resolve, reject) => {
    proc.on("error", (err: NodeJS.ErrnoException) =>
      reject(
        err.code === "ENOENT"
          ? new CaptureError("Recording needs Playwright's ffmpeg. Run `pnpm setup:browser`.", "other")
          : err,
      ),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg stopped (${code}): ${stderr.trim() || "no output"}`)),
    );
  });
  exited.catch(() => {});
  return {
    async write(frame: Buffer) {
      if (!proc.stdin.write(frame)) await Promise.race([once(proc.stdin, "drain"), exited]);
    },
    async finish() {
      proc.stdin.end();
      await exited;
    },
    kill: () => proc.kill("SIGKILL"),
  };
}

/** Up to `max` items spread evenly from first to last. */
function spread<T>(items: T[], max: number) {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

/**
 * Records the page scrolling from top to bottom as a smooth 30 fps video, the way a screen recording of a visitor
 * reads it: a rest on the first screen, an eased glide down at a steady speed, a rest at the bottom. Each frame is a
 * screenshot taken at its exact scroll position, so a slow page never stutters the video (waiting for images costs
 * time, not frames), and scroll-triggered reveals play as the page reaches them. Keyframes come from the same frames.
 */
async function recordScroll(page: Page, file: string) {
  await page.evaluate(NO_SMOOTH_SCROLL).catch(() => {});
  await page.evaluate(UNLOCK_INNER_SCROLL).catch(() => {});
  await page.evaluate(EAGER_IMAGES).catch(() => {});
  const vp = page.viewportSize() ?? DESKTOP;
  // the pointer rests mid-screen, so hover effects show as the page passes under it
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.evaluate(IMAGES_ON_SCREEN).catch(() => {});

  const cdp = await page.context().newCDPSession(page);
  const encoder = await startEncoder(file);
  const candidates: { jpeg: Buffer; scrollY: number }[] = [];
  let frames = 0;
  let y = 0;
  const shoot = async () => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, optimizeForSpeed: true });
    const jpeg = Buffer.from(data, "base64");
    await encoder.write(jpeg);
    frames++;
    return jpeg;
  };
  try {
    const started = Date.now();
    candidates.push({ jpeg: await shoot(), scrollY: 0 });
    for (let i = 1; i < MOTION_FPS * MOTION_HOLD_S; i++) await shoot();

    const accel = MOTION_SPEED / MOTION_EASE_S;
    let speed = 0;
    let stuck = 0;
    let waitedAt = 0;
    let { max } = await page.evaluate<{ at: number; max: number }>(scrollAndMeasure(0));
    while (y < max - 0.5 && Date.now() - started < MOTION_BUDGET_MS) {
      // speed up to cruising, and slow down in time to stop at the bottom (which moves if the page grows)
      speed = Math.min(MOTION_SPEED, speed + accel / MOTION_FPS, Math.sqrt(2 * accel * (max - y)));
      y = Math.min(max, y + Math.max(speed, 20) / MOTION_FPS);
      const moved = await page.evaluate<{ at: number; max: number }>(scrollAndMeasure(Math.round(y)));
      max = moved.max;
      // a page that won't scroll any further is done
      stuck = moved.at < Math.round(y) - 2 ? stuck + 1 : 0;
      if (stuck >= MOTION_FPS / 2) break;
      if (y - waitedAt >= vp.height / 2) {
        await page.evaluate(IMAGES_ON_SCREEN).catch(() => {});
        waitedAt = y;
      }
      const jpeg = await shoot();
      if (y - candidates[candidates.length - 1].scrollY >= vp.height * 0.8) {
        candidates.push({ jpeg, scrollY: Math.round(y) });
      }
    }
    await page.evaluate(IMAGES_ON_SCREEN).catch(() => {});
    let last = await shoot();
    for (let i = 1; i < MOTION_FPS * MOTION_HOLD_S; i++) last = await shoot();
    if (y - candidates[candidates.length - 1].scrollY >= vp.height * 0.25) {
      candidates.push({ jpeg: last, scrollY: Math.round(y) });
    }
    await encoder.finish();
  } catch (err) {
    encoder.kill();
    throw err;
  }
  const keyframes = await Promise.all(
    spread(candidates, MAX_KEYFRAMES).map(async (c) => ({
      data: await sharp(c.jpeg).webp({ quality: 85 }).toBuffer(),
      scrollY: c.scrollY,
    })),
  );
  return { video: await fs.readFile(file), durationMs: Math.round((frames / MOTION_FPS) * 1000), keyframes };
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
  {
    fullPage = true,
    timeoutMs = CAPTURE_TIMEOUT_MS,
    expandContent = false,
    colorScheme = "dark",
    signal,
    viewport = DESKTOP,
    mobile = false,
    motion = false,
  }: {
    fullPage?: boolean;
    timeoutMs?: number;
    expandContent?: boolean;
    colorScheme?: "light" | "dark";
    /** Aborting it stops the capture as soon as the browser can be closed. */
    signal?: AbortSignal;
    /** The browser window size; 1440×900 by default. */
    viewport?: { width: number; height: number };
    /** A phone or tablet: touch, mobile layout rules and a mobile user agent, not a shrunk desktop. */
    mobile?: boolean;
    /** Record the page scrolling as a video, with keyframes, instead of the full-page shot. */
    motion?: boolean;
  } = {},
) {
  if (signal?.aborted) throw new CaptureError("The capture was cancelled.", "cancelled");
  await assertPublicUrl(url);
  const start = await followRedirects(url);
  const b = await browser();
  // Service workers would answer requests the route below never sees.
  const videoDir = motion ? await fs.mkdtemp(path.join(os.tmpdir(), "pivot-motion-")) : null;
  const context = await b.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme,
    serviceWorkers: "block",
    ...(mobile ? { isMobile: true, hasTouch: true, userAgent: MOBILE_UA } : {}),
  });
  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    void context.close().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
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
    if (status === 429) {
      const retryAfterMs = parseRetryAfter((await response?.allHeaders())?.["retry-after"]);
      throw new CaptureError("The site is rate limiting requests (HTTP 429).", "rate_limited", retryAfterMs);
    }
    if ([401, 403].includes(status) || CHALLENGE_TITLE.test((await page.title()).trim())) {
      throw new CaptureError(
        `The site blocked the screenshot${status >= 400 ? ` (HTTP ${status})` : ""}. Try again later, or add a screenshot yourself.`,
        "blocked",
      );
    }
    if (status >= 400) {
      const kind = [502, 503, 504].includes(status) ? "unavailable" : "http";
      throw new CaptureError(`The page answered with HTTP ${status}.`, kind);
    }
    await assertStayedPublic();
    await page
      .evaluate("document.fonts ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]) : 0")
      .catch(() => {});
    const first = await page.screenshot({ type: "png" });
    const { issues, motionLikely } = await qualityIssues(page, first);
    let full: Buffer | null = null;
    let video: Buffer | null = null;
    let videoDurationMs = 0;
    let keyframes: { data: Buffer; scrollY: number }[] = [];
    if (motion && videoDir) {
      const recorded = await recordScroll(page, path.join(videoDir, "motion.webm"));
      ({ video, keyframes } = recorded);
      videoDurationMs = recorded.durationMs;
    } else if (fullPage) {
      await loadWholePage(page, settle, expandContent).catch(() => {});
      // A broken full-page shot must not cost us the viewport shot.
      const stitched = await stitchedFullPage(page, settle).catch(() => null);
      full = stitched?.image ?? null;
      if (stitched?.repeated) issues.push("repeated_frames");
    }
    // a redirect made while walking the page counts too
    await assertStayedPublic();
    if (cancelled) throw new CaptureError("The capture was cancelled.", "cancelled");
    return {
      viewport: await sharp(first).webp({ quality: 85 }).toBuffer(),
      full,
      issues,
      finalUrl: page.url(),
      colorScheme,
      video,
      videoDurationMs,
      keyframes,
      motionLikely,
    };
  } catch (err) {
    await Promise.all(checks);
    if (privateUrl) throw new UnsafeUrlError("The page sent the browser to a private address, so it wasn't captured.");
    if (cancelled) throw new CaptureError("The capture was cancelled.", "cancelled");
    if (timedOut) {
      throw new CaptureError(`The page took longer than ${Math.round(timeoutMs / 1000)}s to capture.`, "timeout");
    }
    if (err instanceof CaptureError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (/Timeout \d+ms exceeded/.test(message)) {
      throw new CaptureError("The page took too long to load.", "timeout");
    }
    if (/net::ERR_/.test(message)) {
      throw new CaptureError(`The page couldn't be reached (${message.match(/net::ERR_[A-Z_]+/)?.[0]}).`, "network");
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    clearTimeout(deadline);
    await context.close().catch(() => {});
    if (videoDir) await fs.rm(videoDir, { recursive: true, force: true }).catch(() => {});
    scheduleIdleClose();
  }
}

const SHOT_ROLES: AssetRole[] = [
  "screenshot",
  "screenshot-full",
  "screenshot-original",
  "screenshot-full-original",
  "screenshot-variant",
  "screenshot-full-variant",
];

/** The server screenshots linked to a resource, by role. */
async function shotsByRole(resourceId: string) {
  const db = await getDb();
  const rows = await db
    .select({ assetId: resourceAssets.assetId, role: resourceAssets.role })
    .from(resourceAssets)
    .where(and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.role, SHOT_ROLES)));
  const byRole = new Map<string, string>();
  for (const r of rows) byRole.set(r.role, r.assetId);
  return { byRole, all: rows.map((r) => r.assetId) };
}

async function detachAssets(resourceId: string, assetIds: string[]) {
  if (!assetIds.length) return;
  const db = await getDb();
  await db
    .delete(resourceAssets)
    .where(and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.assetId, assetIds)));
}

async function currentResource(resourceId: string) {
  const db = await getDb();
  const [now] = await db
    .select({
      coverAssetId: resources.coverAssetId,
      captureQuality: resources.captureQuality,
      captureStatus: resources.captureStatus,
    })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  return now;
}

/**
 * Makes `newId` the Latest shot for `role`. The shot it replaces becomes the Original when there is none yet (the
 * first successful capture is kept); otherwise it is an in-between shot and is returned for deletion.
 */
async function promote(
  resourceId: string,
  byRole: Map<string, string>,
  role: "screenshot" | "screenshot-full",
  newId: string | null,
  { replaceWithoutNew = false } = {},
) {
  const prevId = byRole.get(role) ?? null;
  if (newId) await attachAsset(resourceId, newId, role);
  if (!prevId || prevId === newId || (!newId && !replaceWithoutNew)) return [];
  const originalRole = role === "screenshot" ? "screenshot-original" : "screenshot-full-original";
  const hasOriginal = byRole.has("screenshot-original") || byRole.has("screenshot-full-original");
  if (!hasOriginal) {
    await attachAsset(resourceId, prevId, originalRole);
    return [];
  }
  return [prevId];
}

type Shots = Awaited<ReturnType<typeof screenshotUrl>>;

interface AttemptContext {
  expandContent?: boolean;
  theme?: CaptureTheme;
  viewports?: ResponsiveViewport[];
  motion?: boolean;
  retries?: number;
  retryAt?: string;
  previousStatus?: string | null;
  [key: string]: unknown;
}

async function updateAttempt(id: string, set: Partial<typeof captureAttempts.$inferInsert>) {
  const db = await getDb();
  await db.update(captureAttempts).set(set).where(eq(captureAttempts.id, id));
}

/** Stores a finished capture: Latest, Original, the other colour scheme, cover and status. */
async function applyShots(
  resourceId: string,
  attemptId: string,
  context: AttemptContext,
  wantFull: boolean,
  shots: Shots,
  variant: Shots | null,
  sourceUrl: string,
) {
  const before = await currentResource(resourceId);
  if (!before) return; // deleted while capturing
  const { byRole, all } = await shotsByRole(resourceId);
  const quality: CaptureQuality = shots.issues.length ? "needs_review" : "looks_good";
  const hadGoodLatest =
    (byRole.has("screenshot") || byRole.has("screenshot-full")) && before.captureQuality !== "needs_review";

  // A suspicious shot never replaces a good one.
  if (quality === "needs_review" && hadGoodLatest) {
    const note = `The new capture looked wrong (${describeQuality(shots.issues)}), so the previous screenshot was kept.`;
    await updateAttempt(attemptId, {
      status: "completed",
      quality,
      qualityReasons: shots.issues,
      error: note,
      finishedAt: new Date(),
      context: { ...context, finalUrl: shots.finalUrl, colorScheme: shots.colorScheme, keptPrevious: true },
    });
    await setResourceFields(resourceId, { captureStatus: "done", captureError: note });
    return;
  }

  const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const stamp = new Date().toISOString().slice(0, 10);
  const metaFor = (s: Shots) => ({
    method: "server",
    colorScheme: s.colorScheme,
    viewport: VIEWPORT,
    capturedAt: new Date().toISOString(),
    finalUrl: s.finalUrl,
  });
  // A cover you chose, or the view the extension took of the page, already shows the first screen; a
  // server viewport shot would repeat it, so only the full page is added.
  const ownCover = !!before.coverAssetId && !all.includes(before.coverAssetId);
  const viewport = ownCover
    ? null
    : await saveAsset({ data: shots.viewport, fileName: `${host}-${stamp}.webp`, sourceUrl, meta: metaFor(shots) });
  const full =
    shots.full &&
    (await saveAsset({ data: shots.full, fileName: `${host}-${stamp}-full.webp`, sourceUrl, meta: metaFor(shots) }));

  const now = await currentResource(resourceId);
  if (!now) {
    // Deleted while saving.
    await deleteOrphanAssets([viewport?.id, full?.id].filter((id): id is string => !!id));
    return;
  }
  // Link the new shots before unlinking the old ones, so a failure never leaves the resource without any.
  const dropped = [
    ...(await promote(resourceId, byRole, "screenshot", viewport?.id ?? null, { replaceWithoutNew: ownCover })),
    // a capture whose full page failed keeps the previous full page
    ...(await promote(resourceId, byRole, "screenshot-full", full?.id ?? null)),
  ];
  if (variant) {
    for (const [role, data, suffix] of [
      ["screenshot-variant", variant.viewport, ""],
      ["screenshot-full-variant", variant.full, "-full"],
    ] as const) {
      if (!data || (role === "screenshot-variant" && ownCover)) continue;
      const asset = await saveAsset({
        data,
        fileName: `${host}-${stamp}-${variant.colorScheme}${suffix}.webp`,
        sourceUrl,
        meta: metaFor(variant),
      });
      // A site with one look gives identical bytes in both schemes: that is the same file, not a variant.
      if (asset.id === viewport?.id || asset.id === full?.id || asset.id === byRole.get("screenshot")) continue;
      const prev = byRole.get(role);
      await attachAsset(resourceId, asset.id, role);
      if (prev && prev !== asset.id) dropped.push(prev);
    }
  }
  await detachAssets(resourceId, dropped);

  // Keep a cover the user chose (or one clipped by the extension); a previous server shot gives way to the new one.
  const cover = now.coverAssetId;
  const coverWasServerShot = !!cover && (cover === byRole.get("screenshot") || dropped.includes(cover));
  const nextCover =
    cover && !coverWasServerShot ? cover : (viewport?.id ?? (cover && !dropped.includes(cover) ? cover : null));
  const partial = wantFull && !full;
  const notes = [
    partial ? "The full-page screenshot failed; the first screen was saved." : "",
    quality === "needs_review" ? `This capture may look wrong: ${describeQuality(shots.issues)}.` : "",
  ].filter(Boolean);
  await setResourceFields(resourceId, {
    coverAssetId: nextCover,
    captureStatus: partial ? "partial" : "done",
    captureError: notes.length ? notes.join(" ") : null,
    captureQuality: quality,
  });
  await updateAttempt(attemptId, {
    status: partial ? "partial" : "completed",
    quality,
    qualityReasons: shots.issues,
    error: notes.length ? notes.join(" ") : null,
    viewportAssetId: viewport?.id ?? null,
    fullAssetId: full?.id ?? null,
    finishedAt: new Date(),
    context: {
      ...context,
      finalUrl: shots.finalUrl,
      colorScheme: shots.colorScheme,
      viewport: VIEWPORT,
      ...(shots.motionLikely ? { motionLikely: true } : {}),
      ...(variant ? { variantColorScheme: variant.colorScheme } : {}),
    },
  });
  await deleteOrphanAssets(dropped);
}

/** How long to wait before retrying this failure, or null when it shouldn't be retried. */
function retryDelay(err: unknown, retries: number): number | null {
  if (!(err instanceof CaptureError) || retries >= MAX_RETRIES) return null;
  if (err.kind === "timeout" || err.kind === "network" || err.kind === "unavailable") {
    return captureTiming.retryDelaysMs[retries] ?? captureTiming.retryDelaysMs.at(-1)!;
  }
  if (err.kind === "rate_limited") {
    const wait = err.retryAfterMs ?? captureTiming.defaultRetryAfterMs;
    return wait <= captureTiming.maxRetryAfterMs ? wait : null;
  }
  return null;
}

async function finishCancelled(resourceId: string, attemptId: string) {
  await updateAttempt(attemptId, { status: "cancelled", finishedAt: new Date(), error: null });
  const now = await currentResource(resourceId);
  if (!now) return;
  const { all } = await shotsByRole(resourceId);
  await setResourceFields(resourceId, {
    captureStatus: all.length ? "done" : "cancelled",
    captureError: null,
  });
}

async function captureOne(job: Job) {
  const { resourceId, attemptId } = job;
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const [attempt] = await db.select().from(captureAttempts).where(eq(captureAttempts.id, attemptId)).limit(1);
  if (!row || !attempt || attempt.status === "cancelled") return;
  const context = attempt.context as AttemptContext;
  const abort = new AbortController();
  state.current = { job, abort };
  await updateAttempt(attemptId, { status: "capturing", startedAt: new Date() });

  try {
    if (!row.sourceUrl) throw new CaptureError("There is no URL to capture.", "other");
    // A source is a site you browse, not a page to study: its first screen is enough.
    const wantFull = row.type !== "source";
    const theme = context.theme ?? "dark";
    const primary = theme === "light" ? "light" : "dark";
    const shots = await screenshotUrl(row.sourceUrl, {
      fullPage: wantFull,
      expandContent: !!context.expandContent,
      colorScheme: primary,
      signal: abort.signal,
    });
    let variant: Shots | null = null;
    let variantError: string | undefined;
    if (theme === "both") {
      variant = await screenshotUrl(row.sourceUrl, {
        fullPage: wantFull,
        expandContent: !!context.expandContent,
        colorScheme: "light",
        signal: abort.signal,
      }).catch((err) => {
        if (err instanceof CaptureError && err.kind === "cancelled") throw err;
        variantError = err instanceof Error ? err.message : String(err);
        return null;
      });
    }
    // Extras first: the resource stays "pending" until everything asked for is done.
    const extras =
      context.viewports?.length || context.motion
        ? await captureExtras(resourceId, row.sourceUrl, context, wantFull, primary, abort.signal)
        : undefined;
    await applyShots(
      resourceId,
      attemptId,
      { ...context, ...(variantError ? { variantError } : {}), ...(extras ? { extras } : {}) },
      wantFull,
      shots,
      variant,
      row.sourceUrl,
    );
  } catch (err) {
    if (err instanceof CaptureError && err.kind === "cancelled") return finishCancelled(resourceId, attemptId);
    const message = err instanceof Error ? err.message : String(err);
    const retries = context.retries ?? 0;
    const delay = retryDelay(err, retries);
    if (delay !== null) {
      // Try again later; the resource stays pending, and a restart picks the attempt up again.
      await updateAttempt(attemptId, {
        status: "queued",
        error: message.slice(0, 500),
        context: { ...context, retries: retries + 1, retryAt: new Date(Date.now() + delay).toISOString() },
      });
      schedule(job, delay);
      return;
    }
    // Fall back to the page's Open Graph image so the card still has a picture. It stands in for the
    // screenshot (same role), so the next successful capture replaces it.
    const ogCover = row.sourceUrl ? await ogImageFallback(row.sourceUrl).catch(() => null) : null;
    const now = await currentResource(resourceId);
    if (ogCover && now && !now.coverAssetId) {
      await attachAsset(resourceId, ogCover.id, "screenshot");
      await setResourceFields(resourceId, { coverAssetId: ogCover.id });
    }
    await updateAttempt(attemptId, {
      status: "failed",
      quality: "unavailable",
      error: message.slice(0, 500),
      finishedAt: new Date(),
      context: { ...context, errorKind: err instanceof CaptureError ? err.kind : "other" },
    });
    if (now) await setResourceFields(resourceId, { captureStatus: "failed", captureError: message.slice(0, 500) });
  } finally {
    state.current = undefined;
  }
}

/**
 * The extras asked for with one capture: tablet and mobile screenshots (real sizes, not a shrunk desktop) and a
 * motion recording with keyframes. Each replaces the earlier one of its kind; a failure is noted but doesn't fail the
 * capture, whose main shots are already saved.
 */
async function captureExtras(
  resourceId: string,
  sourceUrl: string,
  context: AttemptContext,
  wantFull: boolean,
  colorScheme: "light" | "dark",
  signal: AbortSignal,
) {
  const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const stamp = new Date().toISOString().slice(0, 10);
  const db = await getDb();
  const extras: Record<string, string> = {};
  const replace = async (roles: AssetRole[], match: (meta: Record<string, unknown>) => boolean, keep: string[]) => {
    const rows = await db
      .select({ assetId: resourceAssets.assetId, meta: assets.meta })
      .from(resourceAssets)
      .innerJoin(assets, eq(assets.id, resourceAssets.assetId))
      .where(and(eq(resourceAssets.resourceId, resourceId), inArray(resourceAssets.role, roles)));
    const old = rows.filter((r) => match(r.meta ?? {}) && !keep.includes(r.assetId)).map((r) => r.assetId);
    await detachAssets(resourceId, old);
    await deleteOrphanAssets(old);
  };
  const meta = (extra: Record<string, unknown>) => ({
    method: "server",
    colorScheme,
    capturedAt: new Date().toISOString(),
    ...extra,
  });

  for (const name of context.viewports ?? []) {
    const size = RESPONSIVE_VIEWPORTS[name];
    try {
      const shots = await screenshotUrl(sourceUrl, {
        fullPage: wantFull,
        expandContent: !!context.expandContent,
        colorScheme,
        signal,
        viewport: { width: size.width, height: size.height },
        mobile: size.mobile,
      });
      const m = meta({
        viewportName: name,
        viewport: { width: size.width, height: size.height },
        finalUrl: shots.finalUrl,
      });
      const first = await saveAsset({
        data: shots.viewport,
        fileName: `${host}-${stamp}-${name}.webp`,
        sourceUrl,
        meta: m,
      });
      const full =
        shots.full &&
        (await saveAsset({ data: shots.full, fileName: `${host}-${stamp}-${name}-full.webp`, sourceUrl, meta: m }));
      await attachAsset(resourceId, first.id, "screenshot-responsive");
      if (full) await attachAsset(resourceId, full.id, "screenshot-full-responsive");
      await replace(["screenshot-responsive", "screenshot-full-responsive"], (x) => x.viewportName === name, [
        first.id,
        ...(full ? [full.id] : []),
      ]);
      extras[name] = shots.issues.length ? `needs review (${describeQuality(shots.issues)})` : "done";
    } catch (err) {
      if (err instanceof CaptureError && err.kind === "cancelled") throw err;
      extras[name] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (context.motion) {
    try {
      const shots = await screenshotUrl(sourceUrl, { colorScheme, signal, motion: true });
      const kept: string[] = [];
      if (shots.video) {
        const video = await saveAsset({
          data: shots.video,
          fileName: `${host}-${stamp}-motion.webm`,
          mimeType: "video/webm",
          sourceUrl,
          meta: meta({ viewport: DESKTOP, finalUrl: shots.finalUrl, durationMs: shots.videoDurationMs }),
        });
        await attachAsset(resourceId, video.id, "motion-video");
        kept.push(video.id);
      }
      for (const [i, frame] of shots.keyframes.entries()) {
        const asset = await saveAsset({
          data: frame.data,
          fileName: `${host}-${stamp}-keyframe-${i + 1}.webp`,
          sourceUrl,
          meta: meta({ keyframe: i + 1, scrollY: frame.scrollY, viewport: DESKTOP }),
        });
        await attachAsset(resourceId, asset.id, "motion-keyframe");
        kept.push(asset.id);
      }
      await replace(["motion-video", "motion-keyframe"], () => true, kept);
      extras.motion = shots.video ? `done (${shots.keyframes.length} keyframes)` : "no video was recorded";
    } catch (err) {
      if (err instanceof CaptureError && err.kind === "cancelled") throw err;
      extras.motion = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return extras;
}

/** Makes an uploaded image the resource's screenshot: it replaces the Latest shots and becomes the cover. */
export async function replaceScreenshot(resourceId: string, assetId: string) {
  const { byRole } = await shotsByRole(resourceId);
  const dropped = [
    ...(await promote(resourceId, byRole, "screenshot", assetId)),
    ...(await promote(resourceId, byRole, "screenshot-full", null, { replaceWithoutNew: true })),
  ].filter((id) => id !== assetId);
  await detachAssets(resourceId, dropped);
  await setResourceFields(resourceId, {
    coverAssetId: assetId,
    captureStatus: "done",
    captureError: null,
    captureQuality: null,
  });
  await deleteOrphanAssets(dropped);
}

async function ogImageFallback(url: string) {
  const meta = await fetchUrlMetadata(url);
  if (!meta.imageUrl) return null;
  const { response, body } = await safeFetch(meta.imageUrl, { accept: "image/*", maxBytes: 15 * 1024 * 1024 });
  if (!response.ok) return null;
  const webp = await sharp(body).webp({ quality: 85 }).toBuffer();
  return saveAsset({ data: webp, fileName: `${new URL(url).hostname}-og.webp`, sourceUrl: meta.imageUrl });
}

function schedule(job: Job, delay: number) {
  clearTimeout(state.timers.get(job.resourceId)?.timer);
  const timer = setTimeout(() => {
    state.timers.delete(job.resourceId);
    state.queue.push(job);
    void drain();
  }, delay);
  timer.unref?.();
  state.timers.set(job.resourceId, { job, timer });
}

async function drain() {
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length) {
      const job = state.queue.shift()!;
      await captureOne(job).catch(() => {});
    }
  } finally {
    state.running = false;
  }
}

/**
 * Queues a background screenshot and returns the attempt's id. Progress is visible through resources.capture_status
 * and the attempt. Options left out use the capture settings.
 */
export async function enqueueCapture(
  resourceId: string,
  options: CaptureOptions = {},
  { defer = false }: { defer?: boolean } = {},
) {
  const busy =
    state.current?.job.resourceId === resourceId
      ? state.current.job
      : state.queue.find((j) => j.resourceId === resourceId);
  if (busy) return busy.attemptId;
  const waiting = state.timers.get(resourceId);
  if (waiting) {
    // A new request replaces a retry that is waiting.
    clearTimeout(waiting.timer);
    state.timers.delete(resourceId);
    await updateAttempt(waiting.job.attemptId, {
      status: "cancelled",
      finishedAt: new Date(),
      error: "Replaced by a new capture request.",
    });
  }
  const settings = await getCaptureSettings();
  const db = await getDb();
  const [row] = await db
    .select({ captureStatus: resources.captureStatus })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  const [attempt] = await db
    .insert(captureAttempts)
    .values({
      resourceId,
      method: "server",
      status: defer ? "deferred" : "queued",
      context: {
        expandContent: options.expandContent ?? settings.expandContent,
        theme: options.theme ?? settings.theme,
        ...(options.viewports?.length ? { viewports: options.viewports } : {}),
        ...(options.motion ? { motion: true } : {}),
        previousStatus: row?.captureStatus ?? null,
      },
    })
    .returning({ id: captureAttempts.id });
  // "Capture later" is only a request: it waits, untouched, until you run it.
  if (defer) return attempt.id;
  await setResourceFields(resourceId, { captureStatus: "pending", captureError: null });
  state.queue.push({ resourceId, attemptId: attempt.id });
  void drain();
  return attempt.id;
}

/** Starts a "capture later" request now. Returns false when there is no such waiting request. */
export async function runDeferredCapture(attemptId: string) {
  const db = await getDb();
  const [a] = await db.select().from(captureAttempts).where(eq(captureAttempts.id, attemptId)).limit(1);
  if (!a || a.status !== "deferred") return false;
  if (state.current?.job.resourceId === a.resourceId || state.queue.some((j) => j.resourceId === a.resourceId)) {
    return false;
  }
  await updateAttempt(attemptId, { status: "queued", requestedAt: a.requestedAt });
  await setResourceFields(a.resourceId, { captureStatus: "pending", captureError: null });
  state.queue.push({ resourceId: a.resourceId, attemptId });
  void drain();
  return true;
}

/** Drops a "capture later" request. */
export async function cancelDeferredCapture(attemptId: string) {
  const db = await getDb();
  const [a] = await db.select().from(captureAttempts).where(eq(captureAttempts.id, attemptId)).limit(1);
  if (!a || a.status !== "deferred") return false;
  await updateAttempt(attemptId, { status: "cancelled", finishedAt: new Date() });
  return true;
}

/** Stops a queued, waiting or running capture. Shots already saved stay. Returns whether anything was stopped. */
export async function cancelCapture(resourceId: string) {
  if (state.current?.job.resourceId === resourceId) {
    state.current.abort.abort();
    return true;
  }
  const waiting = state.timers.get(resourceId);
  const index = state.queue.findIndex((j) => j.resourceId === resourceId);
  const job = waiting?.job ?? (index >= 0 ? state.queue[index] : undefined);
  if (waiting) {
    clearTimeout(waiting.timer);
    state.timers.delete(resourceId);
  }
  if (index >= 0) state.queue.splice(index, 1);
  if (job) {
    await finishCancelled(resourceId, job.attemptId);
    return true;
  }
  // Nothing in memory (for example after a restart): settle a stale pending status.
  const db = await getDb();
  const open = await db
    .select({ id: captureAttempts.id })
    .from(captureAttempts)
    .where(and(eq(captureAttempts.resourceId, resourceId), inArray(captureAttempts.status, ["queued", "capturing"])));
  for (const a of open) await finishCancelled(resourceId, a.id);
  return open.length > 0;
}

/** Captures interrupted by a server restart are still pending; queue their attempts again. */
export async function resumePendingCaptures() {
  const db = await getDb();
  const rows = await db.select({ id: resources.id }).from(resources).where(eq(resources.captureStatus, "pending"));
  for (const r of rows) {
    const [open] = await db
      .select({ id: captureAttempts.id })
      .from(captureAttempts)
      .where(and(eq(captureAttempts.resourceId, r.id), inArray(captureAttempts.status, ["queued", "capturing"])))
      .orderBy(desc(captureAttempts.requestedAt))
      .limit(1);
    if (!open) {
      await enqueueCapture(r.id);
      continue;
    }
    if (state.queue.some((j) => j.resourceId === r.id) || state.current?.job.resourceId === r.id) continue;
    await updateAttempt(open.id, { status: "queued" });
    state.queue.push({ resourceId: r.id, attemptId: open.id });
  }
  void drain();
}

function toAttemptDTO(row: typeof captureAttempts.$inferSelect): CaptureAttemptDTO {
  return {
    id: row.id,
    resourceId: row.resourceId,
    method: row.method as CaptureAttemptDTO["method"],
    status: row.status as CaptureAttemptDTO["status"],
    quality: row.quality as CaptureQuality | null,
    qualityReasons: row.qualityReasons ?? [],
    error: row.error,
    context: row.context ?? {},
    viewportAssetId: row.viewportAssetId,
    fullAssetId: row.fullAssetId,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** A resource's capture history, newest first. */
export async function listCaptureAttempts(resourceId: string, limit = 20) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(captureAttempts)
    .where(eq(captureAttempts.resourceId, resourceId))
    .orderBy(desc(captureAttempts.requestedAt))
    .limit(limit);
  return rows.map(toAttemptDTO);
}

/** Recent attempts across the library, newest first, with the resource's title (for the capture queue). */
export async function listRecentCaptureAttempts({
  limit = 50,
  statuses,
}: { limit?: number; statuses?: string[] } = {}) {
  const db = await getDb();
  const rows = await db
    .select({ attempt: captureAttempts, title: resources.title, type: resources.type, deletedAt: resources.deletedAt })
    .from(captureAttempts)
    .innerJoin(resources, eq(resources.id, captureAttempts.resourceId))
    .where(statuses?.length ? inArray(captureAttempts.status, statuses) : undefined)
    .orderBy(desc(captureAttempts.requestedAt))
    .limit(limit);
  return rows.filter((r) => !r.deletedAt).map((r) => ({ ...toAttemptDTO(r.attempt), title: r.title, type: r.type }));
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
