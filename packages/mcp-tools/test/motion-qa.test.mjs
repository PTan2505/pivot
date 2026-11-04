// pivot-design's motion QA script (.claude/skills/pivot-design/scripts/motion-qa.mjs): the QA contract (Pass, Fail,
// Not Verified), tracing to the approved brief, the overall status, and one real browser run on its fixture page.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze, parseTranscript } from "../../../scripts/trace-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "../../../.claude/skills/pivot-design/scripts/motion-qa.mjs");
const qa = await import(pathToFileURL(scriptPath).href);
const { validatePlan, parseBriefMotion, traceItems, judgeItem, aggregate, renderMarkdown, signature, verifyEvidence } =
  qa;

const DESKTOP = [{ name: "desktop", width: 1440, height: 900 }];
const obs = (o = {}) => ({
  executed: true,
  motion: true,
  properties: ["opacity", "transform"],
  animated: ["opacity", "transform"],
  declared: [{ name: "rise", durationMs: 400, easing: "ease-out" }],
  end: { opacity: "1", transform: "none" },
  cls: 0,
  longFrames: 0,
  evidence: [],
  ...o,
});
const still = (o = {}) => obs({ motion: false, properties: [], animated: [], declared: [], ...o });
const item = (o = {}) => ({
  id: "M1",
  name: "Hero entrance",
  tag: "essential",
  trigger: { type: "load" },
  target: "#hero",
  expect: { animates: true, properties: ["opacity", "transform"], end: { opacity: "1", transform: "none" } },
  reduced: { animates: false },
  ...o,
});
const runs = (full, reduced) => ({ desktop: { full, reduced } });
const statusOf = (j, check, mode = "full") => j.checks.find((c) => c.check === check && c.mode === mode)?.status;

describe("the plan and the approved brief", () => {
  it("refuses plans that can't be traced or aren't local previews", () => {
    const base = { target: { url: "http://127.0.0.1:5173/" }, items: [item()] };
    expect(validatePlan(base).errors).toEqual([]);
    expect(validatePlan(base).plan.viewports.map((v) => v.name)).toEqual(["desktop", "phone"]);
    for (const [bad, message] of [
      [{ ...base, target: { url: "https://example.com/" } }, "local preview"],
      [{ ...base, target: { url: "http://127.0.0.1/", file: "/x.html" } }, "exactly one"],
      [{ ...base, target: { viewer: "/mockups" } }, "target.version"],
      [{ ...base, items: [item({ id: "hero" })] }, "M1, M2"],
      [{ ...base, items: [item(), item()] }, "duplicate"],
      [{ ...base, items: [item({ tag: "nice" })] }, "essential or detail"],
      [{ ...base, items: [item({ trigger: { type: "swipe" } })] }, "trigger.type"],
      [{ ...base, items: [item({ expect: {} })] }, "expect.animates"],
      [{ ...base, items: [] }, "items is empty"],
    ])
      expect(validatePlan(bad).errors.join(" "), message).toContain(message);
    // PIVOT's own app is never a target: a click there is same-origin with its API
    expect(validatePlan({ ...base, target: { url: "http://127.0.0.1:4321/design/s1" } }).errors.join(" ")).toContain(
      "PIVOT itself",
    );
    expect(validatePlan({ ...base, target: { url: "http://localhost:4321/" } }).errors.join(" ")).toContain(
      "PIVOT itself",
    );
    // an item that can't be triggered automatically needs no element or expectation
    expect(
      validatePlan({ ...base, items: [{ id: "M2", name: "Trail", tag: "detail", trigger: "other" }] }).errors,
    ).toEqual([]);
  });

  it("reads the Motion block's items, ids and tags, and nothing else", () => {
    const md = `## Brief\n| Reference | Take |\n| --- | --- |\n| Linear | header |\n\n**Motion:** advanced\n\n| Item | Trigger → behaviour | Timing | Reduced motion | Tag |\n| --- | --- | --- | --- | --- |\n| M1 · Hero entrance | load → fade up | 250 ms | at once | essential |\n| M2: Sticky header | scroll | none | same | detail |\n| Old row without id | hover | 200 ms | none | essential |\n\nText after.`;
    expect(parseBriefMotion(md)).toEqual([
      { id: "M1", name: "Hero entrance", tag: "essential" },
      { id: "M2", name: "Sticky header", tag: "detail" },
      { id: null, name: "Old row without id", tag: "essential" },
    ]);
  });

  it("traces the plan to the brief: unchecked items, checks the brief doesn't have, and the brief's tags", () => {
    const brief = [
      { id: "M1", name: "Hero", tag: "essential" },
      { id: "M2", name: "Header", tag: "detail" },
      { id: "M3", name: "Reveal", tag: "essential" },
    ];
    const t = traceItems([item(), item({ id: "M2", tag: "essential" }), item({ id: "M9" })], brief);
    expect(t).toMatchObject({
      checked: true,
      missing: [{ id: "M3" }],
      extra: ["M9"],
      tagMismatch: [{ id: "M2", plan: "essential", brief: "detail" }],
    });
    expect(traceItems([item()], null).checked).toBe(false);
  });
});

