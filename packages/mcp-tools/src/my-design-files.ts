// The disk side of My designs (docs/my-designs-plan.md, Phase 2). The MCP server runs on the owner's machine, so it
// reads a design's files from the project itself: PIVOT stores the original's bytes, never code an agent retyped. On
// reuse it writes them back byte for byte and never overwrites a file that differs.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { refusedFileReason, relativePath } from "@pivot/core/code-files";
import { ToolError } from "./source";

export const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

const inside = (root: string, p: string) =>
  p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** An absolute folder that exists, as its real path (symlinks resolved). */
export async function realFolder(dir: string, what: string): Promise<string> {
  if (!path.isAbsolute(dir)) throw new ToolError("invalid_input", `${what} must be an absolute path (got "${dir}").`);
  let real: string;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw new ToolError("invalid_input", `${what} ${dir} doesn't exist.`);
  }
  if (!(await fs.stat(real)).isDirectory()) throw new ToolError("invalid_input", `${what} ${dir} isn't a folder.`);
  return real;
}

/** Why PIVOT won't take this relative path (malformed, or a file that can hold secrets), or null. */
export function pathProblem(rel: string): string | null {
  const parsed = relativePath.safeParse(rel);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "isn't a relative path";
  if (parsed.data !== rel) return "has spaces around it";
  return refusedFileReason(rel);
}

/**
 * Reads one file under `root` (a real path). Refused, before anything is read: a malformed path, one that leaves the
 * folder (`..`, or a symlink whose target is outside), a file that can hold secrets (by its name or its target's), and
 * anything that isn't a regular file.
 */
export async function readInside(root: string, rel: string): Promise<{ data: Buffer; real: string }> {
  const problem = pathProblem(rel);
  if (problem) throw new ToolError("invalid_input", `${rel}: ${problem}. Nothing was saved.`);
  const lexical = path.resolve(root, rel);
  if (!inside(root, lexical)) throw new ToolError("invalid_input", `${rel} is outside ${root}. Nothing was saved.`);
  let real: string;
  try {
    real = await fs.realpath(lexical);
  } catch {
    throw new ToolError("invalid_input", `${rel} doesn't exist under ${root}. Nothing was saved.`);
  }
  if (!inside(root, real)) {
    throw new ToolError(
      "invalid_input",
      `${rel} is a link to ${real}, outside ${root}. PIVOT only reads files inside the design's folder. Nothing was saved.`,
    );
  }
  const targetProblem = refusedFileReason(path.relative(root, real).split(path.sep).join("/"));
  if (targetProblem) throw new ToolError("invalid_input", `${rel}: ${targetProblem}. Nothing was saved.`);
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new ToolError("invalid_input", `${rel} isn't a file. Nothing was saved.`);
  return { data: await fs.readFile(real), real };
}

/** The text of a code file, only when it is UTF-8 that turns back into the very same bytes. */
export function exactText(data: Buffer): string | null {
  const text = data.toString("utf8");
  return Buffer.from(text, "utf8").equals(data) ? text : null;
}

const TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  json: "application/json",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  hdr: "application/octet-stream",
  ktx2: "image/ktx2",
};

export const mimeOf = (p: string) => TYPES[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export const SHOT_EXT = /\.(png|jpe?g|webp)$/i;
export const VIDEO_EXT = /\.(mp4|webm)$/i;

/** A screenshot's viewport from its file name: phone-sized names are mobile, anything else desktop. */
export function viewportOf(p: string): "desktop" | "mobile" {
  return /(mobile|phone|iphone|android|\b(320|360|375|390|393|414|430)\b)/i.test(path.basename(p))
    ? "mobile"
    : "desktop";
}

/**
 * Reads a screenshot or video: relative paths are read like the design's files (inside `root`); an absolute path may
 * be anywhere (a screenshot the agent took in its scratchpad), but only an image or video by name, never a file that
 * can hold secrets. PIVOT checks it really is one.
 */
export async function readMedia(root: string, p: string, kind: "shot" | "video") {
  const ext = kind === "shot" ? SHOT_EXT : VIDEO_EXT;
  if (!ext.test(p)) {
    throw new ToolError(
      "invalid_input",
      `${p}: a ${kind === "shot" ? "screenshot is a PNG, JPEG or WebP" : "video is an MP4 or WebM"} file. Nothing was saved.`,
    );
  }
  if (!path.isAbsolute(p)) return (await readInside(root, p)).data;
  const reason = refusedFileReason(p.split(path.sep).filter(Boolean).join("/"));
  if (reason) throw new ToolError("invalid_input", `${p}: ${reason}. Nothing was saved.`);
  try {
    const real = await fs.realpath(p);
    if (!ext.test(real) || !(await fs.stat(real)).isFile()) throw new Error("not a media file");
    return await fs.readFile(real);
  } catch {
    throw new ToolError(
      "invalid_input",
      `${p} doesn't exist or isn't a ${kind === "shot" ? "screenshot" : "video"} file. Nothing was saved.`,
    );
  }
}

export interface PlannedWrite {
  path: string;
  data: Buffer;
}

export interface WriteResult {
  written: string[];
  /** Already there with the same bytes. */
  same: string[];
  /** Already there with other content: nothing was written. */
  differ: string[];
}

/**
 * Writes files under `dir` (a real path) at their relative paths, byte for byte. Checks every target first: when any
 * existing file has other content, or a target is a link or leaves the folder, nothing is written and those are
 * listed, so the owner decides. Files that are already identical are left alone.
 */
export async function writeInside(dir: string, files: PlannedWrite[]): Promise<WriteResult> {
  const result: WriteResult = { written: [], same: [], differ: [] };
  const todo: { target: string; file: PlannedWrite }[] = [];
  for (const file of files) {
    const problem = pathProblem(file.path);
    if (problem) throw new ToolError("invalid_input", `${file.path}: ${problem}. Nothing was written.`);
    const target = path.resolve(dir, file.path);
    if (!inside(dir, target))
      throw new ToolError("invalid_input", `${file.path} would leave ${dir}. Nothing was written.`);
    // the nearest folder that exists must still be inside, so a linked folder can't carry a file out
    let parent = path.dirname(target);
    for (;;) {
      try {
        const real = await fs.realpath(parent);
        if (!inside(dir, real)) {
          throw new ToolError(
            "invalid_input",
            `${file.path} would be written through a link out of ${dir}. Nothing was written.`,
          );
        }
        break;
      } catch (err) {
        if (err instanceof ToolError) throw err;
        parent = path.dirname(parent);
      }
    }
    let existing: Buffer | null = null;
    try {
      const st = await fs.lstat(target);
      if (st.isSymbolicLink() || !st.isFile()) {
        result.differ.push(file.path);
        continue;
      }
      existing = await fs.readFile(target);
    } catch {
      existing = null;
    }
    if (existing === null) todo.push({ target, file });
    else if (existing.equals(file.data)) result.same.push(file.path);
    else result.differ.push(file.path);
  }
  if (result.differ.length) return result;
  for (const { target, file } of todo) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // "wx": never replaces a file that appeared since the check
    await fs.writeFile(target, file.data, { flag: "wx" });
    result.written.push(file.path);
  }
  return result;
}
