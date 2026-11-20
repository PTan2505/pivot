// The design skill's watcher wakes the agent when the user decides: an approval, or (docs/mockup-feedback-plan.md)
// feedback sent from PIVOT that no round answers yet, reported together once a burst of it settles.
import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../plugin/skills/design/scripts/wait-for-decision.mjs",
);
const SID = "11111111-2222-4333-8444-555555555555";
let server: http.Server | undefined;
afterEach(() => server?.close());

/** A fake PIVOT whose session is whatever `state()` returns on each read. */
async function pivot(state: () => object) {
  server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(state()));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const base = {
  id: SID,
  status: "exploring",
  decisions: [],
  mockups: [{ id: "m2", round: 1, n: 2, title: "Two" }],
  feedback: [] as object[],
};
const fb = (id: string, status = "open") => ({ id, round: 1, mockupId: "m2", text: `note ${id}`, pins: [{}], status });

const watch = async (url: string, extra: string[] = []) => {
  const { stdout } = await run(process.execPath, [script, SID, "--url", url, "--interval-s", "1", ...extra], {
    timeout: 20_000,
  });
  return JSON.parse(stdout.trim());
};

describe("wait-for-decision", () => {
  it("reports open feedback, ignoring what a round already answered", async () => {
    const url = await pivot(() => ({ ...base, feedback: [fb("old", "addressed"), fb("f1")] }));
    expect(await watch(url, ["--settle-s", "0"])).toEqual({
      sessionId: SID,
      event: "feedback",
      feedback: [{ id: "f1", round: 1, version: "2. Two", text: "note f1", pins: 1 }],
    });
  });

  it("waits for a burst of feedback to settle, then reports it all", async () => {
    let reads = 0;
    const url = await pivot(() => {
      reads++;
      return { ...base, feedback: reads < 2 ? [fb("f1")] : [fb("f1"), fb("f2")] };
    });
    const out = await watch(url, ["--settle-s", "2"]);
    expect(out.feedback.map((f: { id: string }) => f.id)).toEqual(["f1", "f2"]);
  });

  it("still reports an approval as before", async () => {
    const url = await pivot(() => ({
      ...base,
      status: "approved",
      decisions: [
        { kind: "approval", source: "owner", direction: "Version 2: Two (round 1)", details: "ok", createdAt: "t" },
      ],
    }));
    expect(await watch(url)).toMatchObject({ event: "approved", source: "owner", note: "ok" });
  });
});