describe("judging one item", () => {
  it("passes only when every check was executed and observed as briefed", () => {
    const j = judgeItem(item(), runs([obs(), obs()], [still(), still()]), DESKTOP);
    expect(j.result).toBe("Pass");
    expect(j.checks.every((c) => c.status === "pass")).toBe(true);
    expect(j.checks.map((c) => `${c.mode} ${c.check}`)).toEqual([
      "full trigger",
      "full moves",
      "full properties",
      "full final state",
      "full replay",
      "reduced moves",
      "reduced final state",
      "reduced visibility",
      "reduced replay",
    ]);
  });

  it("missing or failed execution is Not Verified, never Pass", () => {
    expect(judgeItem(item(), {}, DESKTOP).result).toBe("Not Verified");
    const notFound = judgeItem(
      item(),
      runs([{ executed: false, error: "element #hero not found" }], [still(), still()]),
      DESKTOP,
    );
    expect(notFound.result).toBe("Not Verified");
    expect(notFound.checks[0]).toMatchObject({
      check: "trigger",
      status: "not verified",
      detail: "element #hero not found",
    });
    const other = judgeItem(item({ trigger: { type: "other", note: "follows the pointer" } }), {}, DESKTOP);
    expect(other).toMatchObject({ result: "Not Verified", checks: [{ status: "not verified" }] });
    expect(other.checks[0].detail).toContain("follows the pointer");
  });

  it("fails when the motion doesn't happen, ends elsewhere or animates other properties", () => {
    expect(statusOf(judgeItem(item(), runs([still(), still()], [still(), still()]), DESKTOP), "moves")).toBe("fail");
    const wrongEnd = judgeItem(
      item(),
      runs([obs({ end: { opacity: "0.6", transform: "none" } }), obs()], [still(), still()]),
      DESKTOP,
    );
    expect(wrongEnd.result).toBe("Fail");
    expect(wrongEnd.checks.find((c) => c.check === "final state").detail).toBe("opacity 0.6 instead of 1");
    const onlyOpacity = obs({ properties: ["opacity"] });
    expect(
      statusOf(judgeItem(item(), runs([onlyOpacity, onlyOpacity], [still(), still()]), DESKTOP), "properties"),
    ).toBe("fail");
  });

  it("compares declared timing exactly as the brief writes it, and can't verify motion that declares none", () => {
    const timed = item({ expect: { ...item().expect, durationMs: 250, easing: "ease-out" } });
    const ok = obs({ declared: [{ name: "rise", durationMs: 250, easing: "ease-out" }] });
    expect(statusOf(judgeItem(timed, runs([ok, ok], [still(), still()]), DESKTOP), "declared timing")).toBe("pass");
    const slow = obs({ declared: [{ name: "rise", durationMs: 251, easing: "ease-out" }] });
    expect(statusOf(judgeItem(timed, runs([slow, slow], [still(), still()]), DESKTOP), "declared timing")).toBe("fail");
    const scripted = obs({ declared: [] });
    const j = judgeItem(timed, runs([scripted, scripted], [still(), still()]), DESKTOP);
    expect(statusOf(j, "declared timing")).toBe("not verified");
    expect(j.result).toBe("Not Verified");
  });

  it("a page that never stopped animating before the trigger can't pass", () => {
    const busy = obs({ unsettled: true });
    const j = judgeItem(item(), runs([busy, obs()], [still(), still()]), DESKTOP);
    expect(statusOf(j, "settled")).toBe("not verified");
    expect(j.result).toBe("Not Verified");
  });

  it("an observation that didn't see the whole motion can't pass", () => {
    // an animation found finished, never seen running, may have run before anyone watched
    const late = still({ finishedBeforeWatch: true });
    const j = judgeItem(item(), runs([late, late], [still(), still()]), DESKTOP);
    expect(statusOf(j, "moves")).toBe("not verified");
    expect(j.result).toBe("Not Verified");
    // the window ended before the element settled, or the element went away
    const capped = judgeItem(item(), runs([obs({ capped: true }), obs()], [still(), still()]), DESKTOP);
    expect(capped.checks.find((c) => c.check === "settled")).toMatchObject({ status: "not verified" });
    expect(capped.result).toBe("Not Verified");
    const gone = obs({ lostTarget: true, end: {} });
    const lost = judgeItem(item(), runs([gone, gone], [still(), still()]), DESKTOP);
    expect(lost.checks.filter((c) => c.check === "final state").map((c) => c.status)).toEqual(["not verified", "pass"]);
    expect(lost.result).toBe("Not Verified");
  });

  it("a final state alone never proves the trigger", () => {
    // the element ends exactly as briefed, but nothing moved after the trigger: it was already there
    const already = still({ end: { opacity: "1", transform: "none" } });
    const j = judgeItem(item({ trigger: { type: "scroll" } }), runs([already, already], [still(), still()]), DESKTOP);
    expect(statusOf(j, "final state")).toBe("pass");
    expect(statusOf(j, "moves")).toBe("fail");
    expect(j.result).toBe("Fail");
  });

  it("checks Replay: a second run that differs fails, a replay that didn't run isn't verified", () => {
    const differs = judgeItem(item(), runs([obs(), still()], [still(), still()]), DESKTOP);
    expect(statusOf(differs, "replay")).toBe("fail");
    expect(differs.checks.find((c) => c.check === "replay").detail).toContain("motion true then false");
    const noReplay = judgeItem(item(), runs([obs()], [still(), still()]), DESKTOP);
    expect(statusOf(noReplay, "replay")).toBe("not verified");
    expect(noReplay.result).toBe("Not Verified");
    expect(signature(obs())).toBe(signature(obs({ evidence: [{ file: "x.png" }], cls: 0.2 })));
  });

  it("reduced motion: content must still arrive, movement must go, and the brief must say what to expect", () => {
    // the common defect: `animation: none` leaves the element at its hidden starting state
    const hidden = still({ end: { opacity: "0", transform: "none" } });
    const j = judgeItem(item(), runs([obs(), obs()], [hidden, hidden]), DESKTOP);
    expect(j.result).toBe("Fail");
    expect(j.checks.find((c) => c.mode === "reduced" && c.check === "final state").detail).toBe(
      "opacity 0 instead of 1",
    );
    // a gentler alternative is allowed when briefed: a fade is fine, movement isn't
    const fadeOnly = item({ reduced: { animates: true, properties: ["opacity"], notProperties: ["transform"] } });
    const fade = obs({ properties: ["opacity"], animated: ["opacity"] });
    expect(judgeItem(fadeOnly, runs([obs(), obs()], [fade, fade]), DESKTOP).result).toBe("Pass");
    const stillMoves = obs();
    expect(
      statusOf(judgeItem(fadeOnly, runs([obs(), obs()], [stillMoves, stillMoves]), DESKTOP), "no movement", "reduced"),
    ).toBe("fail");
    // with no final state briefed, reduced motion must still leave it as visible as full motion does
    const noEnd = item({ expect: { animates: true, properties: ["opacity"] } });
    const ghost = still({ end: { opacity: "0", transform: "none", visibility: "visible", display: "block" } });
    const shown = obs({ end: { opacity: "1", transform: "none", visibility: "visible", display: "block" } });
    const v = judgeItem(noEnd, runs([shown, shown], [ghost, ghost]), DESKTOP);
    expect(v.checks.find((c) => c.check === "visibility")).toMatchObject({ status: "fail", mode: "reduced" });
    expect(
      judgeItem(
        noEnd,
        runs(
          [shown, shown],
          [
            { ...shown, motion: false },
            { ...shown, motion: false },
          ],
        ),
        DESKTOP,
      ).result,
    ).toBe("Pass");
    expect(
      judgeItem(
        noEnd,
        { desktop: { full: [{ executed: false, error: "x" }], reduced: [shown, shown] } },
        DESKTOP,
      ).checks.find((c) => c.check === "visibility").status,
    ).toBe("not verified");
    // turning everything off isn't assumed to be right: without the brief's reduced behaviour, it isn't verified
    const unbriefed = judgeItem(item({ reduced: undefined }), runs([obs(), obs()]), DESKTOP);
    expect(unbriefed.result).toBe("Not Verified");
    expect(unbriefed.checks.at(-1).detail).toContain("no reduced-motion behaviour");
  });

  it("budgets come only from the brief; unmeasured is Not Verified", () => {
    const budget = item({ budgets: { cls: 0 } });
    expect(
      statusOf(judgeItem(budget, runs([obs({ cls: 0.05 }), obs()], [still(), still()]), DESKTOP), "layout shift"),
    ).toBe("fail");
    expect(
      statusOf(judgeItem(budget, runs([obs({ cls: null }), obs()], [still(), still()]), DESKTOP), "layout shift"),
    ).toBe("not verified");
    // without a budget the value is reported, never judged
    expect(judgeItem(item(), runs([obs({ cls: 0.3 }), obs()], [still(), still()]), DESKTOP).result).toBe("Pass");
  });

  it("a failure at any viewport fails the item", () => {
    const both = [...DESKTOP, { name: "phone", width: 390, height: 844 }];
    const r = {
      desktop: { full: [obs(), obs()], reduced: [still(), still()] },
      phone: { full: [still(), still()], reduced: [still(), still()] },
    };
    const j = judgeItem(item(), r, both);
    expect(j.result).toBe("Fail");
    expect(j.checks.find((c) => c.status === "fail").viewport).toBe("phone");
  });
});

