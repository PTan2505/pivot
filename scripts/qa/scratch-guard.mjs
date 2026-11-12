// The check every script that writes to a PIVOT runs first: it must be a scratch PIVOT (scripts/start.mjs --scratch),
// never the real one. Fails closed, before any write:
// - PIVOT_E2E_SCRATCH=1 must be set on purpose;
// - the URL is this machine, and not port 4321 (the real PIVOT's);
// - the data folder isn't ~/.pivot (or ~/.stan-bag) and holds the marker --scratch writes (pivot-scratch.json);
// - the server at that URL really uses that folder: the API token it hands its own pages is the one in the folder
//   (skipped with checkToken: false, for checks that need a PIVOT with no token yet).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function assertScratch({ base, dataDir, env = process.env, fetchImpl = fetch, checkToken = true }) {
  const refuse = (why) => {
    throw new Error(`Not a scratch PIVOT, nothing was written: ${why}`);
  };
  if (env.PIVOT_E2E_SCRATCH !== "1") refuse("set PIVOT_E2E_SCRATCH=1 for a scratch PIVOT");
  let u;
  try {
    u = new URL(base);
  } catch {
    refuse(`bad URL ${base}`);
  }
  if (u.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
    refuse(`${base} isn't on this machine`);
  if ((u.port || "80") === "4321") refuse("4321 is the real PIVOT's port");
  if (!dataDir) refuse("set PIVOT_DATA_DIR to the scratch folder");
  const dir = path.resolve(dataDir.replace(/^~(?=$|\/)/, os.homedir()));
  for (const real of [path.join(os.homedir(), ".pivot"), path.join(os.homedir(), ".stan-bag")])
    if (dir === real || dir.startsWith(real + path.sep)) refuse(`${dir} is your real data folder`);
  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(dir, "pivot-scratch.json"), "utf8"));
  } catch {
    refuse(`${dir} has no pivot-scratch.json: start it with node scripts/start.mjs --scratch ${dir}`);
  }
  if (marker?.scratch !== true) refuse("the marker doesn't say scratch");
  if (!checkToken) return { dir };
  const res = await fetchImpl(`${base.replace(/\/+$/, "")}/api/settings/token`, {
    headers: { "sec-fetch-site": "same-origin" },
  }).catch(() => null);
  if (!res?.ok) refuse(`no PIVOT answering at ${base}`);
  const { token } = await res.json();
  let mine = "";
  try {
    mine = fs.readFileSync(path.join(dir, "api-token"), "utf8").trim();
  } catch {}
  if (!token || token !== mine) refuse(`the PIVOT at ${base} doesn't use ${dir}`);
  return { dir };
}
