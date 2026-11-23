import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { FRAME_MS } from "./motion-fit";
import {
  type AnalysedMotion,
  type FilmstripPlan,
  markFilmstrips,
  MAX_FILMSTRIPS,
  type MotionTrack,
  type SeenPlan,
  withSeenItems,
} from "./motion-track";

/**
 * Pictures of a recording's motion, cut from its video right after it is recorded (capture.ts): filmstrips of the
 * most legible items, and the comparison that finds canvases and videos whose pixels move. The frames come from the
 * webm the recording just wrote, since keeping thousands of screenshots in memory while scrolling is not an option;
 * one short seek per strip is enough.
 */

/** The whole strip fits in this box (about 410 tokens when Claude looks at it). */
const STRIP_MAX = { width: 960, height: 320 };
const GAP = 6;
const LABEL = 16;
/** Mean difference (0–255, greyscale) between two frames of a canvas or video above which its pixels moved. */
const MOVED = 1.5;

export interface Filmstrip {
  key: string;
  data: Buffer;
  width: number;
  height: number;
  frames: number[];
  /** Milliseconds from the strip's first frame, per tile. */
  times: number[];
  box: FilmstripPlan["box"];
}

/** Video frames `from`…`from + count - 1` as PNG buffers (missing ones at the end of the video are left out). */
async function framesFrom(ffmpeg: string, video: string, dir: string, from: number, count: number) {
  const prefix = path.join(dir, `f${from}_`);
  // the frame's timestamp, less a few ms so the frame itself is kept and the one before it isn't
  const seek = Math.max(0, (from * FRAME_MS - 10) / 1000).toFixed(3);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      [
        "-loglevel",
        "error",
        "-ss",
        seek,
        "-i",
        video,
        "-frames:v",
        String(count),
        "-fps_mode",
        "passthrough",
        `${prefix}%03d.png`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    p.stderr.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-500)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}): ${err.trim()}`))));
  });
  const out = new Map<number, Buffer>();
  for (let i = 0; i < count; i++) {
    const data = await fs.readFile(`${prefix}${String(i + 1).padStart(3, "0")}.png`).catch(() => null);
    if (data) out.set(from + i, data);
  }
  return out;
}

/** Frames needed, read in as few seeks as possible: consecutive runs of up to 60 frames per seek. */
async function readFrames(ffmpeg: string, video: string, dir: string, wanted: number[]) {
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const frames = new Map<number, Buffer>();
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] - start < 60) j++;
    const got = await framesFrom(ffmpeg, video, dir, start, sorted[j] - start + 1);
    for (const f of sorted.slice(i, j + 1)) if (got.has(f)) frames.set(f, got.get(f)!);
    i = j + 1;
  }
  return frames;
}

async function greyCrop(png: Buffer, box: FilmstripPlan["box"]) {
  return sharp(png)
    .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
    .resize({ width: Math.min(240, box.width) })
    .greyscale()
    .raw()
    .toBuffer();
}

/** Whether the pixels in `box` changed between consecutive frames of any window. */
async function pixelsMoved(frames: Map<number, Buffer>, plan: SeenPlan) {
  const moved: number[][] = [];
  for (const w of plan.windows) {
    const crops = await Promise.all(w.map((f) => (frames.has(f) ? greyCrop(frames.get(f)!, plan.box) : null)));
    let diff = 0;
    for (let k = 1; k < crops.length; k++) {
      const a = crops[k - 1];
      const b = crops[k];
      if (!a || !b || a.length !== b.length) continue;
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      diff = Math.max(diff, sum / a.length);
    }
    if (diff > MOVED) moved.push(w);
  }
  return moved;
}

/** Tiles in one row or two, whichever shows them larger inside `STRIP_MAX`. */
function layout(n: number, w: number, h: number) {
  let best = { rows: 1, cols: n, scale: 0 };
  for (const rows of [1, 2]) {
    const cols = Math.ceil(n / rows);
    const scale = Math.min(
      1,
      (STRIP_MAX.width - (cols + 1) * GAP) / (cols * w),
      (STRIP_MAX.height - GAP - rows * (LABEL + GAP)) / (rows * h),
    );
    if (scale > best.scale) best = { rows, cols, scale };
  }
  return best;
}

const escapeXml = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function compose(plan: FilmstripPlan, frames: Map<number, Buffer>): Promise<Filmstrip | null> {
  const used = plan.frames.filter((f) => frames.has(f));
  if (used.length < 2) return null;
  const { rows, cols, scale } = layout(used.length, plan.box.width, plan.box.height);
  const tw = Math.max(1, Math.floor(plan.box.width * scale));
  const th = Math.max(1, Math.floor(plan.box.height * scale));
  const width = cols * tw + (cols + 1) * GAP;
  const height = rows * (th + LABEL + GAP) + GAP;
  const times = used.map((f) => Math.round((f - used[0]) * FRAME_MS));
  const tiles = await Promise.all(
    used.map((f) =>
      sharp(frames.get(f)!)
        .extract({ left: plan.box.x, top: plan.box.y, width: plan.box.width, height: plan.box.height })
        .resize(tw, th)
        .png()
        .toBuffer(),
    ),
  );
  const at = (i: number) => ({
    left: GAP + (i % cols) * (tw + GAP),
    top: GAP + Math.floor(i / cols) * (th + LABEL + GAP),
  });
  const labels = used
    .map((_, i) => {
      const { left, top } = at(i);
      return `<text x="${left}" y="${top + th + 12}" font-family="sans-serif" font-size="11" fill="#d4d4d4">${escapeXml(`+${times[i]} ms`)}</text>`;
    })
    .join("");
  const data = await sharp({ create: { width, height, channels: 3, background: "#141414" } })
    .composite([
      ...tiles.map((input, i) => ({ input, ...at(i) })),
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels}</svg>`,
        ),
        left: 0,
        top: 0,
      },
    ])
    .webp({ quality: 80 })
    .toBuffer();
  return { key: plan.key, data, width, height, frames: used, times, box: plan.box };
}

/**
 * Finishes a recording's motion from its video: compares the canvases and videos (adding `seen` items where their
 * pixels moved), then cuts the filmstrips, `seen` items first since pictures are all they have. A failure leaves the
 * track as the analysis built it, without pictures.
 */
export async function finishMotion(ffmpeg: string, video: string, analysis: AnalysedMotion) {
  const dir = await fs.mkdtemp(path.join(path.dirname(video), "strips-"));
  try {
    const seenFrames = await readFrames(
      ffmpeg,
      video,
      dir,
      analysis.seen.flatMap((s) => s.windows.flat()),
    );
    const seen = await Promise.all(
      analysis.seen.map(async (plan) => ({ plan, moved: await pixelsMoved(seenFrames, plan) })),
    );
    const { track, strips: seenStrips } = withSeenItems(analysis.track, seen);
    const plans: FilmstripPlan[] = [];
    for (const p of [...seenStrips, ...analysis.strips])
      if (plans.length < MAX_FILMSTRIPS && !plans.some((x) => x.key === p.key)) plans.push(p);
    const frames = await readFrames(
      ffmpeg,
      video,
      dir,
      plans.flatMap((p) => p.frames),
    );
    const strips = (await Promise.all(plans.map((p) => compose(p, frames).catch(() => null)))).filter(
      (s): s is Filmstrip => !!s,
    );
    return {
      track: markFilmstrips(
        track,
        strips.map((s) => s.key),
      ),
      strips,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export type { MotionTrack };
