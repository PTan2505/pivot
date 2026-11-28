// Cloud builds (SPEC §21, added 2026-11-28) without GitHub or Cloudflare: R2 is s3rver, a local S3-compatible server,
// and GitHub's API is a stand-in whose workflow dispatch runs the real builder (builder-runner.ts) on the job's
// presigned link, the way the builder repo's workflow does. npm is stubbed with React from this checkout.
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import S3rver from "s3rver";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let tmp: string;
let s3: S3rver;
let comps: typeof import("../src/components");
let build: typeof import("../src/preview-build");
let cloud: typeof import("../src/cloud-build");
let runner: typeof import("../src/builder-runner");
let preview: typeof import("../src/component-preview");
let resources: typeof import("../src/resources");
let storage: typeof import("../src/storage");
let assets: typeof import("../src/assets");
let db: typeof import("../src/db/client");

const BUCKET = "pivot-builds-test";
const webRequire = createRequire(path.resolve(__dirname, "../../../apps/web/package.json"));
const pkgDir = (name: string) => path.dirname(webRequire.resolve(`${name}/package.json`));

/** npm, offline: React and React DOM from this checkout. */
async function fakeInstall(dir: string) {
  const nm = path.join(dir, "node_modules");
  await fsp.mkdir(nm, { recursive: true });
  for (const name of ["react", "react-dom", "scheduler"])
    await fsp.symlink(pkgDir(name), path.join(nm, name), "junction").catch(() => {});
}

// ---- a stand-in for GitHub's API -------------------------------------------------------------------------------

type Run = { id: number; status: string; conclusion: string | null; html_url: string; display_title: string };
const github = {
  dispatches: [] as { url: string; auth: string; body: { ref: string; inputs: { id: string; job: string } } }[],
  runs: [] as Run[],
  cancelled: [] as string[],
  /** What a dispatch does: run the builder (the default), die without a result, or refuse. */
  mode: "run" as "run" | "die" | "refuse",
  runners: [] as Promise<unknown>[],
};

async function fakeFetch(url: string, init: RequestInit = {}) {
  const auth = new Headers(init.headers).get("authorization") ?? "";
  const u = new URL(url);
  expect(u.origin).toBe("https://api.github.com");
  if (u.pathname.endsWith("/dispatches") && init.method === "POST") {
    if (github.mode === "refuse") return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    const body = JSON.parse(String(init.body));
    github.dispatches.push({ url, auth, body });
    const run: Run = {
      id: github.dispatches.length,
      status: "in_progress",
      conclusion: null,
      html_url: `https://github.com/owner/builds/actions/runs/${github.dispatches.length}`,
      display_title: `build ${body.inputs.id}`,
    };
    github.runs.push(run);
    if (github.mode === "run") {
      const workDir = await fsp.mkdtemp(path.join(tmp, "runner-"));
      github.runners.push(
        runner
          .runWireJob(body.inputs.job, { workDir, npmInstall: fakeInstall })
          .finally(() => Object.assign(run, { status: "completed", conclusion: "success" })),
      );
    } else Object.assign(run, { status: "completed", conclusion: "failure" });
    return new Response(null, { status: 204 });
  }
  if (/\/actions\/workflows\/build\.yml\/runs$/.test(u.pathname))
    return Response.json({ workflow_runs: github.runs.slice().reverse() });
  const cancel = /\/actions\/runs\/(\d+)\/cancel$/.exec(u.pathname);
  if (cancel) {
    github.cancelled.push(cancel[1]);
    return new Response(null, { status: 202 });
  }
  return new Response("{}", { status: 404 });
}

beforeAll(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pivot-cloud-"));
  s3 = new S3rver({
    port: 0,
    address: "127.0.0.1",
    silent: true,
    directory: path.join(tmp, "s3"),
    configureBuckets: [{ name: BUCKET, configs: [] }],
  });
  const { port } = (await s3.run()) as { port: number };
  Object.assign(process.env, {
    PIVOT_DATA_DIR: path.join(tmp, "data"),
    PIVOT_MIGRATIONS_DIR: path.resolve(__dirname, "../src/db/migrations"),
    R2_ACCESS_KEY_ID: "S3RVER",
    R2_SECRET_ACCESS_KEY: "S3RVER",
    R2_BUCKET: BUCKET,
    R2_ENDPOINT: `http://127.0.0.1:${port}`,
    PIVOT_BUILD_REPO: "owner/builds",
    PIVOT_BUILD_GITHUB_TOKEN: "test-token",
  });
  delete process.env.DATABASE_URL;
  comps = await import("../src/components");
  build = await import("../src/preview-build");
  cloud = await import("../src/cloud-build");
  runner = await import("../src/builder-runner");
  preview = await import("../src/component-preview");
  resources = await import("../src/resources");
  storage = await import("../src/storage");
  assets = await import("../src/assets");
  db = await import("../src/db/client");
  Object.assign(cloud.cloudDeps, { fetch: fakeFetch, pollMs: 15, runCheckMs: 40 });
});

