// Preview builds on GitHub Actions (SPEC §21, added 2026-11-28), in the owner's private builder repo that
// `pivot-studio builder setup` prepares. They are on when PIVOT_BUILD_REPO names that repo and PIVOT keeps its files in
// Cloudflare R2; otherwise previews build on this machine as before.
//
// One build: PIVOT writes build-jobs/<id>/job.json to R2 (the files, plus presigned links for the page and the result),
// dispatches the workflow with the job's id and a presigned link to it (code never goes into GitHub's run inputs), then
// waits for result.json in R2. The links expire after an hour; the job's objects are removed once PIVOT has the page.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  encodeJob,
  PAGE_TYPE,
  RESULT_TYPE,
  WIRE_VERSION,
  type BuildJob,
  type WireJob,
  type WireResult,
} from "./build-page";
import { PreviewError } from "./preview-error";
import { R2Store, writeStore } from "./storage";

export interface CloudConfig {
  /** The builder repo, owner/name. */
  repo: string;
  workflow: string;
  ref: string;
}

/** The workflow file `builder setup` writes into the builder repo. */
export const BUILDER_WORKFLOW = "build.yml";

const LINK_SECONDS = 3600;
const MAX_JOB_BYTES = 100 * 1024 * 1024;

/** Testing seams: GitHub's API, the token, and the clock. */
export const cloudDeps = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  token: () => githubToken(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  /** How often PIVOT looks for the result in R2, and asks GitHub how the run is doing. */
  pollMs: 4000,
  runCheckMs: 30_000,
  timeoutMs: 15 * 60_000,
};

/**
 * The cloud builder, when PIVOT_BUILD_REPO (owner/name) is set; null builds on this machine. A malformed value throws,
 * so a typo never quietly builds here instead.
 */
export function cloudBuildConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig | null {
  const repo = env.PIVOT_BUILD_REPO?.trim();
  if (!repo) return null;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo))
    throw new PreviewError(`PIVOT_BUILD_REPO is the builder repo as owner/name, not "${repo}".`);
  return { repo, workflow: BUILDER_WORKFLOW, ref: env.PIVOT_BUILD_REF?.trim() || "main" };
}

// ---- the GitHub token: PIVOT_BUILD_GITHUB_TOKEN, else the GitHub CLI's; kept in memory only, never stored or shown --

let cliToken: string | null = null;

async function githubToken(): Promise<string> {
  const own = process.env.PIVOT_BUILD_GITHUB_TOKEN?.trim();
  if (own) return own;
  cliToken ??= await ghAuthToken();
  return cliToken;
}

/** `gh auth token`: the token the GitHub CLI signed in with. */
export function ghAuthToken(): Promise<string> {
  const missing = new PreviewError(
    "Cloud builds need a GitHub token: sign in with the GitHub CLI (gh auth login), or set PIVOT_BUILD_GITHUB_TOKEN in .env.",
  );
  return new Promise((resolve, reject) => {
    let out = "";
    const child = spawn("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      reject(missing);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const token = out.trim();
      if (code === 0 && token) resolve(token);
      else reject(missing);
    });
  });
}