describe("overall status", () => {
  const traced = { checked: true, missing: [], extra: [], unnamed: 0, tagMismatch: [] };
  const it2 = (id, tag, result) => ({ id, tag, result });

  it("is Pass only when every essential item of the approved brief passed", () => {
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "detail", "Pass")], traced).status).toBe("Pass");
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "essential", "Fail")], traced).status).toBe("Fail");
    expect(aggregate([it2("M1", "essential", "Pass"), it2("M2", "essential", "Not Verified")], traced).status).toBe(
      "Not Verified",
    );
    // Fail wins over Not Verified
    expect(aggregate([it2("M1", "essential", "Not Verified"), it2("M2", "essential", "Fail")], traced).status).toBe(
      "Fail",
    );
  });

  it("can't pass without the brief, with an unchecked essential item, an untraced check, or nothing essential", () => {
    const ok = [it2("M1", "essential", "Pass")];
    expect(aggregate(ok, { ...traced, checked: false }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, missing: [{ id: "M2", tag: "essential" }] }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, extra: ["M9"] }).status).toBe("Not Verified");
    expect(aggregate(ok, { ...traced, unnamed: 1 }).status).toBe("Not Verified");
    expect(aggregate([it2("M1", "detail", "Pass")], traced).status).toBe("Not Verified");
    // a detail item that wasn't checked doesn't block, but it is listed
    const r = aggregate(ok, { ...traced, missing: [{ id: "M2", tag: "detail" }] });
    expect(r.status).toBe("Pass");
  });

  it("detail failures don't decide the status but are reported", () => {
    const r = aggregate([it2("M1", "essential", "Pass"), it2("M2", "detail", "Fail")], traced);
    expect(r).toMatchObject({ status: "Pass", detailFailures: ["M2"], counts: { Fail: { essential: 0, detail: 1 } } });
  });
});

