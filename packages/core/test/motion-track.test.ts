import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compactEasing, EASINGS, fitEasing, fmt, FRAME_MS, parseTransform, tidyValue } from "../src/motion-fit";
import type { MotionItem, MotionTrack } from "../src/motion-track";
import { buildMotionTrack, motionTable } from "../src/motion-track";

// The SSRF guard blocks loopback; let the browser reach the local fixture server.
vi.mock("../src/net-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/net-guard")>()),
  assertPublicUrl: async (input: string) => new URL(input),
}));

const { closeCaptureBrowser, playwrightStatus, screenshotUrl } = await import("../src/capture");
const chromium = await playwrightStatus();

const FIXTURES = path.join(__dirname, "fixtures/motion");
const GSAP = path.resolve(__dirname, "../../../apps/web/node_modules/gsap/dist");
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const name = new URL(req.url!, "http://x").pathname.slice(1);
    const file = name.endsWith(".js") ? path.join(GSAP, name) : path.join(FIXTURES, `${name}.html`);
    try {
      const body = await fs.readFile(file);
      res.setHeader("content-type", name.endsWith(".js") ? "text/javascript" : "text/html");
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await closeCaptureBrowser();
  await new Promise((resolve) => server.close(resolve));
});

describe("motion-fit", () => {
  it("names a curve from its samples and finds its duration", () => {
    // 450 ms ease-out sampled every frame, starting 10 ms after the last still frame
    const curve = EASINGS["ease-out"];
    const points: [number, number][] = [];
    for (let t = 0; t <= 600; t += FRAME_MS) points.push([t, curve((t - 10) / 450)]);
    const [best, second] = fitEasing(points, 0, FRAME_MS, 466);
    expect(best.easing).toBe("ease-out");
    expect(Math.abs(best.durationMs - 450)).toBeLessThan(FRAME_MS);
    expect(second.rms).toBeGreaterThan(best.rms * 3);
  });

  it("reads transforms and shortens easings", () => {
    expect(parseTransform("matrix(1, 0, 0, 1, 12, -30)")).toMatchObject({ translateX: 12, translateY: -30, scale: 1 });
    expect(parseTransform("none")).toMatchObject({ translateX: 0, translateY: 0, scale: 1, rotate: 0 });
    expect(parseTransform("matrix(0, 2, -2, 0, 0, 0)")).toMatchObject({ scale: 2, rotate: 90 });
    expect(compactEasing("cubic-bezier(0.23, 1, 0.32, 1)")).toBe("cubic-bezier(.23,1,.32,1)");
    expect(compactEasing("linear(0, 0.2 10%, 0.6 30%, 0.9 60%, 1)")).toBe("spring");
    expect(tidyValue("transform", "translate(0px, 8px) scale(1) rotate(0deg)")).toBe("translate(0px, 8px)");
    expect(tidyValue("transform", "translate(0px, 0px) scale(1) rotate(0deg)")).toBe("none");
    expect(tidyValue("transform", "translateY(5.13188px)")).toBe("translateY(5.13px)");
    expect([fmt(0.96), fmt(1), fmt(-12.4, "px"), fmt(0.5)]).toEqual(["0.96", "1", "-12px", "0.5"]);
  });

  it("folds an interrupted animation into the first and drops sub-pixel changes", () => {
    const spring = "linear(0, 0.3 10%, 0.7 30%, 0.95 60%, 1)";
    const anim = (el: number, t: number, from: string, duration: number) => ({
      f: Math.round(t / FRAME_MS),
      t,
      at: 1200,
      type: "Animation",
      timeline: "document",
      duration,
      delay: 0,
      easing: spring,
      iterations: 1,
      el,
      props: [{ property: "transform", values: [from, "none"] }],
    });
    const frame = (f: number, anims: ReturnType<typeof anim>[]) => ({
      f,
      t: f * FRAME_MS,
      at: 1200,
      ch: [],
      anims,
      changed: 0,
      visible: 10,
    });
    const track = buildMotionTrack({
      viewport: { width: 1440, height: 900 },
      method: "scroll",
      frames: [
        frame(0, [anim(1, 0, "translateY(8px)", 300), anim(2, 0, "translateY(-0.3px)", 300)]),
        frame(3, [anim(1, 100, "translateY(-2.4px)", 200)]),
        frame(20, [anim(1, 20 * FRAME_MS, "translateY(12px)", 400)]),
      ],
      elements: {
        1: { name: "div", selector: "div.card", parent: 0, fixedIn: 0 },
        2: { name: "div", selector: "div.other", parent: 0, fixedIn: 0 },
      },
      libraries: [],
      tweens: [],
      triggers: [],
      cap: 40,
    });
    expect(track.items.map((i) => i.changes[0].values)).toEqual([
      ["translateY(8px)", "none"],
      ["translateY(12px)", "none"],
    ]);
    expect(track.items[0]).toMatchObject({ easing: "spring", durationMs: 300 });
  });

  it("caps the table and counts the rest", () => {
    const item = (i: number) =>
      ({
        id: `M${i}`,
        source: "exact",
        via: "CSS transition",
        trigger: { kind: "load" },
        target: { name: "div", selector: "div.x", count: 1 },
        changes: [{ property: "opacity", values: ["0", "1"] }],
        durationMs: 300,
        easing: "ease-out",
        area: 1,
        key: "k",
      }) as MotionItem;
    const lines = motionTable({ items: [1, 2, 3].map(item), itemsTotal: 30 } as MotionTrack, 2);
    expect(lines).toEqual([
      "M1 load div (div.x) | opacity 0→1 | 300ms ease-out | exact (CSS transition)",
      "M2 load div (div.x) | opacity 0→1 | 300ms ease-out | exact (CSS transition)",
      "(+28 more items)",
    ]);
  });
});

