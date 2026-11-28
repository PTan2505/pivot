// Builds a component's or a saved design's preview (docs/component-store-plan.md, Phase 5; docs/my-designs-plan.md,
// Phase 3): the saved files bundled with esbuild and styled with Tailwind v4 into one self-contained HTML file
// (build-page.ts), stored as its `component-preview` and served only by the preview origin (preview-server.ts).
//
// Where it runs (SPEC §21, updated 2026-11-28): on GitHub Actions in the owner's private builder repo when cloud builds
// are set up (cloud-build.ts), else on this machine, one build at a time, in <data folder>/component-builds/<hash>/,
// removed afterwards. Either way the npm packages come from registry.npmjs.org only, with install scripts off.
//
// When it runs: a component builds by itself each time a save brings new code (autoBuildComponent, called by the save
// route), and again when the owner presses Build preview; a saved design builds when the owner asks, because its files
// are uploaded after it is saved. A rejected component never builds. A build PIVOT was waiting for when it stopped is
// picked up again when it starts (resumePreviewBuilds).
import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getAsset, readAssetBytes } from "./assets";
import { buildKey, runBuildJob, runNpmInstall, type BuildJob } from "./build-page";
import {
  awaitCloudBuild,
  cloudBuildConfig,
  startCloudBuild,
  type CloudBuildOutput,
  type CloudConfig,
} from "./cloud-build";
import { MAX_PREVIEW_BYTES, PreviewError, previewHolder, setComponentPreview } from "./component-preview";
import { componentOf } from "./components";
import { dataDir } from "./config";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { myDesignPreviewPlan } from "./preview-plan";
import type { ComponentMeta, MyDesignMeta, PreviewState } from "./types";

export { myDesignPreviewPlan };
export { bundleHtmlPage, bundlePage, candidatesOf, runNpmInstall, tailwindCss } from "./build-page";

const ERROR_CHARS = 1200;

/** Testing seams: the npm install, where a build folder goes, and the cloud builder's settings. */
export const buildDeps = {
  npmInstall: (dir: string) => runNpmInstall(dir),
  buildsDir: () => path.join(dataDir(), "component-builds"),
  cloud: (): CloudConfig | null => cloudBuildConfig(),
};

async function setPreviewState(resourceId: string, preview: PreviewState) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const holder = row && previewHolder(row);
  if (!row || !holder) return;
  const c = holder.value;
  // keep the last good preview showing while a new one builds or fails
  const keep =
    c.preview?.status === "ready" || c.preview?.sha256 ? { assetId: c.preview.assetId, sha256: c.preview.sha256 } : {};
  await db
    .update(resources)
    .set({ meta: { ...(row.meta ?? {}), [holder.key]: { ...c, preview: { ...keep, ...preview } } } })
    .where(eq(resources.id, resourceId));
}

// ---- running builds -------------------------------------------------------------------------------------------------

/** The latest build asked for, by resource. A newer one replaces an older one: the older one's page is dropped. */
const latest = new Map<string, number>();
let tickets = 0;
/** Builds on this machine run one after another. */
let localQueue: Promise<unknown> = Promise.resolve();

/** A build is waiting or running in this process: for this resource, or for any. */
export function isBuilding(resourceId?: string) {
  return resourceId ? latest.has(resourceId) : latest.size > 0;
}

class Superseded extends Error {}