describe("the report", () => {
  it("says where each result comes from and what wasn't verified", () => {
    const report = {
      tool: { version: "1.0.0" },
      project: "Orbit",
      implementation: "git abc123",
      brief: { label: "session s1, approved brief", sha256: "f".repeat(64) },
      target: { label: "http://127.0.0.1:5173/" },
      environment: {
        browser: "Chromium 1",
        playwright: "1.64.1",
        os: "Darwin",
        node: "Node v26",
        reducedMotion: "browser emulation (Playwright reducedMotion: reduce / no-preference), Chromium only",
      },
      viewports: DESKTOP,
      plan: { sha256: "a".repeat(64) },
      startedAt: "2026-11-04T00:00:00Z",
      trace: { missing: [{ id: "M3", name: "Reveal", tag: "essential" }] },
      items: [
        {
          ...item(),
          result: "Fail",
          intent: "fade up",
          checks: [
            {
              viewport: "desktop",
              mode: "reduced",
              check: "final state",
              status: "fail",
              detail: "opacity 0 instead of 1",
            },
          ],
          observations: [],
        },
      ],
      overall: { status: "Fail", reasons: ["essential items failed: M1"] },
      limitations: [
        "Reduced motion was browser emulation in Chromium (Playwright). The OS setting and real devices weren't checked",
      ],
      specialists: [{ name: "animation-performance", phase: "qa", run: "consulted" }],
    };
    const md = renderMarkdown(report);
    expect(md).toContain("# Motion QA: Orbit — Fail");
    expect(md).toContain("- Implementation: git abc123");
    expect(md).toContain("| M3 | Reveal | essential | – | Not Verified (no check) | – |");
    expect(md).toContain("**Fail** (desktop, reduced) final state: opacity 0 instead of 1");
    expect(md).toContain("real devices weren't checked");
    expect(md).toContain("Specialists (declared by the agent, not checked here; trace-check verifies them)");
    expect(md).toContain("- animation-performance — qa — consulted");
  });
});

