// `pivot-studio builder setup --repo <owner>/<name>` (SPEC §20 and §21, added 2026-11-28): prepares the owner's private
// GitHub repo that builds previews on GitHub Actions. It creates the repo (private) when it doesn't exist, refuses one
// that is public, writes the builder's files into it (the workflow, build.mjs and its two packages), and sets
// PIVOT_BUILD_REPO in the .env PIVOT reads. The GitHub token is PIVOT_BUILD_GITHUB_TOKEN, else the GitHub CLI's; it
// is used for these calls only, never written anywhere or printed.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The builder repo's files, as they go into it. */
export const BUILDER_FILES = [
  "README.md",
  "package.json",
  "package-lock.json",
  "build.mjs",
  ".github/workflows/build.yml",
];

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** The token: PIVOT_BUILD_GITHUB_TOKEN, else `gh auth token`. */
export function githubToken(env = process.env) {
  const own = env.PIVOT_BUILD_GITHUB_TOKEN?.trim();
  if (own) return own;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 10_000 });
  const token = gh.status === 0 ? gh.stdout.trim() : "";
  if (!token)
    throw new Error(
      "No GitHub token: sign in with the GitHub CLI (gh auth login), or set PIVOT_BUILD_GITHUB_TOKEN. Nothing was done.",
    );
  return token;
}

/** Git's id for a file's content, which GitHub's contents API reports as `sha`: an unchanged file isn't written again. */
export const blobSha = (data) =>
  createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
    .digest("hex");

/** Sets KEY=value in a .env file: replaces the key's line, or adds one. */
export function setEnvValue(file, key, value) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const at = lines.findIndex((l) => re.test(l));
  while (lines.length && lines.at(-1) === "") lines.pop();
  if (at >= 0) lines[at] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

/**
 * Sets the builder repo up. `builderDir` holds the files to write (dist/builder in the package, builder/ in a
 * checkout); `envFile` is the .env PIVOT reads. Returns 0 when done.
 */
export async function setupBuilder({
  repo,
  builderDir,
  envFile,
  env = process.env,
  fetch = globalThis.fetch,
  token = () => githubToken(env),
  log = console.log,
}) {
  if (!repo || !REPO_RE.test(repo))
    throw new Error("--repo is the builder repo as owner/name (it is created, private, if it doesn't exist).");
  for (const f of BUILDER_FILES)
    if (!fs.existsSync(path.join(builderDir, f)))
      throw new Error(`This install has no builder files (${f} is missing).`);
  const auth = token();
  const api = async (p, init = {}) => {
    const res = await fetch(`https://api.github.com${p}`, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${auth}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "pivot-studio",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401) throw new Error("GitHub refused the token (401). Nothing more was done.");
    return res;
  };

  const [owner, name] = repo.split("/");
  const found = await api(`/repos/${repo}`);
  if (found.ok) {
    const r = await found.json();
    if (!r.private)
      throw new Error(`${repo} is public. The builder repo must be private: its runs name the jobs they build.`);
    log(`› ${repo} exists and is private.`);
  } else if (found.status === 404) {
    const me = await (await api("/user")).json();
    const create = await api(owner === me.login ? "/user/repos" : `/orgs/${owner}/repos`, {
      method: "POST",
      body: {
        name,
        private: true,
        description: "PIVOT's cloud builder for live previews",
        has_issues: false,
        has_wiki: false,
      },
    });
    if (!create.ok)
      throw new Error(`GitHub didn't create ${repo} (${create.status}): ${(await create.text()).slice(0, 200)}`);
    log(`› Created ${repo} (private).`);
  } else throw new Error(`GitHub answered ${found.status} for ${repo}.`);

  let written = 0;
  for (const f of BUILDER_FILES) {
    const data = fs.readFileSync(path.join(builderDir, f));
    const current = await api(`/repos/${repo}/contents/${f}`);
    const sha = current.ok ? (await current.json()).sha : undefined;
    if (sha === blobSha(data)) continue;
    const put = await api(`/repos/${repo}/contents/${f}`, {
      method: "PUT",
      body: {
        message: `PIVOT builder: ${sha ? "update" : "add"} ${f}`,
        content: data.toString("base64"),
        ...(sha ? { sha } : {}),
      },
    });
    if (!put.ok) {
      const hint =
        f.startsWith(".github/") && [403, 404].includes(put.status)
          ? " (a workflow file needs the token's workflow scope: gh auth refresh -s workflow)"
          : "";
      throw new Error(`Writing ${f} to ${repo} failed (${put.status})${hint}.`);
    }
    written++;
  }
  log(
    written
      ? `› Wrote ${written} builder file${written === 1 ? "" : "s"} to ${repo}.`
      : "› The builder files are up to date.",
  );

  setEnvValue(envFile, "PIVOT_BUILD_REPO", repo);
  log(`› Set PIVOT_BUILD_REPO=${repo} in ${envFile}.`);
  const r2 = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const envText = fs.readFileSync(envFile, "utf8");
  if (!r2.every((k) => env[k] || new RegExp(`^\\s*${k}\\s*=\\s*\\S`, "m").test(envText)))
    log(
      "› Cloud builds pass each job through Cloudflare R2: add the R2_* keys to that .env too; until then each build fails and says so.",
    );
  log("› Restart PIVOT: new previews build on GitHub Actions.");
  return 0;
}