/** Calls GitHub's REST API with the token. A 401 forgets the CLI's token, so the next call reads it again. */
export async function github(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await cloudDeps.token();
  const res = await cloudDeps.fetch(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pivot-studio",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 401) cliToken = null;
  return res;
}

// ---- one build ------------------------------------------------------------------------------------------------------

const jobKeys = (id: string) => ({
  job: `build-jobs/${id}/job.json`,
  page: `build-jobs/${id}/page.html`,
  result: `build-jobs/${id}/result.json`,
});

function r2Store(): R2Store {
  const store = writeStore();
  if (!(store instanceof R2Store))
    throw new PreviewError(
      "Cloud builds pass the job through Cloudflare R2: add the R2 keys to .env, or remove PIVOT_BUILD_REPO to build on this machine.",
    );
  return store;
}

function dispatchError(status: number, cfg: CloudConfig, body: string) {
  if (status === 401)
    return "GitHub refused the token (401): sign in again with gh auth login, or replace PIVOT_BUILD_GITHUB_TOKEN.";
  if (status === 403)
    return `The GitHub token can't run workflows in ${cfg.repo} (403): it needs Actions write access (a classic token: the repo and workflow scopes).`;
  if (status === 404)
    return `GitHub found no ${cfg.workflow} workflow in ${cfg.repo}, or the token can't see that repo. Set the builder up with: pivot-studio builder setup --repo ${cfg.repo}`;
  const detail = (() => {
    try {
      return (JSON.parse(body) as { message?: string }).message;
    } catch {
      return undefined;
    }
  })();
  return `GitHub didn't start the cloud build (${status}${detail ? `: ${detail}` : ""}).`;
}

/** Puts the job in R2 and starts the workflow. Returns the job's id. */
export async function startCloudBuild(job: BuildJob, cfg: CloudConfig): Promise<string> {
  const store = r2Store();
  const id = randomUUID();
  const keys = jobKeys(id);
  const wire: WireJob = {
    version: WIRE_VERSION,
    id,
    job: encodeJob(job),
    upload: {
      page: await store.presign(keys.page, "PUT", { expiresIn: LINK_SECONDS, contentType: PAGE_TYPE }),
      result: await store.presign(keys.result, "PUT", { expiresIn: LINK_SECONDS, contentType: RESULT_TYPE }),
    },
  };
  const body = Buffer.from(JSON.stringify(wire), "utf8");
  if (body.byteLength > MAX_JOB_BYTES) throw new PreviewError("The build's files are over 100 MB together.");
  await store.put(keys.job, body, "application/json");
  try {
    const jobUrl = await store.presign(keys.job, "GET", { expiresIn: LINK_SECONDS });
    const res = await github(`/repos/${cfg.repo}/actions/workflows/${cfg.workflow}/dispatches`, {
      method: "POST",
      body: { ref: cfg.ref, inputs: { id, job: jobUrl } },
    });
    if (!res.ok) throw new PreviewError(dispatchError(res.status, cfg, await res.text().catch(() => "")));
  } catch (err) {
    await removeJob(id);
    throw err;
  }
  return id;
}

interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/** The workflow run for job `id` (its run-name is "build <id>"), once GitHub lists it. */
async function findRun(id: string, cfg: CloudConfig, since: Date): Promise<Run | null> {
  const created = new Date(since.getTime() - 60_000).toISOString();
  const res = await github(
    `/repos/${cfg.repo}/actions/workflows/${cfg.workflow}/runs?event=workflow_dispatch&per_page=50&created=${encodeURIComponent(`>=${created}`)}`,
  );
  if (!res.ok) return null;
  const { workflow_runs } = (await res.json()) as { workflow_runs?: (Run & { display_title?: string })[] };
  return workflow_runs?.find((r) => r.display_title === `build ${id}`) ?? null;
}

async function readResult(store: R2Store, id: string): Promise<WireResult | null> {
  const raw = await store.get(jobKeys(id).result);
  if (!raw) return null;
  try {
    return JSON.parse(raw.toString("utf8")) as WireResult;
  } catch {
    throw new PreviewError("The cloud build's result is unreadable.");
  }
}

/**
 * Waits for job `id` (started at `startedAt`) and returns its page, or throws its error. It looks in R2 every few
 * seconds and asks GitHub how the run is doing every half minute, so a run that died without a result fails with a link
 * to its log; after 15 minutes it cancels the run. The job's objects are removed either way.
 */
export async function awaitCloudBuild(id: string, cfg: CloudConfig, startedAt: Date): Promise<string> {
  const store = r2Store();
  const deadline = startedAt.getTime() + cloudDeps.timeoutMs;
  let run: Run | null = null;
  let lastCheck = 0;
  try {
    for (;;) {
      let result = await readResult(store, id);
      if (!result && Date.now() - lastCheck >= cloudDeps.runCheckMs) {
        lastCheck = Date.now();
        run = (await findRun(id, cfg, startedAt).catch(() => null)) ?? run;
        // the builder writes its result before the run ends: a finished run with none has failed
        if (run?.status === "completed") {
          result = await readResult(store, id);
          if (!result)
            throw new PreviewError(
              `The cloud build stopped without a result (${run.conclusion ?? "unknown"}). Its log: ${run.html_url}`,
            );
        }
      }
      if (result) {
        if (!result.ok) throw new PreviewError(result.error);
        const page = await store.get(jobKeys(id).page);
        if (!page) throw new PreviewError("The cloud build finished, but its page is missing from R2.");
        return page.toString("utf8");
      }
      if (Date.now() > deadline) {
        if (run && run.status !== "completed")
          await github(`/repos/${cfg.repo}/actions/runs/${run.id}/cancel`, { method: "POST" }).catch(() => null);
        throw new PreviewError(
          `The cloud build took longer than 15 minutes, so PIVOT stopped it.${run ? ` Its log: ${run.html_url}` : ""}`,
        );
      }
      await cloudDeps.sleep(cloudDeps.pollMs);
    }
  } finally {
    await removeJob(id);
  }
}

async function removeJob(id: string) {
  const store = writeStore();
  for (const key of Object.values(jobKeys(id))) await store.delete(key).catch(() => {});
}