describe("evidence", () => {
  const folder = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-ev-"));
    const files = { "M1-a.png": "first", "M1-b.png": "second" };
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body);
    const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
    const report = {
      runId: "run-1",
      items: [
        {
          id: "M1",
          observations: [{ evidence: Object.entries(files).map(([file, body]) => ({ file, sha256: sha(body) })) }],
        },
      ],
    };
    fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report));
    return dir;
  };

  it("--verify accepts untouched evidence and names missing, changed and stray files", () => {
    const dir = folder();
    try {
      expect(verifyEvidence(path.join(dir, "report.json"))).toEqual({ runId: "run-1", files: 2, problems: [] });
      fs.writeFileSync(path.join(dir, "M1-a.png"), "edited");
      fs.rmSync(path.join(dir, "M1-b.png"));
      fs.writeFileSync(path.join(dir, "M2-other-run.png"), "x");
      expect(verifyEvidence(path.join(dir, "report.json")).problems).toEqual([
        "M1-a.png: changed since the run",
        "M1-b.png: missing",
        "M2-other-run.png: in the folder but not in this report (another run?)",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a run never writes into a folder that already holds something", async () => {
    const dir = folder();
    try {
      await expect(
        qa.runPlan({ target: { file: path.join(dir, "x.html") }, items: [item()] }, { out: dir }),
      ).rejects.toThrow("isn't empty");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("where the QA browser may connect", () => {
  const { destinationPolicy, isLocalAddress, originKey } = qa;
  it("names an origin one way, whatever the spelling", () => {
    expect(originKey("http://127.0.0.1:5173/x")).toBe("127.0.0.1:5173");
    expect(originKey("http://LOCALHOST/")).toBe("localhost:80");
    expect(originKey("https://[::1]/")).toBe("::1:443");
  });

  it("knows this machine and private networks in every form", () => {
    for (const ip of [
      "127.0.0.1",
      "127.9.9.9",
      "0.0.0.0",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.1.1",
      "::1",
      "[::1]",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:c0a8:101",
    ])
      expect(isLocalAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "172.32.0.1", "::ffff:808:808"])
      expect(isLocalAddress(ip), ip).toBe(false);
  });

  it("by default allows only the preview's exact origin: not another port, not another name for this machine, never PIVOT", async () => {
    const decide = destinationPolicy({ allowed: ["127.0.0.1:5173"] });
    expect(await decide("127.0.0.1", 5173)).toEqual({ ok: true, host: "127.0.0.1" });
    for (const [h, p] of [
      ["127.0.0.1", 6379],
      ["localhost", 5173],
      ["::1", 5173],
      ["[::1]", 5173],
      ["127.0.0.2", 5173],
      ["0.0.0.0", 5173],
      ["example.com", 443],
      ["127.0.0.1", 4321],
    ])
      expect((await decide(h, p)).ok, `${h}:${p}`).toBe(false);
    expect((await destinationPolicy({ allowed: ["127.0.0.1:4321"] })("127.0.0.1", 4321)).reason).toContain("PIVOT");
  });

  it("with --allow-remote, public hosts only: a name that resolves to this machine or a private network is refused", async () => {
    const names = {
      "cdn.example": ["93.184.216.34"],
      "rebind.example": ["93.184.216.34", "127.0.0.1"],
      "lan.example": ["10.0.0.5"],
    };
    const lookup = async (h) => {
      if (!names[h]) throw new Error("ENOTFOUND");
      return names[h].map((address) => ({ address }));
    };
    const decide = destinationPolicy({ allowed: ["127.0.0.1:5173"], allowRemote: true, lookup });
    // the connection goes to the address that was checked, not to a second lookup
    expect(await decide("cdn.example", 443)).toEqual({ ok: true, host: "93.184.216.34" });
    expect(await decide("8.8.8.8", 443)).toEqual({ ok: true, host: "8.8.8.8" });
    for (const h of ["rebind.example", "lan.example", "127.0.0.1", "localhost.example", "::ffff:127.0.0.1"])
      expect((await decide(h, 80)).ok, h).toBe(false);
  });

  it("the plan can't grant itself remote access, writes or another origin, and --allow-origin takes only local origins", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-perm-"));
    try {
      const plan = { target: { url: "http://127.0.0.1:5173/" }, items: [item()] };
      for (const o of ["https://cdn.example.com", "http://127.0.0.1:4321"])
        await expect(qa.runPlan(plan, { out: path.join(out, String(o.length)), allowOrigins: [o] })).rejects.toThrow(
          "--allow-origin must be a local origin other than PIVOT",
        );
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it("an unrelated service on this machine gets nothing: other ports, other names, redirects and WebSockets; the preview's own reload socket works", async () => {
    const other = [];
    const own = [];
    const svc = http.createServer((req, res) => {
      other.push(`${req.method} ${req.url}`);
      res.end("svc");
    });
    svc.on("upgrade", (req, sock) => {
      other.push(`WS ${req.url}`);
      sock.destroy();
    });
    await new Promise((r) => svc.listen(0, "::", r));
    const sp = svc.address().port;
    const prev = http.createServer((req, res) => {
      own.push(`${req.method} ${req.url}`);
      if (req.url === "/hop") {
        res.writeHead(302, { location: `http://127.0.0.1:${sp}/via-redirect` });
        return res.end();
      }
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><div id="box"></div><img src="/hop"><img src="http://localhost:${sp}/alias">
<img src="http://[::1]:${sp}/v6"><img src="http://0.0.0.0:${sp}/unspecified">
<script>fetch("http://127.0.0.1:${sp}/get").catch(() => {});
try { new WebSocket("ws://127.0.0.1:${sp}/ws"); } catch {}
new WebSocket("ws://" + location.host + "/hmr");</script>`);
    });
    prev.on("upgrade", (req, sock) => {
      own.push(`WS ${req.url}`);
      const accept = crypto
        .createHash("sha1")
        .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      sock.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
    });
    await new Promise((r) => prev.listen(0, "127.0.0.1", r));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-loop-"));
    try {
      const report = await qa.runPlan(
        {
          target: { url: `http://127.0.0.1:${prev.address().port}/` },
          viewports: ["desktop"],
          // a plan can't grant these; they are ignored
          allowRemote: true,
          allowWrites: true,
          allowOrigins: [`http://127.0.0.1:${sp}`],
          items: [
            { id: "M1", name: "x", tag: "essential", trigger: "load", target: "#box", expect: { animates: false } },
          ],
        },
        { out: path.join(out, "qa") },
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(other).toEqual([]);
      expect(own).toContain("WS /hmr");
      expect(report.network.allowedOrigins).toEqual([`127.0.0.1:${prev.address().port}`]);
      for (const b of [`127.0.0.1:${sp}`, `localhost:${sp}`, `[::1]:${sp}`, `0.0.0.0:${sp}`])
        expect(report.blocked).toContain(b);
    } finally {
      svc.close();
      prev.close();
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("in a transcript", () => {
  const line = (i, name, input, error = false) => [
    JSON.stringify({
      type: "assistant",
      timestamp: `2026-11-04T10:00:${String(i).padStart(2, "0")}.000Z`,
      cwd: "/work/target",
      message: { content: [{ type: "tool_use", id: `t${i}`, name, input }] },
    }),
    JSON.stringify({
      type: "user",
      timestamp: `2026-11-04T10:00:${String(i).padStart(2, "0")}.500Z`,
      message: { content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "ok", is_error: error }] },
    }),
  ];
  it("trace-check counts motion QA runs apart from specialists, and never as a specialist run", () => {
    const skill = "/Users/u/.claude/skills/pivot-design/scripts/motion-qa.mjs";
    const text = [
      ...line(0, "Bash", { command: `node ${skill} /tmp/s/plan.json --out /tmp/s/qa --brief /tmp/s/brief.md` }, true),
      ...line(1, "Bash", { command: `node ${skill} --self-test --out /tmp/s/self` }),
      ...line(2, "Bash", { command: `cat ${skill}` }),
      // a read inside a compound command isn't a run (seen in a real trace)
      ...line(4, "Bash", { command: `P=/tmp/s; cat $P/brief.md; sed -n 1,200p ${skill}` }, true),
      ...line(5, "Bash", { command: `cd /tmp/s && sed -n 1000,1200p ${skill} | grep -n argv` }),
      ...line(3, "Read", { file_path: "/Users/u/.claude/skills/review-animations/SKILL.md" }),
    ].join("\n");
    const r = analyze(parseTranscript(text), { target: "/work/target", scratch: "/tmp/s" });
    expect(r.motionQa).toEqual({ runs: 1, selfTests: 1, nonZeroExits: 1 });
    expect(Object.keys(r.specialists)).toEqual(["review-animations"]);
    expect(r.specialists["review-animations"].label).toBe("consulted");
    expect(r.writes.target).toBe(0);
  });
});

describe("in a browser", () => {
  it("fails clearly, with exit code 3, where PIVOT's Playwright can't be found", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-alone-"));
    try {
      const copy = path.join(dir, "motion-qa.mjs");
      fs.copyFileSync(scriptPath, copy);
      fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ target: { file: copy }, items: [item()] }));
      const env = { ...process.env };
      delete env.PIVOT_REPO;
      let out = null;
      try {
        execFileSync(process.execPath, [copy, path.join(dir, "plan.json"), "--out", path.join(dir, "qa")], {
          env,
          stdio: "pipe",
        });
      } catch (err) {
        out = { status: err.status, stderr: String(err.stderr) };
      }
      expect(out?.status).toBe(3);
      expect(out?.stderr).toContain("Playwright not found");
      expect(out?.stderr).toContain("Not Verified");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Another address of this machine stands in for "another host": nothing may reach it.
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i?.family === "IPv4" && !i.internal)?.address;
  it.skipIf(!lan)(
    "reaches no other host (requests, redirects, WebSockets, workers) and sends no writes, even when a click asks",
    async () => {
      const remoteHits = [];
      const remote = http.createServer((req, res) => {
        remoteHits.push(`${req.method} ${req.url}`);
        res.end("x");
      });
      remote.on("upgrade", (req, socket) => {
        remoteHits.push(`WS ${req.url}`);
        socket.destroy();
      });
      await new Promise((r) => remote.listen(0, "0.0.0.0", r));
      const far = `${lan}:${remote.address().port}`;
      const localHits = [];
      const local = http.createServer((req, res) => {
        localHits.push(`${req.method} ${req.url}`);
        if (req.url === "/hop") {
          res.writeHead(302, { location: `http://${far}/redirected` });
          return res.end();
        }
        if (req.url === "/away") {
          res.writeHead(302, { location: `http://${far}/page` });
          return res.end();
        }
        if (req.url === "/sw.js") {
          res.setHeader("content-type", "text/javascript");
          return res.end(`fetch("http://${far}/from-worker")`);
        }
        res.setHeader("content-type", "text/html");
        res.end(`<!doctype html><style>#box{width:80px;height:80px;transition:transform .2s ease-out}
#box.on{transform:translateX(40px)}</style><div id="box"></div><button id="go">Delete</button><img src="/hop">
<script>
fetch("http://${far}/fetch").catch(() => {});
try { new WebSocket("ws://${far}/socket"); } catch {}
navigator.serviceWorker?.register("/sw.js").catch(() => {});
document.getElementById("go").addEventListener("click", () => {
  document.getElementById("box").classList.add("on");
  fetch("/api/items/1", { method: "DELETE" }).catch(() => {});
  navigator.sendBeacon("http://${far}/beacon", "x");
});
</script>`);
      });
      await new Promise((r) => local.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${local.address().port}`;
      const out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-net-"));
      try {
        const report = await qa.runPlan(
          {
            target: { url: `${base}/` },
            viewports: ["desktop"],
            items: [
              {
                id: "M1",
                name: "Box slides on click",
                tag: "essential",
                trigger: { type: "click", on: "#go" },
                target: "#box",
                expect: { animates: true, properties: ["transform"] },
              },
            ],
          },
          { out: path.join(out, "qa") },
        );
        await new Promise((r) => setTimeout(r, 500));
        expect(remoteHits).toEqual([]);
        expect(localHits.filter((h) => !h.startsWith("GET"))).toEqual([]);
        expect(report.network.blockedWrites).toContain(`DELETE ${base}/api/items/1`);
        expect(report.blocked.length).toBeGreaterThan(0);
        // the click still ran and its motion was seen; only the write was stopped
        const m1 = report.items[0];
        expect(m1.checks.find((c) => c.check === "moves" && c.viewport === "desktop")).toMatchObject({
          status: "pass",
        });
        // a preview that redirects to another host isn't observed at all
        const away = await qa.runPlan(
          {
            target: { url: `${base}/away` },
            viewports: ["desktop"],
            items: [
              { id: "M1", name: "x", tag: "essential", trigger: "load", target: "#box", expect: { animates: true } },
            ],
          },
          { out: path.join(out, "away") },
        );
        expect(away.items[0].result).toBe("Not Verified");
        expect(remoteHits).toEqual([]);
      } finally {
        remote.close();
        local.close();
        fs.rmSync(out, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it("on the fixture page: catches the defects, repeats on Replay, keeps evidence with its provenance", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "motion-qa-test-"));
    try {
      const r = await qa.selfTest({ out, viewports: ["desktop"] });
      expect(r.lines.filter((l) => l.startsWith("FAIL"))).toEqual([]);
      expect(r.ok).toBe(true);
      const { report } = r;
      expect(report.overall.status).toBe("Fail");
      expect(report.environment.browser).toMatch(/^Chromium \d/);
      expect(report.environment.reducedMotion).toContain("browser emulation");
      expect(report.limitations.join(" ")).toContain("real devices weren't checked");
      expect(report.target.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(report.brief.sha256).toMatch(/^[0-9a-f]{64}$/);
      // every observation of an executed item ran twice per mode: the first run and the Replay
      const m1 = report.items.find((i) => i.id === "M1");
      expect(m1.observations.map((o) => `${o.mode}/${o.run}`)).toEqual([
        "full/first",
        "full/replay",
        "reduced/first",
        "reduced/replay",
      ]);
      expect(m1.observations.every((o) => o.executed && o.evidence.length)).toBe(true);
      expect(fs.existsSync(path.join(out, "run", "report.md"))).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }, 180_000);
});
