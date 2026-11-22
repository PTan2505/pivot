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
/** Waits between automatic retries, and the idle browser's lifetime. Exported so tests can shorten them. */
export const captureTiming = {
  /** The shared browser closes once no capture has used it for this long. */
  idleCloseMs: 2 * 60 * 1000,
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
  /** Captures using the shared browser right now; it is only closed for being idle when this is 0. */
  inUse?: number;
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

/**
 * Arms the idle close once the last capture using the browser is done. A capture in progress (a recording can take
 * minutes, and runs right after the same job's screenshots) is never cut off by a timer an earlier one armed.
 */
function scheduleIdleClose() {
  clearTimeout(state.idleTimer);
  if (state.inUse) return;
  state.idleTimer = setTimeout(() => {
    if (!state.inUse) void closeCaptureBrowser();
  }, captureTiming.idleCloseMs);
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
/**
 * The scroll goes one screen at a time: it glides down one window height, comes to a stop and rests there, then goes
 * on. A glide takes the screen's height at this speed (px per second of video), plus the ease in and out.
 */
const MOTION_SPEED = 600;
const MOTION_EASE_S = 0.4;
/** The rest on each screen between glides. */
const MOTION_STEP_HOLD_S = 0.7;
/** The video rests this long on the first and the last screen. */
const MOTION_HOLD_S = 1;
/**
 * How far down a recording goes. Far taller than the full-page screenshot (whose height an image has to hold), so a
 * long landing page is recorded to its footer; it only stops a page that keeps growing as it scrolls (a feed).
 */
export const MOTION_MAX_HEIGHT = 50_000;
/**
 * Wall-clock limit for taking the frames; a slower page ends its video where the scroll got to. At about 50 ms a
 * frame, a page as tall as MOTION_MAX_HEIGHT needs roughly four minutes, with the waits for images on each screen.
 */
const MOTION_BUDGET_MS = 300_000;
/** The whole recording capture: opening the page, the frames (MOTION_BUDGET_MS) and finishing the video. */
const MOTION_TIMEOUT_MS = MOTION_BUDGET_MS + 90_000;
const MAX_KEYFRAMES = 8;
/**
 * VP9 quality (lower is better and larger). 35 keeps small text and thin lines as they were at 28 while making the
 * file about 40% smaller (measured on apple.com/airpods-pro: SSIM 0.9960 against 0.9975); 38 starts to wash out thin
 * coloured lines on dark backgrounds, and a smaller frame size softens text more than a higher CRF does.
 */
const MOTION_CRF = 35;

/** Scrolls to a position; returns where the page is and how far it can scroll (up to the recording's cap). */
const scrollAndMeasure = (y: number) => `(() => {
  scrollTo(0, ${y});
  const el = document.scrollingElement || document.documentElement;
  return { at: el.scrollTop, max: Math.max(0, Math.min(${MOTION_MAX_HEIGHT}, el.scrollHeight) - innerHeight) };
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
    /*turbopackIgnore: true*/ await ffmpegPath(),
    [
      ...["-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(MOTION_FPS), "-i", "pipe:0"],
      ...["-c:v", "libvpx-vp9", "-crf", String(MOTION_CRF), "-b:v", "0"],
      ...["-deadline", "good", "-cpu-used", "5", "-row-mt", "1"],
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
 * Pages that scroll through a JavaScript smooth-scroll library (Lenis, Locomotive, GSAP ScrollSmoother…), or that
 * lock the document and move their content with a transform. `scrollTo` doesn't move them, or is undone on the next
 * frame, so the recording drives them the way a visitor does: with the mouse wheel.
 */
const NEEDS_WHEEL = `(() => {
  const de = document.documentElement, body = document.body;
  if (window.lenis || window.__lenis || window.locomotiveScroll || window.LocomotiveScroll) return true;
  if (window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get()) return true;
  if (/(^|\\s)(lenis|has-scroll-smooth|has-scroll-init)(\\s|$)/.test(de.className)) return true;
  if (document.querySelector("[data-scroll-container], #smooth-wrapper, #smooth-content, [data-lenis-prevent]")) return true;
  const el = document.scrollingElement || de;
  const locked = [de, body].some((n) => n && getComputedStyle(n).overflowY === "hidden");
  if (!locked || el.scrollHeight > innerHeight + 10) return false;
  let tallest = 0;
  for (const n of body.querySelectorAll(":scope > *, :scope > * > *, :scope > * > * > *")) {
    tallest = Math.max(tallest, n.getBoundingClientRect().height);
  }
  return tallest > innerHeight * 1.5;
})()`;

/**
 * Where the visitor is in the page, for any way of scrolling: the document's own scroll position, or how far the
 * tallest piece of content has moved up (a transform-based smooth scroller moves that instead of scrolling).
 * The first call picks the element to follow.
 */
const SCROLL_PROGRESS = `(() => {
  const el = document.scrollingElement || document.documentElement;
  let t = window.__pivotTrack;
  if (!t || !t.isConnected) {
    t = document.body;
    for (const n of document.body.querySelectorAll(":scope > *, :scope > * > *, :scope > * > * > *")) {
      if (n.getBoundingClientRect().height > t.getBoundingClientRect().height) t = n;
    }
    window.__pivotTrack = t;
    window.__pivotTop = t.getBoundingClientRect().top + el.scrollTop;
  }
  const r = t.getBoundingClientRect();
  const moved = Math.max(el.scrollTop, window.__pivotTop - r.top);
  const end = Math.min(${MOTION_MAX_HEIGHT}, Math.max(el.scrollHeight, r.height + window.__pivotTop)) - innerHeight;
  return { at: Math.round(moved), max: Math.max(0, Math.round(end)) };
})()`;

/**
 * Advances every CSS animation, CSS transition and Web Animation on the page by one video frame. They run on the
 * browser's own clock, which the fake clock doesn't reach, so each is paused the first time it is seen and stepped
 * by hand from then on. Scroll-linked animations follow the scroll, not time, and are left alone.
 */
const stepAnimations = (ms: number) => `(() => {
  for (const a of document.getAnimations()) {
    if (a.timeline !== document.timeline) continue;
    if (!a.__pivotStepped) {
      if (a.playState !== "running") continue;
      a.pause();
      a.__pivotStepped = true;
    }
    a.currentTime = (Number(a.currentTime) || 0) + ${ms};
  }
})()`;

/**
 * Pauses the page's fake clock where it is now. The clock keeps running while the call travels to the page, and on a
 * busy page (WebGL, heavy scripts) it can pass the time asked for, which Playwright refuses ("Cannot fast-forward to
 * the past"). Each try reads the time again and asks further ahead; moving the clock a little forward before the
 * recording starts is harmless, as nothing has been filmed yet.
 */
export async function pauseClock(page: Pick<Page, "evaluate" | "clock">) {
  let failure: unknown;
  for (const ahead of PAUSE_AHEAD_MS) {
    const now = await page.evaluate<number>("Date.now()");
    try {
      return await page.clock.pauseAt(now + ahead);
    } catch (e) {
      if (!/fast-forward to the past/i.test(String(e))) throw e;
      failure = e;
    }
  }
  throw failure;
}

/** How far ahead of the page's time each try of `pauseClock` asks, in milliseconds. */
const PAUSE_AHEAD_MS = [1, 50, 250, 1_000, 4_000];

/** `promise`, or nothing once `ms` has passed in real time (the page's own timers are frozen while recording). */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((done) => setTimeout(() => done(undefined), ms)),
  ]);

/**
 * Records the page scrolling from top to bottom as a smooth 30 fps video, the way a screen recording of a visitor
 * reads it: a rest on the first screen, then one screen at a time (an eased glide down a window height, a short rest
 * on the new screen), and a rest at the bottom. Keyframes are the settled last frames of those rests.
 *
 * Time on the page is virtual. The page's clock (timers, requestAnimationFrame, performance.now, Date), installed
 * when the page opened, is paused here and moved forward exactly one frame (1/30 s) before each screenshot, and CSS
 * and Web Animations are stepped by the same amount. However long a screenshot or an image takes, every animation in
 * the video plays at its real speed, in step with the scroll, and scroll-scrubbed timelines (GSAP ScrollTrigger)
 * get the frames they need to catch up. Pages with a smooth-scroll library are scrolled with the mouse wheel and
 * followed by where their content actually is; the others jump to each frame's position. Keyframes come from the
 * same frames.
 */
async function recordScroll(page: Page, file: string) {
  const wheel = await page.evaluate<boolean>(NEEDS_WHEEL).catch(() => false);
  await page.evaluate(NO_SMOOTH_SCROLL).catch(() => {});
  if (!wheel) await page.evaluate(UNLOCK_INNER_SCROLL).catch(() => {});
  await page.evaluate(EAGER_IMAGES).catch(() => {});
  const vp = page.viewportSize() ?? DESKTOP;
  await within(page.evaluate(IMAGES_ON_SCREEN), 1_500);
  // The pointer stays off the page when the page can be scrolled without it: a resting pointer would light up rows
  // and pop tooltips as they pass under it. Wheel events need one, so it sits on the right edge, over the scrollbar.
  if (wheel) await page.mouse.move(vp.width - 3, Math.round(vp.height / 2));

  // From here on the page's time moves only when a frame is taken.
  await pauseClock(page);
  const frameMs = 1000 / MOTION_FPS;
  // whole milliseconds per step, carried over so 30 frames are exactly one second
  let clockMs = 0;
  let framesTicked = 0;
  const tick = async () => {
    const next = Math.round(++framesTicked * frameMs);
    await page.clock.runFor(next - clockMs);
    clockMs = next;
    await page.evaluate(stepAnimations(frameMs)).catch(() => {});
  };

  const cdp = await page.context().newCDPSession(page);
  const encoder = await startEncoder(file);
  const candidates: { jpeg: Buffer; scrollY: number }[] = [];
  let frames = 0;
  let y = 0;
  const shoot = async () => {
    await tick();
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90, optimizeForSpeed: true });
    const jpeg = Buffer.from(data, "base64");
    await encoder.write(jpeg);
    frames++;
    return jpeg;
  };
  const progress = () => page.evaluate<{ at: number; max: number }>(SCROLL_PROGRESS);
  try {
    const started = Date.now();
    let { max } = wheel ? await progress() : await page.evaluate<{ at: number; max: number }>(scrollAndMeasure(0));
    candidates.push({ jpeg: await shoot(), scrollY: 0 });
    for (let i = 1; i < MOTION_FPS * MOTION_HOLD_S; i++) await shoot();

    let stuck = 0;
    let at = 0;
    const inBudget = () => Date.now() - started < MOTION_BUDGET_MS;
    // one screen per glide, eased in and out; the bottom moves if the page grows on the way
    while (y < max - 0.5 && stuck < MOTION_FPS && inBudget()) {
      const from = y;
      const to = Math.min(max, from + vp.height);
      const n = Math.max(6, Math.round(MOTION_FPS * ((to - from) / MOTION_SPEED + MOTION_EASE_S)));
      for (let i = 1; i <= n && inBudget(); i++) {
        const target = from + ((to - from) * (1 - Math.cos((Math.PI * i) / n))) / 2;
        const step = target - y;
        y = target;
        let moved: { at: number; max: number };
        if (wheel) {
          // the library eases toward where the wheel sent it; the video follows the content, not the wheel
          await page.mouse.wheel(0, step);
          moved = await progress();
        } else {
          moved = await page.evaluate<{ at: number; max: number }>(scrollAndMeasure(Math.round(y)));
        }
        max = Math.max(moved.max, 0);
        // a page that won't follow the scroll any further is done: the document stops short of the position, or a
        // smooth scroller stays put while the wheel runs well ahead of it
        const behind = wheel ? y - moved.at > vp.height / 4 && moved.at <= at + 0.5 : moved.at < Math.round(y) - 2;
        stuck = behind ? stuck + 1 : 0;
        at = wheel ? moved.at : Math.round(y);
        if (stuck >= MOTION_FPS) break;
        await shoot();
      }
      if (stuck >= MOTION_FPS || y >= max - 0.5) break;
      // the rest on this screen: its images load, its entrance animations play, a smooth scroller catches up, and its
      // last frame, settled, is this screen's keyframe
      await within(page.evaluate(IMAGES_ON_SCREEN), 1_500);
      let settled = await shoot();
      for (let i = 1; i < MOTION_FPS * MOTION_STEP_HOLD_S; i++) settled = await shoot();
      if (wheel) at = (await progress()).at;
      candidates.push({ jpeg: settled, scrollY: at });
    }
    await within(page.evaluate(IMAGES_ON_SCREEN), 1_500);
    let last = await shoot();
    // the rest at the bottom also lets a smooth scroller glide to a stop
    for (let i = 1; i < MOTION_FPS * MOTION_HOLD_S; i++) last = await shoot();
    if (wheel) at = (await progress()).at;
    if (at - candidates[candidates.length - 1].scrollY >= vp.height * 0.25) {
      candidates.push({ jpeg: last, scrollY: at });
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
    timeoutMs: timeoutOption,
    expandContent = false,
    colorScheme = "dark",
    signal,
    viewport = DESKTOP,
    mobile = false,
    motion = false,
  }: {
    fullPage?: boolean;
    /** The whole capture's limit: 2 minutes, or longer for a recording (MOTION_TIMEOUT_MS). */
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
  const timeoutMs = timeoutOption ?? (motion ? MOTION_TIMEOUT_MS : CAPTURE_TIMEOUT_MS);
  if (signal?.aborted) throw new CaptureError("The capture was cancelled.", "cancelled");
  await assertPublicUrl(url);
  const start = await followRedirects(url);
  // an idle close armed by an earlier capture must not land while this one sets up
  clearTimeout(state.idleTimer);
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
  // held until this capture is done, so no idle close takes the browser away mid-capture (see scheduleIdleClose)
  state.inUse = (state.inUse ?? 0) + 1;
  try {
    const page = await context.newPage();
    // A recording runs the page on a fake clock it can pause and step (see recordScroll); until then it keeps real time.
    if (motion) await page.clock.install();
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
    state.inUse = Math.max(0, (state.inUse ?? 1) - 1);
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

/** At most this many elements in a render's element map: the deepest are dropped first. */
export const MAX_RENDER_ELEMENTS = 5000;

/**
 * One element of a rendered page, as the owner's Select tool and the agent see it: where it is on the render (in its
 * pixels, cut to the page), what it is, and a CSS selector that finds exactly it in the version's HTML.
 */
export interface RenderedElement {
  /** Its position in the map (document order). */
  i: number;
  /** The nearest ancestor in the map, or -1. */
  p: number;
  tag: string;
  id?: string;
  /** Up to 3 classes. */
  cls?: string[];
  /** Its own text (not its children's), up to 80 characters. */
  text?: string;
  /** aria-label, alt, placeholder or title, up to 80 characters. */
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sel: string;
}

type RawElement = Omit<RenderedElement, "i" | "p"> & { parent: number; depth: number };

/**
 * Runs in the rendered page (Playwright's evaluate works while the page's own scripts are off): every element inside
 * the cut page that is at least 4×4 and visible, in document order, as `RawElement`s. Nothing under an `<svg>` (the
 * svg itself stays). Called as `(MAP_PAGE)(maxWidth, maxHeight)`.
 */
const MAP_PAGE = `(maxW, maxH) => {
  const skip = new Set(["HEAD", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "TITLE", "BR", "WBR"]);
  const esc = (v) => CSS.escape(v);
  const uniqueId = (e) => {
    if (!e.id) return false;
    try { return document.querySelectorAll("#" + esc(e.id)).length === 1; } catch { return false; }
  };
  const sels = new Map();
  const selector = (e) => {
    const known = sels.get(e);
    if (known) return known;
    let sel;
    if (e === document.body) sel = "body";
    else if (uniqueId(e)) sel = "#" + esc(e.id);
    else {
      let step = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => /^-?[A-Za-z_][\\w-]*$/.test(c)).slice(0, 2);
      step += cls.map((c) => "." + esc(c)).join("");
      const parent = e.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === e.tagName);
        if (same.length > 1) step += ":nth-of-type(" + (same.indexOf(e) + 1) + ")";
      }
      sel = parent && parent !== document.documentElement ? selector(parent) + " > " + step : step;
    }
    sels.set(e, sel);
    return sel;
  };
  const short = (v) => {
    const t = (v || "").replace(/\\s+/g, " ").trim();
    return t ? t.slice(0, 80) : undefined;
  };
  const out = [];
  const walk = (e, parent, depth) => {
    for (const c of e.children) {
      if (skip.has(c.tagName)) continue;
      const r = c.getBoundingClientRect();
      const x = Math.max(0, r.left + scrollX);
      const y = Math.max(0, r.top + scrollY);
      const w = Math.min(maxW, r.right + scrollX) - x;
      const h = Math.min(maxH, r.bottom + scrollY) - y;
      const shown = w >= 4 && h >= 4 && getComputedStyle(c).visibility !== "hidden";
      let me = parent;
      if (shown) {
        me = out.length;
        const own = short([...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
        const label = short(c.getAttribute("aria-label") || c.getAttribute("alt") || c.getAttribute("placeholder") || c.getAttribute("title"));
        const cls = [...c.classList].slice(0, 3).map((k) => k.slice(0, 60));
        const el = { parent, depth, tag: c.tagName.toLowerCase() };
        if (c.id) el.id = c.id.slice(0, 80);
        if (cls.length) el.cls = cls;
        if (own) el.text = own;
        if (label) el.label = label;
        Object.assign(el, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), sel: selector(c) });
        out.push(el);
      }
      if (c.tagName.toLowerCase() !== "svg") walk(c, me, shown ? depth + 1 : depth);
    }
  };
  if (document.body) walk(document.body, -1, 0);
  return out;
}`;

/** Keeps the shallowest `limit` elements, in document order, with their parents renumbered. */
export function trimMap(raw: RawElement[], limit = MAX_RENDER_ELEMENTS): RenderedElement[] {
  let keep = raw.map((_, i) => i);
  if (raw.length > limit)
    keep = keep
      .sort((a, b) => raw[a].depth - raw[b].depth || a - b)
      .slice(0, limit)
      .sort((a, b) => a - b);
  const renumber = new Map(keep.map((old, i) => [old, i]));
  return keep.map((old, i) => {
    const { parent, depth: _depth, ...e } = raw[old];
    return { i, p: parent >= 0 ? (renumber.get(parent) ?? -1) : -1, ...e };
  });
}

/**
 * A full-page picture of PIVOT's own HTML (a stored mockup version), for the owner's feedback pins and the agent's
 * crops around them: the page at `width`, JavaScript off and no request leaving the page (inlined CSS, fonts and images
 * still show), cut at `maxHeight`. JPEG. With `elements`, also the page's element map (`RenderedElement`), measured on
 * the same layout and cut the same way.
 */
export async function renderHtml(
  html: string,
  {
    width,
    maxHeight = MAX_FULL_PAGE_HEIGHT,
    timeoutMs = 30_000,
    elements = false,
    viewportHeight = 900,
  }: { width: number; maxHeight?: number; timeoutMs?: number; elements?: boolean; viewportHeight?: number },
): Promise<{ data: Buffer; width: number; height: number; elements?: RenderedElement[] }> {
  clearTimeout(state.idleTimer);
  const b = await browser();
  const context = await b.newContext({
    // the height `100vh` resolves against: the owner's frame height when a note was made there
    viewport: { width, height: viewportHeight },
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  // nothing leaves the page: what isn't inlined in the HTML doesn't load
  await context.route("**/*", (route) => route.abort("blockedbyclient").catch(() => {}));
  const deadline = setTimeout(() => void context.close().catch(() => {}), timeoutMs);
  state.inUse = (state.inUse ?? 0) + 1;
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    const shot = await page.screenshot({ fullPage: true, type: "jpeg", quality: 85, timeout: timeoutMs });
    const { default: sharp } = await import("sharp");
    const meta = await sharp(shot, { limitInputPixels: false }).metadata();
    // pins are placed on exactly `width` pixels: a page that overflows sideways is cut to it, like the frame shows it
    const w = Math.min(meta.width ?? width, width);
    const height = Math.min(meta.height ?? 0, maxHeight);
    const data =
      w !== meta.width || height !== meta.height
        ? await sharp(shot, { limitInputPixels: false })
            .extract({ left: 0, top: 0, width: w, height })
            .jpeg({ quality: 85 })
            .toBuffer()
        : shot;
    const map = elements ? trimMap((await page.evaluate(`(${MAP_PAGE})(${w}, ${height})`)) as RawElement[]) : undefined;
    return { data, width: w, height, ...(map ? { elements: map } : {}) };
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
    state.inUse = Math.max(0, (state.inUse ?? 1) - 1);
    scheduleIdleClose();
  }
}

/** Runs in the page: the trimmed HTML of the element each selector finds alone, or null. See `elementsHtml`. */
const ELEMENTS_HTML = `(sels, max) => sels.map((sel) => {
  let found;
  try { found = document.querySelectorAll(sel); } catch { return null; }
  if (found.length !== 1) return null;
  const copy = found[0].cloneNode(true);
  for (const e of [copy, ...copy.querySelectorAll("*")]) {
    if (e.tagName.toLowerCase() === "svg") e.innerHTML = "…";
    for (const a of [...e.attributes]) {
      if (/^data:/i.test(a.value)) e.setAttribute(a.name, a.value.slice(0, (a.value.indexOf(",") + 1) || 30) + "…");
      else if (a.value.length > 120) e.setAttribute(a.name, a.value.slice(0, 120) + "…");
    }
  }
  const out = copy.outerHTML.replace(/\\s{2,}/g, " ");
  return out.length > max ? out.slice(0, max) + "…" : out;
})`;

/**
 * The HTML of elements of PIVOT's own HTML (a stored mockup version), found by selector at `width` with JavaScript off,
 * trimmed for an agent to read: long attribute values and `data:` URIs shortened, an `<svg>`'s inside left out, and
 * the whole cut at `maxChars`. Null for a selector that doesn't find exactly one element.
 */
export async function elementsHtml(
  html: string,
  selectors: string[],
  {
    width,
    maxChars = 2000,
    timeoutMs = 30_000,
    viewportHeight = 900,
  }: { width: number; maxChars?: number; timeoutMs?: number; viewportHeight?: number },
): Promise<(string | null)[]> {
  if (!selectors.length) return [];
  clearTimeout(state.idleTimer);
  const b = await browser();
  const context = await b.newContext({
    viewport: { width, height: 900 },
    javaScriptEnabled: false,
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient").catch(() => {}));
  const deadline = setTimeout(() => void context.close().catch(() => {}), timeoutMs);
  state.inUse = (state.inUse ?? 0) + 1;
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return (await page.evaluate(`(${ELEMENTS_HTML})(${JSON.stringify(selectors)}, ${maxChars})`)) as (string | null)[];
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
    state.inUse = Math.max(0, (state.inUse ?? 1) - 1);
    scheduleIdleClose();
  }
}
