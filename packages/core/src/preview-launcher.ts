import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Opens the interactive preview (`design/scripts/preview.mjs` in the plugin) from PIVOT's own session page, so the owner
 * doesn't need an agent to try a round's versions. The preview is the same separate, network-locked Chromium window
 * an agent opens: PIVOT only starts it and reads its event lines. A version the owner chooses there ("Choose this
 * version") is kept here as the session's pending pick, so the session page can open its approval dialog on that
 * version. A pick is never an approval: approving still needs the owner passphrase in PIVOT (or the owner's words in
 * the chat).
 */

export interface PreviewPick {
  round: number;
  n: number;
  title: string;
  mockupId: string;
  digest: string;
  note: string;
  at: string;
}

export interface PreviewState {
  /** A preview window this PIVOT opened for the session is open. */
  open: boolean;
  round: number | null;
  /** The last version chosen in a preview this PIVOT opened, until it is approved or dismissed. */
  pick: PreviewPick | null;
  /** Why the last launch failed, if it did. */
  error: string | null;
}

interface Entry {
  child: ChildProcess | null;
  round: number | null;
  pick: PreviewPick | null;
  error: string | null;
}

// kept on globalThis so a module reload (dev server) doesn't lose a window that is still open
const store: Map<string, Entry> = ((globalThis as { __pivotPreviews?: Map<string, Entry> }).__pivotPreviews ??=
  new Map());

const entry = (sessionId: string) => {
  let e = store.get(sessionId);
  if (!e) store.set(sessionId, (e = { child: null, round: null, pick: null, error: null }));
  return e;
};

export function previewState(sessionId: string): PreviewState {
  const e = store.get(sessionId);
  return { open: !!e?.child, round: e?.child ? e.round : null, pick: e?.pick ?? null, error: e?.error ?? null };
}

/** Forgets the pending pick (approved, or dismissed by the owner). */
export function clearPreviewPick(sessionId: string) {
  const e = store.get(sessionId);
  if (e) e.pick = null;
}

/** The preview script of the pivot:design skill in this PIVOT checkout (PIVOT_PREVIEW_SCRIPT overrides it). */
export function previewScript(from = process.cwd()): string | null {
  if (process.env.PIVOT_PREVIEW_SCRIPT) return process.env.PIVOT_PREVIEW_SCRIPT;
  for (let dir = path.resolve(/*turbopackIgnore: true*/ from); ; dir = path.dirname(dir)) {
    const p = path.join(dir, "plugin/skills/design/scripts/preview.mjs");
    if (fs.existsSync(p)) return p;
    if (path.dirname(dir) === dir) return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens the preview window for a round, or leaves the one already open for that round alone (another round's window
 * is closed first). `baseUrl` is this PIVOT (127.0.0.1); the script refuses anything else.
 */
export function openPreview({
  sessionId,
  round,
  baseUrl,
  script = previewScript(),
}: {
  sessionId: string;
  round: number;
  baseUrl: string;
  script?: string | null;
}): PreviewState {
  if (!UUID.test(sessionId) || !Number.isInteger(round) || round < 1) throw new Error("Bad session or round.");
  const e = entry(sessionId);
  if (e.child && e.round === round) return previewState(sessionId);
  if (e.child) e.child.kill();
  if (!script) {
    e.error = "The interactive preview isn't installed here (design/scripts/preview.mjs).";
    return previewState(sessionId);
  }
  e.error = null;
  const child = spawn(process.execPath, [script, sessionId, "--round", String(round), "--url", baseUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  e.child = child;
  e.round = round;
  let buf = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.event === "chosen" && typeof ev.id === "string" && typeof ev.digest === "string")
        e.pick = {
          round: Number(ev.round) || round,
          n: Number(ev.n),
          title: String(ev.title ?? ""),
          mockupId: ev.id,
          digest: ev.digest,
          note: typeof ev.note === "string" ? ev.note : "",
          at: new Date().toISOString(),
        };
    }
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (c: string) => (stderr = (stderr + c).slice(-500)));
  const done = (code: number | null) => {
    if (e.child !== child) return;
    e.child = null;
    e.round = null;
    if (code && code !== 0) e.error = stderr.trim().split("\n").at(-1) || `The preview stopped (exit ${code}).`;
  };
  child.on("exit", done);
  child.on("error", (err) => {
    e.error = err.message;
    done(1);
  });
  return previewState(sessionId);
}
