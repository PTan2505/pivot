// The cloud builder's side of a build (SPEC §21, added 2026-11-28): it runs on GitHub Actions in the owner's private
// builder repo, bundled into builder/build.mjs (scripts/build-builder.mjs). It reads one job from a presigned R2 link,
// builds it with the same code PIVOT runs on this machine (build-page.ts), and writes the page and then result.json to
// the two presigned links in the job. It holds no R2 keys and no GitHub token, and it never logs the job's code.
import fs from "node:fs/promises";
import {
  decodeJob,
  MAX_PAGE_BYTES,
  PAGE_TYPE,
  RESULT_TYPE,
  runBuildJob,
  WIRE_VERSION,
  type WireJob,
  type WireResult,
} from "./build-page";

const ERROR_CHARS = 1200;

export interface RunnerOptions {
  /** A fresh folder for the build; removed afterwards. */
  workDir: string;
  fetch?: typeof fetch;
  /** The npm install step (a test stands one in). */
  npmInstall?: (dir: string) => Promise<void>;
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
    result = { ok: true, bytes: page.byteLength, ms: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { ok: false, error: msg.slice(0, ERROR_CHARS), ms: Date.now() - started };
  } finally {
    await fs.rm(opts.workDir, { recursive: true, force: true }).catch(() => {});
  }
  await upload(f, wire.upload.result, Buffer.from(JSON.stringify(result)), RESULT_TYPE);
  return result;
}