afterEach(async () => {
  await Promise.allSettled(github.runners);
  github.mode = "run";
});

afterAll(async () => {
  await db.closeDb();
  await s3.close();
  for (const k of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "PIVOT_BUILD_REPO"])
    delete process.env[k];
  await fsp.rm(tmp, { recursive: true, force: true });
});

const CARD = `export function Card() {
  return <div className="rounded-xl p-6 text-3xl">Cloud card</div>;
}
`;

let nextId = 91000;
const save = async (code = CARD) =>
  (
    await comps.saveComponent({
      provider: "21st",
      providerId: ++nextId,
      name: "Card",
      pageUrl: `https://21st.dev/@tester/components/card-${nextId}`,
      author: { username: "tester" },
      licence: { spdx: "MIT", source: "component_page" },
      files: [{ path: "components/ui/card.tsx", role: "component", language: "tsx", code }],
      npmDependencies: [],
      status: "fetched",
    })
  ).resource;

const previewOf = async (id: string) =>
  ((await resources.getResource(id))!.meta.component as { preview?: Record<string, unknown> }).preview;

async function waitIdle(id: string) {
  for (let i = 0; i < 400 && build.isBuilding(id); i++) await new Promise((r) => setTimeout(r, 25));
  expect(build.isBuilding(id)).toBe(false);
}

const jobObjects = async (job: string) => {
  const store = storage.writeStore();
  return Promise.all(["job.json", "page.html", "result.json"].map((f) => store.size(`build-jobs/${job}/${f}`)));
};

