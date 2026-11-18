import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearPreviewPick, openPreview, previewScript, previewState } from "../src/preview-launcher";

const SID = "11111111-2222-4333-8444-555555555555";
const SID2 = "11111111-2222-4333-8444-666666666666";

/** A stand-in for preview.mjs: prints the events the real one prints, then waits or exits as told. */
function fakeScript(body: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-launch-"));
  const p = path.join(dir, "preview.mjs");
  fs.writeFileSync(p, body);
  return p;
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("opening the interactive preview from PIVOT", () => {
  it("passes the session, round and this PIVOT's address, and keeps the version chosen there as a pick", async () => {
    const script = fakeScript(`
const args = process.argv.slice(2);
console.log(JSON.stringify({ event: "ready", args }));
console.log(JSON.stringify({ event: "chosen", round: 2, n: 3, title: "Rail", id: "m-3", digest: "abcdef0123456789", note: "keep the lift" }));
setTimeout(() => process.exit(0), 50);
`);
    const s = openPreview({ sessionId: SID, round: 2, baseUrl: "http://127.0.0.1:4400", script });
    expect(s.open).toBe(true);
    expect(s.round).toBe(2);
    await until(() => !previewState(SID).open);
    const after = previewState(SID);
    expect(after.open).toBe(false);
    expect(after.error).toBeNull();
    expect(after.pick).toMatchObject({
      round: 2,
      n: 3,
      title: "Rail",
      mockupId: "m-3",
      digest: "abcdef0123456789",
      note: "keep the lift",
    });
    clearPreviewPick(SID);
    expect(previewState(SID).pick).toBeNull();
  });

  it("doesn't open a second window for the same round, and replaces one for another round", async () => {
    const script = fakeScript(`setTimeout(() => {}, 5000); process.on("SIGTERM", () => process.exit(0));`);
    const a = openPreview({ sessionId: SID2, round: 1, baseUrl: "http://127.0.0.1:4400", script });
    const again = openPreview({ sessionId: SID2, round: 1, baseUrl: "http://127.0.0.1:4400", script });
    expect(a.open && again.open).toBe(true);
    const other = openPreview({ sessionId: SID2, round: 2, baseUrl: "http://127.0.0.1:4400", script });
    expect(other.round).toBe(2);
    // close it for the next tests
    openPreview({ sessionId: SID2, round: 3, baseUrl: "http://127.0.0.1:4400", script: fakeScript("process.exit(0)") });
    await until(() => !previewState(SID2).open);
    expect(previewState(SID2).open).toBe(false);
  });

  it("reports why the preview stopped when it fails", async () => {
    const script = fakeScript(`console.error("--url must be PIVOT on this machine"); process.exit(1);`);
    openPreview({ sessionId: SID, round: 1, baseUrl: "http://127.0.0.1:4400", script });
    await until(() => !previewState(SID).open);
    expect(previewState(SID).error).toBe("--url must be PIVOT on this machine");
  });

  it("refuses a bad session id or round, and says when the script isn't there", () => {
    expect(() => openPreview({ sessionId: "nope", round: 1, baseUrl: "http://127.0.0.1:4400", script: "x" })).toThrow();
    expect(() => openPreview({ sessionId: SID, round: 0, baseUrl: "http://127.0.0.1:4400", script: "x" })).toThrow();
    expect(openPreview({ sessionId: SID, round: 1, baseUrl: "http://127.0.0.1:4400", script: null }).error).toMatch(
      /isn't installed/,
    );
  });

  it("finds the skill's preview script from inside this checkout", () => {
    const found = previewScript(path.resolve(__dirname, ".."));
    expect(found && fs.existsSync(found)).toBe(true);
    expect(found).toMatch(/plugin\/skills\/design\/scripts\/preview\.mjs$/);
  });
});
