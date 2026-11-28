// PIVOT's own pictures of a built preview (SPEC §21, added 2026-11-28): a screenshot at desktop and phone sizes and a
// short video, taken on the cloud builder right after the page is built (builder-runner.ts). The page is opened from
// disk with every request that isn't a local file refused, like the preview origin's no-network policy.
import fs from "node:fs/promises";
import path from "node:path";

export const RECORD_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

/** How long the video runs once the page is ready. */
export const VIDEO_MS = 6000;
/** At most this big: a larger file isn't kept. */
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

export interface Recording {
  desktop: Buffer;
  mobile: Buffer;
  video: Buffer;
}

// the built page posts this when it has rendered (build-page.ts): at the top level it lands on the page itself
const READY_LISTENER = `window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "21st-preview-ready") window.__pivotReady = true;
});`;

/**
 * Opens `htmlFile` in Chromium (`channel` "chrome" uses the installed Google Chrome) and returns the two screenshots
 * (device scale 2) and a WebM video at 1440×900: the page as it opens, scrolled slowly to the bottom when it is taller
 * than the window. `workDir` holds the video while it is written.
 */
export async function recordPage(
  htmlFile: string,
  workDir: string,
  opts: { channel?: string } = {},
): Promise<Recording> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(opts.channel ? { channel: opts.channel } : {});
  const url = `file://${path.resolve(htmlFile)}?theme=dark`;
  const open = async (
    size: { width: number; height: number },
    extra: { deviceScaleFactor?: number; recordVideo?: { dir: string; size: { width: number; height: number } } },
  ) => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark", ...extra });
    await ctx.route("**/*", (r) =>
      /^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort("blockedbyclient"),
    );
    await ctx.addInitScript(READY_LISTENER);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    // a page that never says it is ready (it threw, or it isn't one of PIVOT's builds) is pictured as it is
    await page.waitForFunction("window.__pivotReady === true", null, { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(800);
    return { ctx, page };
  };
  try {
    const shot = async (name: keyof typeof RECORD_SIZES) => {
      const { ctx, page } = await open(RECORD_SIZES[name], { deviceScaleFactor: 2 });
      const png = await page.screenshot({ type: "png" });
      await ctx.close();
      return png;
    };
    const desktop = await shot("desktop");
    const mobile = await shot("mobile");

    const videoDir = path.join(workDir, "video");
    await fs.mkdir(videoDir, { recursive: true });
    const { ctx, page } = await open(RECORD_SIZES.desktop, {
      recordVideo: { dir: videoDir, size: RECORD_SIZES.desktop },
    });
    const extra = Number(await page.evaluate("document.documentElement.scrollHeight - window.innerHeight"));
    if (extra > 40) {
      // a slow scroll to the bottom, then a moment there
      const steps = 40;
      for (let i = 1; i <= steps; i++) {
        await page.evaluate(`window.scrollTo(0, ${Math.round((extra * i) / steps)})`);
        await page.waitForTimeout((VIDEO_MS - 1500) / steps);
      }
      await page.waitForTimeout(1500);
    } else await page.waitForTimeout(VIDEO_MS);
    const video = page.video();
    await ctx.close();
    const webm = await fs.readFile(await video!.path());
    return { desktop, mobile, video: webm };
  } finally {
    await browser.close();
  }
}