describe("a cloud build", () => {
  it("builds a saved component on the builder: the job goes through R2, the page comes back, the job is removed", async () => {
    const r = await save();
    expect(await build.autoBuildComponent(r.id)).toBe("started");
    const building = (await previewOf(r.id))!;
    expect(building).toMatchObject({ status: "building", runner: "cloud", job: expect.any(String) });

    const d = github.dispatches.at(-1)!;
    expect(d.url).toBe("https://api.github.com/repos/owner/builds/actions/workflows/build.yml/dispatches");
    expect(d.auth).toBe("Bearer test-token");
    expect(d.body).toMatchObject({ ref: "main", inputs: { id: building.job } });
    // the run's inputs hold a link to the job, never the code
    expect(JSON.stringify(d.body)).not.toContain("Cloud card");
    expect(d.body.inputs.job).toMatch(/build-jobs%2F|build-jobs\//);

    await waitIdle(r.id);
    const p = (await previewOf(r.id))!;
    expect(p).toMatchObject({ status: "ready", runner: "cloud", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const asset = (await preview.findPreviewAsset(p.sha256 as string))!;
    const html = (await assets.readAssetBytes(asset))!.toString("utf8");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("Cloud card");
    expect(html).toContain(".text-3xl");
    expect(await jobObjects(building.job as string)).toEqual([null, null, null]);
  });

  it("keeps a failed build's error from the builder", async () => {
    const r = await save(
      `import { Missing } from "@/components/ui/missing";\nexport function Card() { return <Missing />; }\n`,
    );
    await (
      await build.startComponentPreviewBuild(r.id)
    ).done;
    expect(await previewOf(r.id)).toMatchObject({
      status: "failed",
      runner: "cloud",
      error: expect.stringMatching(/Could not resolve "@\/components\/ui\/missing"/),
    });
  });

  it("fails with the run's log when the run ends without a result", async () => {
    github.mode = "die";
    const r = await save(CARD.replace("p-6", "p-7"));
    const started = await build.startComponentPreviewBuild(r.id);
    await started.done;
    const p = (await previewOf(r.id))!;
    expect(p).toMatchObject({ status: "failed", runner: "cloud" });
    expect(p.error).toMatch(
      /stopped without a result \(failure\)\. Its log: https:\/\/github\.com\/owner\/builds\/actions\/runs\/\d+/,
    );
    expect(await jobObjects(p.job as string)).toEqual([null, null, null]);
  });

  it("records a refused start as failed, with how to set the builder up", async () => {
    github.mode = "refuse";
    const r = await save(CARD.replace("p-6", "p-8"));
    const started = await build.startComponentPreviewBuild(r.id);
    expect(started.status).toBe("failed");
    expect(await previewOf(r.id)).toMatchObject({
      status: "failed",
      runner: "cloud",
      error: expect.stringMatching(
        /no build\.yml workflow in owner\/builds.*pivot-studio builder setup --repo owner\/builds/,
      ),
    });
  });

  it("stops waiting after the time limit and cancels the run", async () => {
    github.mode = "die";
    const runs = github.runs.length;
    // a run that never finishes
    const original = cloud.cloudDeps.fetch;
    cloud.cloudDeps.fetch = async (url, init) => {
      const res = await fakeFetch(url, init);
      if (github.runs.length > runs) Object.assign(github.runs.at(-1)!, { status: "in_progress", conclusion: null });
      return res;
    };
    cloud.cloudDeps.timeoutMs = 200;
    try {
      const r = await save(CARD.replace("p-6", "p-9"));
      await (
        await build.startComponentPreviewBuild(r.id)
      ).done;
      expect((await previewOf(r.id))!.error).toMatch(/longer than 15 minutes, so PIVOT stopped it/);
      expect(github.cancelled).toContain(String(github.runs.at(-1)!.id));
    } finally {
      cloud.cloudDeps.fetch = original;
      cloud.cloudDeps.timeoutMs = 15 * 60_000;
    }
  });

  it("is picked up again after a restart, from the job in R2", async () => {
    const r = await save(CARD.replace("p-6", "p-10"));
    const c = (await resources.getResource(r.id))!.meta.component as { codeSha256: string };
    const job = "0f8e6a52-5c1e-4c5e-9d6a-5d0b3f1e2a11";
    // the builder finished while PIVOT was stopped: its page and result are in R2
    const store = storage.writeStore();
    await store.put(`build-jobs/${job}/page.html`, Buffer.from("<!doctype html><p>From before</p>"), "text/html");
    await store.put(
      `build-jobs/${job}/result.json`,
      Buffer.from(JSON.stringify({ ok: true, bytes: 30, ms: 1 })),
      "application/json",
    );
    const { getDb } = db;
    const { resources: table } = await import("../src/db/schema");
    const { eq } = await import("drizzle-orm");
    const row = (await (await getDb()).select().from(table).where(eq(table.id, r.id)))[0];
    const meta = row.meta as Record<string, Record<string, unknown>>;
    await (
      await getDb()
    )
      .update(table)
      .set({
        meta: {
          ...meta,
          component: {
            ...meta.component,
            preview: {
              status: "building",
              runner: "cloud",
              job,
              builtFrom: c.codeSha256,
              builtAt: new Date().toISOString(),
            },
          },
        },
      })
      .where(eq(table.id, r.id));

    await build.resumePreviewBuilds();
    await waitIdle(r.id);
    const p = (await previewOf(r.id))!;
    expect(p).toMatchObject({ status: "ready", runner: "cloud", builtFrom: c.codeSha256 });
    const asset = (await preview.findPreviewAsset(p.sha256 as string))!;
    expect((await assets.readAssetBytes(asset))!.toString()).toContain("From before");
    expect(await jobObjects(job)).toEqual([null, null, null]);
  });
});

describe("the cloud builder's settings", () => {
  it("are on with PIVOT_BUILD_REPO, and refuse a malformed repo", () => {
    expect(cloud.cloudBuildConfig({})).toBeNull();
    expect(cloud.cloudBuildConfig({ PIVOT_BUILD_REPO: "me/builds" })).toEqual({
      repo: "me/builds",
      workflow: "build.yml",
      ref: "main",
    });
    expect(() => cloud.cloudBuildConfig({ PIVOT_BUILD_REPO: "https://github.com/me/builds" })).toThrow(/owner\/name/);
  });

  it("the builder refuses a job version it doesn't read", async () => {
    const store = storage.writeStore() as InstanceType<typeof storage.R2Store>;
    await store.put("build-jobs/v9/job.json", Buffer.from(JSON.stringify({ version: 9 })), "application/json");
    const url = await store.presign("build-jobs/v9/job.json", "GET", { expiresIn: 60 });
    await expect(runner.runWireJob(url, { workDir: path.join(tmp, "v9") })).rejects.toThrow(/job version 1/);
    await store.delete("build-jobs/v9/job.json");
  });
});
