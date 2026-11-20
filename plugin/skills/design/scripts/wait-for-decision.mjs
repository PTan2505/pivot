#!/usr/bin/env node
// Waits for the user's decision on a design session: node wait-for-decision.mjs <sessionId> [--url <PIVOT url>]
//   [--timeout-min 240] [--interval-s 4] [--settle-s 8]
//
// Run it in the background right after saving mockups (save_design_mockups). It only reads PIVOT (GET, no token) every
// few seconds and exits as soon as the session leaves "exploring", or the user sent feedback no round answers yet,
// printing one JSON line:
//   {"event":"approved","source":"owner","direction":"Version 3: …","note":"…","approvedAt":"…"}  the user approved in PIVOT
//   (source "chat": the user approved in the chat and the agent recorded it; note holds their words)
//   {"event":"feedback","feedback":[{"id":"…","round":2,"version":"3. Title","text":"…","pins":2,"elements":1}]}  the user sent
//   feedback from PIVOT: answer it with a new round (it waits --settle-s after the first, to take in a burst of them)
//   {"event":"abandoned"} | {"event":"status","status":"…"}   the user moved the session another way
//   {"event":"timeout"}   nothing happened before --timeout-min
// The exit is what wakes the agent up; the JSON says what happened. Network errors (PIVOT restarting) are retried.
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const sessionId = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const base = opt("--url", process.env.PIVOT_URL ?? "http://127.0.0.1:4321").replace(/\/+$/, "");
const timeoutMs = Number(opt("--timeout-min", 240)) * 60_000;
const intervalMs = Math.max(1, Number(opt("--interval-s", 4))) * 1000;
const settleMs = Math.max(0, Number(opt("--settle-s", 8))) * 1000;

if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
  console.error("Usage: node wait-for-decision.mjs <sessionId> [--url <PIVOT url>] [--timeout-min 240]");
  process.exit(1);
}

const done = (event) => {
  console.log(JSON.stringify({ sessionId, ...event }));
  process.exit(0);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function read() {
  const res = await fetch(`${base}/api/design/sessions/${sessionId}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) {
    console.error(`No design session ${sessionId} at ${base}.`);
    process.exit(1);
  }
  if (!res.ok) throw new Error(`PIVOT answered ${res.status}`);
  return res.json();
}

/** The feedback no round answers yet, as the agent needs it to start. */
const openFeedback = (s) =>
  (s.feedback ?? [])
    .filter((f) => f.status === "open")
    .map((f) => {
      const m = f.mockupId ? s.mockups.find((x) => x.id === f.mockupId) : null;
      return {
        id: f.id,
        round: f.round,
        version: m ? `${m.n}. ${m.title}` : "the whole round",
        text: f.text,
        pins: f.pins.length,
        // pins on an element the user selected (get_feedback_images gives its selector and HTML)
        elements: f.pins.filter((p) => p.element).length,
      };
    });

const started = Date.now();
let warned = false;
let feedbackSince = null;
for (;;) {
  try {
    const s = await read();
    warned = false;
    if (s.status === "exploring") {
      const open = openFeedback(s);
      if (open.length) {
        feedbackSince ??= Date.now();
        // a burst of feedback is reported together, once it has settled
        if (Date.now() - feedbackSince >= settleMs) done({ event: "feedback", feedback: open });
      }
    }
    if (s.status !== "exploring") {
      const approval = s.decisions.filter((d) => d.kind === "approval").at(-1);
      if (s.status === "approved" && approval) {
        done({
          event: "approved",
          source: approval.source ?? "agent",
          direction: approval.direction,
          note: approval.source === "owner" || approval.source === "chat" ? approval.details : undefined,
          approvedAt: approval.createdAt,
        });
      }
      done(s.status === "abandoned" ? { event: "abandoned" } : { event: "status", status: s.status });
    }
  } catch (err) {
    if (!warned) console.error(`Can't read PIVOT at ${base} (${err.message}); still waiting.`);
    warned = true;
  }
  if (Date.now() - started > timeoutMs) done({ event: "timeout" });
  await sleep(intervalMs);
}