let lastStrips: Awaited<ReturnType<typeof screenshotUrl>>["motionStrips"] = [];
const record = async (page: string) => {
  const shots = await screenshotUrl(`${baseUrl}${page}`, { motion: true });
  expect(shots.motionTrack).not.toBeNull();
  lastStrips = shots.motionStrips;
  return shots.motionTrack!;
};
const find = (track: MotionTrack, selector: string, source?: MotionItem["source"]) =>
  track.items.filter((i) => i.target.selector.includes(selector) && (!source || i.source === source));

describe.skipIf(!chromium.installed)("motion track of a recording", () => {
  it("measures CSS, script-driven and sticky motion within a frame", { timeout: 240_000 }, async () => {
    const track = await record("css");
    const one = (selector: string) => {
      const found = find(track, selector);
      expect(found, `${selector}: ${motionTable(track, 50).join("\n")}`).toHaveLength(1);
      return found[0];
    };
    // declared by the page: exact
    expect(one("div#hero")).toMatchObject({
      source: "exact",
      via: "CSS animation",
      trigger: { kind: "load" },
      durationMs: 600,
      easing: "cubic-bezier(.23,1,.32,1)",
    });
    expect(one("div#card")).toMatchObject({
      source: "exact",
      via: "CSS transition",
      trigger: { kind: "scroll" },
      durationMs: 300,
      easing: "ease-out",
    });
    expect(one("ul#list > li")).toMatchObject({
      source: "exact",
      target: { count: 6 },
      durationMs: 400,
      easing: "ease-out",
      staggerMs: 80,
    });
    // watched frame by frame: measured, within one frame
    const fade = one("div#fade");
    expect(fade).toMatchObject({
      source: "measured",
      easing: "easeOutCubic / power2.out",
      changes: [{ property: "opacity", values: ["0", "1"] }],
    });
    expect(Math.abs(fade.durationMs! - 500)).toBeLessThanOrEqual(FRAME_MS);
    const pin = one("div#pin");
    expect(pin.pinnedAt).toBe(100);
    expect(Math.abs(pin.trigger.from! - 2800)).toBeLessThanOrEqual(40);
    expect(Math.abs(pin.trigger.to! - 3900)).toBeLessThanOrEqual(40);
    const lerp = one("div#lerp");
    expect(lerp).toMatchObject({ source: "measured", scrubbed: true, parallax: { smoothed: true } });
    expect(Math.abs(lerp.parallax!.ratio + 0.3)).toBeLessThan(0.03);
    expect(track.items).toHaveLength(6);

    // filmstrips: cut from the video for the most legible items, each inside 960×320, flagged on its item
    expect(lastStrips.length).toBeGreaterThanOrEqual(3);
    for (const strip of lastStrips) {
      const meta = await sharp(strip.data).metadata();
      expect(meta.width).toBeLessThanOrEqual(960);
      expect(meta.height).toBeLessThanOrEqual(320);
      expect(strip.times[0]).toBe(0);
      expect(track.items.find((i) => i.key === strip.key)?.filmstrip).toBe(true);
    }
    const stripped = track.items.filter((i) => i.filmstrip).map((i) => i.target.selector);
    expect(stripped).toEqual(expect.arrayContaining(["div#card", "div#fade"]));
    expect(stripped).not.toContain("div#pin");

    // a second recording of the same page gives the same items
    const again = await record("css");
    expect(again.items.map((i) => i.key).sort()).toEqual(track.items.map((i) => i.key).sort());
  });

  it(
    "lists a canvas whose pixels move as seen, with a filmstrip, and not one that stays still",
    { timeout: 180_000 },
    async () => {
      const track = await record("canvas");
      expect(find(track, "canvas#spin")).toEqual([
        expect.objectContaining({
          source: "seen",
          via: "canvas",
          filmstrip: true,
          changes: [],
        }),
      ]);
      expect(find(track, "canvas#still")).toEqual([]);
      expect(lastStrips.map((s) => s.key)).toContain(find(track, "canvas#spin")[0].key);
      expect(motionTable(track).join("\n")).toContain(
        "pixels change while the page rests, no timing | seen (canvas), filmstrip",
      );
    },
  );

  it("reads GSAP tweens and ScrollTriggers from the page", { timeout: 180_000 }, async () => {
    const track = await record("gsap");
    expect(track.libraries).toEqual(expect.arrayContaining(["ScrollTrigger", expect.stringMatching(/^GSAP /)]));
    expect(find(track, "div#para")).toEqual([
      expect.objectContaining({
        source: "exact",
        via: "ScrollTrigger",
        scrubbed: true,
        trigger: { kind: "scroll", from: 500, to: 2200 },
        changes: [{ property: "y", values: ["-200"] }],
      }),
    ]);
    expect(find(track, "div#tween")).toEqual([
      expect.objectContaining({
        source: "exact",
        via: "GSAP tween",
        durationMs: 800,
        easing: "power2.out",
        changes: [{ property: "x", values: ["300"] }],
      }),
    ]);
  });

  it("follows a smooth-scrolled page's content", { timeout: 180_000 }, async () => {
    const track = await record("lenis");
    expect(track).toMatchObject({ method: "wheel", libraries: ["Lenis"], lenis: { lerp: 0.1 } });
    // the content moving against the scroll is the page itself, not an item
    expect(find(track, "div#content")).toEqual([]);
    expect(find(track, "div#late")).toEqual([
      expect.objectContaining({
        source: "exact",
        durationMs: 500,
        easing: "ease-in-out",
        trigger: expect.objectContaining({ kind: "scroll" }),
      }),
    ]);
  });
});
