// The cloud builder's side of a build (SPEC §21, added 2026-11-28): it runs on GitHub Actions in the owner's private
// builder repo, bundled into builder/build.mjs (scripts/build-builder.mjs). It reads one job from a presigned R2 link,
// builds it with the same code PIVOT runs on this machine (build-page.ts), pictures the page when the job asks
// (record-page.ts), and writes the page, the pictures and then result.json to the presigned links in the job. It holds no R2 keys and no GitHub token, and it never logs the job's code.
import fs from "node:fs/promises";
import path from "node:path";
import {
  decodeJob,
  MAX_PAGE_BYTES,
  PAGE_TYPE,
  RESULT_TYPE,
  runBuildJob,
  SHOT_TYPE,
  VIDEO_TYPE,
  WIRE_VERSION,
  type WireJob,
  type WireResult,
} from "./build-page";
import { MAX_SHOT_BYTES, MAX_VIDEO_BYTES, recordPage, type Recording } from "./record-page";

const ERROR_CHARS = 1200;

export interface RunnerOptions {
  /** A fresh folder for the build; removed afterwards. */
  workDir: string;
  fetch?: typeof fetch;
  /** The npm install step (a test stands one in). */
  npmInstall?: (dir: string) => Promise<void>;
  /** Pictures the built page (record-page.ts; a test stands one in). */
  record?: (htmlFile: string, workDir: string) => Promise<Recording>;
}

async function upload(f: typeof fetch, url: string, body: Buffer, type: string) {
  const res = await f(url, { method: "PUT", body: new Uint8Array(body), headers: { "Content-Type": type } });
  if (!res.ok) throw new Error(`Uploading to R2 failed (HTTP ${res.status}).`);
}

/**
 * Runs the job behind `jobUrl` and reports it. A build that fails is a result (ok: false, with its error), not a
 * crash; only a job it can't read, or a result it can't write, throws.
 */
export async function runWireJob(jobUrl: string, opts: RunnerOptions): Promise<WireResult> {
  const f = opts.fetch ?? fetch;
  const started = Date.now();
  const res = await f(jobUrl);
  if (!res.ok) throw new Error(`Reading the job failed (HTTP ${res.status}); its link may have expired.`);
  const wire = (await res.json()) as WireJob;
  if (wire?.version !== WIRE_VERSION || !wire.upload?.page || !wire.upload?.result)
    throw new Error(`This builder reads job version ${WIRE_VERSION}; update it with pivot-studio builder setup.`);
  let result: WireResult;
  try {
    const page = Buffer.from(await runBuildJob(opts.workDir, decodeJob(wire.job), opts.npmInstall), "utf8");
    if (page.byteLength > MAX_PAGE_BYTES) throw new Error("The built preview is over 5 MB; PIVOT doesn't keep it.");
    await upload(f, wire.upload.page, page, PAGE_TYPE);
    const done: Extract<WireResult, { ok: true }> = { ok: true, bytes: page.byteLength, ms: Date.now() - started };
    result = done;
    const { desktop, mobile, video } = wire.upload;
    if (desktop && mobile && video) {
      // pictures are extra: one that fails leaves the build as it is, with the reason
      try {
        const file = path.join(opts.workDir, "__pivot_page.html");
        await fs.writeFile(file, page);
        const record =
          opts.record ??
          ((html, dir) => recordPage(html, dir, { channel: process.env.PIVOT_RECORD_CHANNEL || undefined }));
        const r = await record(file, opts.workDir);
        if (r.desktop.byteLength > MAX_SHOT_BYTES || r.mobile.byteLength > MAX_SHOT_BYTES)
          throw new Error("A screenshot is over 8 MB.");
        if (r.video.byteLength > MAX_VIDEO_BYTES) throw new Error("The video is over 20 MB.");
        await upload(f, desktop, r.desktop, SHOT_TYPE);
        await upload(f, mobile, r.mobile, SHOT_TYPE);
        await upload(f, video, r.video, VIDEO_TYPE);
        done.recorded = { desktop: r.desktop.byteLength, mobile: r.mobile.byteLength, video: r.video.byteLength };
      } catch (err) {
        done.recordError = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_CHARS);
      }
      done.ms = Date.now() - started;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { ok: false, error: msg.slice(0, ERROR_CHARS), ms: Date.now() - started };
  } finally {
    await fs.rm(opts.workDir, { recursive: true, force: true }).catch(() => {});
  }
  await upload(f, wire.upload.result, Buffer.from(JSON.stringify(result)), RESULT_TYPE);
  return result;
}