/** Runs `job` on this machine once the builds before it are done. */
function buildHere(job: BuildJob, current: () => boolean): Promise<string> {
  const run = localQueue.then(async () => {
    if (!current()) throw new Superseded();
    const dir = path.join(buildDeps.buildsDir(), buildKey(job.files, [...job.deps, { name: job.kind }]));
    try {
      return await runBuildJob(dir, job, (d) => buildDeps.npmInstall(d));
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
  localQueue = run.catch(() => {});
  return run;
}

/** Waits for `work` and stores its page, or its error, unless a newer build of the resource replaced this one. */
async function finish(
  resourceId: string,
  from: { codeSha256: string; startedAt: string; runner: "local" | "cloud"; job?: string },
  work: () => Promise<CloudBuildOutput>,
  current: () => boolean,
) {
  try {
    const { html, recording, recordError } = await work();
    if (!current()) return;
    if (Buffer.byteLength(html) > MAX_PREVIEW_BYTES)
      throw new PreviewError("The built preview is over 5 MB; PIVOT doesn't keep it.");
    await setComponentPreview(resourceId, html, {
      builtFrom: from.codeSha256,
      runner: from.runner,
      recording,
      recordError,
    });
  } catch (err) {
    if (!current() || err instanceof Superseded) return;
    const msg = err instanceof Error ? err.message : String(err);
    await setPreviewState(resourceId, {
      status: "failed",
      builtFrom: from.codeSha256,
      builtAt: from.startedAt,
      runner: from.runner,
      error: msg.slice(0, ERROR_CHARS),
    }).catch((e) => console.error("[pivot] couldn't record a failed build:", e instanceof Error ? e.message : e));
  } finally {
    if (current()) latest.delete(resourceId);
  }
}

function track(resourceId: string) {
  const mine = ++tickets;
  latest.set(resourceId, mine);
  return () => latest.get(resourceId) === mine;
}

/**
 * Starts one build and returns at once; the page follows `preview.status` (building → ready or failed, with the
 * error). In the cloud when it is set up, else on this machine after the builds before it. A cloud build that can't
 * start (no token, no R2, GitHub refused) is recorded as failed, with the reason.
 */
async function runBuild(resourceId: string, codeSha256: string, job: BuildJob) {
  const current = track(resourceId);
  const startedAt = new Date().toISOString();
  let cloud: CloudConfig | null = null;
  let jobId: string | undefined;
  try {
    cloud = buildDeps.cloud();
    // a component's cloud build also takes PIVOT's screenshots and video of it; a saved design has the owner's own
    if (cloud) jobId = await startCloudBuild(job, cloud, { record: job.kind === "component" });
  } catch (err) {
    // only the cloud's settings or start can fail here
    const done = finish(resourceId, { codeSha256, startedAt, runner: "cloud" }, () => Promise.reject(err), current);
    await done;
    return { status: "failed" as const, done };
  }
  const runner = cloud ? ("cloud" as const) : ("local" as const);
  await setPreviewState(resourceId, {
    status: "building",
    builtFrom: codeSha256,
    builtAt: startedAt,
    runner,
    ...(jobId ? { job: jobId } : {}),
  });
  const work = cloud
    ? () => awaitCloudBuild(jobId!, cloud, new Date(startedAt))
    : async () => ({ html: await buildHere(job, current) });
  const done = finish(resourceId, { codeSha256, startedAt, runner, job: jobId }, work, current);
  return { status: "building" as const, done };
}

// ---- components -----------------------------------------------------------------------------------------------------

const rejectedNow = (c: ComponentMeta) => c.review?.verdict === "rejected" && c.review.codeSha256 === c.codeSha256;

async function loadComponent(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const c = row && !row.deletedAt ? componentOf(row as { meta: Record<string, unknown> }) : null;
  if (!row || row.type !== "component" || !c) throw new PreviewError("No such component.");
  return c;
}

/**
 * Starts building a component's preview (Build preview on its page) and returns at once; the page follows
 * `meta.component.preview.status`. A rejected component is never built.
 */
export async function startComponentPreviewBuild(resourceId: string) {
  const c = await loadComponent(resourceId);
  if (rejectedNow(c)) throw new PreviewError("This component was rejected in its review; PIVOT doesn't build it.");
  return runBuild(resourceId, c.codeSha256, { kind: "component", files: c.files, deps: c.npmDependencies });
}

/**
 * Builds a component's preview after a save, when the save brought code that isn't built yet (SPEC §1 #38, updated
 * 2026-11-28): not when this code already has a build (ready, building or failed: Rebuild preview tries again), and
 * never for a rejected component.
 */
export async function autoBuildComponent(resourceId: string): Promise<"started" | "skipped"> {
  const c = await loadComponent(resourceId);
  if (rejectedNow(c)) return "skipped";
  const p = c.preview;
  if (p && p.status !== "none" && p.builtFrom === c.codeSha256) return "skipped";
  await startComponentPreviewBuild(resourceId);
  return "started";
}

// ---- saved designs --------------------------------------------------------------------------------------------------

/**
 * Starts building a saved design's preview and returns at once; the page follows `meta.myDesign.preview.status`. An
 * HTML demo installs npm packages only when the design lists some (exact versions); a React design always does.
 */
export async function startMyDesignPreviewBuild(resourceId: string) {
  const db = await getDb();
  const [row] = await db.select().from(resources).where(eq(resources.id, resourceId)).limit(1);
  const d = row && !row.deletedAt && row.type === "my_design" ? (row.meta?.myDesign as MyDesignMeta | undefined) : null;
  if (!row || !d) throw new PreviewError("No such design.");
  const plan = myDesignPreviewPlan(d);
  if (plan.kind === "none") throw new PreviewError(plan.reason);
  const binary: { path: string; data: Buffer }[] = [];
  for (const a of d.assets) {
    const asset = await getAsset(a.assetId);
    const data = asset && (await readAssetBytes(asset));
    if (data) binary.push({ path: a.path, data });
  }
  return runBuild(resourceId, d.codeSha256, {
    kind: plan.kind,
    files: d.files,
    deps: d.dependencies,
    binary,
    ...(plan.kind === "html" ? { html: plan.file } : {}),
  });
}

// ---- after a restart ------------------------------------------------------------------------------------------------

/**
 * Picks up the builds that were running when PIVOT stopped: a cloud build is waited for again (its job is still in R2
 * and on GitHub); a build on this machine starts again. Run once, at startup.
 */
export async function resumePreviewBuilds() {
  const db = await getDb();
  const rows = await db
    .select()
    .from(resources)
    .where(and(inArray(resources.type, ["component", "my_design"]), isNull(resources.deletedAt)));
  for (const row of rows) {
    const holder = previewHolder(row);
    const p = holder?.value.preview;
    if (!holder || p?.status !== "building" || isBuilding(row.id)) continue;
    const codeSha256 = p.builtFrom ?? holder.value.codeSha256;
    const startedAt = p.builtAt ?? new Date().toISOString();
    try {
      const cloud = p.runner === "cloud" && p.job ? buildDeps.cloud() : null;
      if (cloud && p.job) {
        const job = p.job;
        void finish(
          row.id,
          { codeSha256, startedAt, runner: "cloud", job },
          () => awaitCloudBuild(job, cloud, new Date(startedAt)),
          track(row.id),
        );
      } else if (row.type === "component") await startComponentPreviewBuild(row.id);
      else await startMyDesignPreviewBuild(row.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await setPreviewState(row.id, {
        status: "failed",
        builtFrom: codeSha256,
        builtAt: startedAt,
        runner: p.runner,
        error: `PIVOT stopped while this was building, and couldn't start it again: ${msg}`.slice(0, ERROR_CHARS),
      });
    }
  }
}
