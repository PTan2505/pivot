import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getAsset, listResourceAssets, materializeAsset, readAssetBytes } from "./assets";
import { expandHome, skillsDir } from "./config";
import { getResourcesByIds } from "./resources";
import type { SkillMeta } from "./skills";
import { estimateImageTokens, estimateTextTokens, scaledImageSize, CLAUDE_MAX_IMAGE_EDGE } from "./tokens";
import { TAG_KIND_LABELS, TAG_KINDS, TYPE_DEFS, type AssetDTO, type ResourceDTO } from "./types";

export interface ContextOptions {
  includeFullScreenshots?: boolean;
}

export interface TokenEstimate {
  text: number;
  images: number;
  total: number;
  imageCount: number;
}

interface PlannedAsset {
  asset: AssetDTO;
  /** Path written into context.md (absolute for clipboard, relative for exports). */
  ref: string;
}

const LANG_EXT: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  css: "css",
  scss: "scss",
  html: "html",
  python: "py",
  py: "py",
  json: "json",
  markdown: "md",
  md: "md",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  vue: "vue",
  svelte: "svelte",
  swift: "swift",
  kotlin: "kt",
  go: "go",
  rust: "rs",
  sql: "sql",
};

export function slugify(s: string, fallback = "item") {
  const slug = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function uniqueName(base: string, ext: string, used: Set<string>) {
  let name = `${base}${ext}`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}${ext}`;
  used.add(name);
  return name;
}

function fence(content: string, lang = "") {
  const ticks = content.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${content.replace(/\s+$/, "")}\n${ticks}`;
}

function relevantAssets(assets: AssetDTO[], opts: ContextOptions) {
  return assets.filter(
    (a) => !a.missing && (a.role !== "screenshot-full" || opts.includeFullScreenshots) && a.kind !== "font",
  );
}

function sectionFor(r: ResourceDTO, index: number, planned: PlannedAsset[], fileRef: string | null) {
  const def = TYPE_DEFS[r.type];
  const lines: string[] = [`## ${index}. ${r.title} — ${def.label}`, ""];
  const facts: string[] = [];
  if (r.sourceUrl) facts.push(`- **Source:** ${r.sourceUrl}`);
  for (const kind of TAG_KINDS) {
    const names = r.tags.filter((t) => t.kind === kind).map((t) => t.name);
    if (names.length) facts.push(`- **${TAG_KIND_LABELS[kind]}:** ${names.join(", ")}`);
  }
  const meta = r.meta as Record<string, unknown>;
  if (typeof meta.purpose === "string" && meta.purpose) facts.push(`- **Purpose:** ${meta.purpose}`);
  if (Array.isArray(meta.fonts) && meta.fonts.length) facts.push(`- **Fonts:** ${meta.fonts.join(", ")}`);
  if (Array.isArray(meta.colors) && meta.colors.length)
    facts.push(`- **Colors:** ${meta.colors.map((c) => `\`${c}\``).join(" ")}`);
  if (typeof meta.whenToUse === "string" && meta.whenToUse) facts.push(`- **When to use:** ${meta.whenToUse}`);
  if (facts.length) lines.push(...facts, "");
  if (r.description) lines.push(r.description.trim(), "");
  if (r.notes.trim()) lines.push("**Notes**", "", r.notes.trim(), "");

  if (r.type === "skill") {
    const skillName = (meta as SkillMeta).skillName;
    const ref = fileRef ?? (skillName ? path.join(skillsDir(), skillName, "SKILL.md") : null);
    if (ref) lines.push(`**Skill file:** \`${ref}\` — read it before starting.`, "");
  } else if (fileRef) {
    lines.push(`**File:** \`${fileRef}\``, "");
  } else if (r.content.trim()) {
    const content = r.content;
    if (def.content === "code") lines.push(fence(content, String(meta.language ?? "")), "");
    else if (def.content === "json") lines.push(fence(content, "json"), "");
    else lines.push(fence(content, "markdown"), "");
  }

  if (planned.length) {
    lines.push("**Assets**", "");
    for (const p of planned) {
      const dims = p.asset.width && p.asset.height ? ` (${p.asset.width}×${p.asset.height})` : "";
      const label = p.asset.role === "attachment" ? p.asset.kind : p.asset.role.replace("-", " ");
      lines.push(`- \`${p.ref}\` — ${label}${dims}${p.asset.notes ? `: ${p.asset.notes}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function header(count: number) {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "# UI Context",
    "",
    `> ${count} resource${count === 1 ? "" : "s"} from PIVOT, ${date}. Use them as references for the task — match the patterns, styles and rules described, and open the listed assets to see them.`,
    "",
  ].join("\n");
}

function estimate(markdown: string, planned: PlannedAsset[]): TokenEstimate {
  const images = planned.filter(
    (p) => (p.asset.kind === "image" || p.asset.kind === "svg") && p.asset.width && p.asset.height,
  );
  const imageTokens = images.reduce((sum, p) => sum + estimateImageTokens(p.asset.width!, p.asset.height!), 0);
  const text = estimateTextTokens(markdown);
  return { text, images: imageTokens, total: text + imageTokens, imageCount: images.length };
}

/** Markdown for the clipboard: absolute asset paths so Claude Code can open them directly. */
export async function buildClipboardContext(resourceIds: string[], opts: ContextOptions = {}) {
  const items = await getResourcesByIds(resourceIds);
  const sections: string[] = [];
  const allPlanned: PlannedAsset[] = [];
  for (const [i, r] of items.entries()) {
    const assets = relevantAssets(await listResourceAssets(r.id), opts);
    const planned: PlannedAsset[] = [];
    for (const a of assets) {
      const row = await getAsset(a.id);
      if (!row) continue;
      // R2 files are downloaded to a local cache so Claude Code can open them by path.
      const local = await materializeAsset(row);
      if (!local) continue;
      planned.push({ asset: a, ref: local });
    }
    allPlanned.push(...planned);
    sections.push(sectionFor(r, i + 1, planned, null));
  }
  const markdown = [header(items.length), ...sections].join("\n");
  return { markdown, tokens: estimate(markdown, allPlanned) };
}

export interface ExportOptions extends ContextOptions {
  resourceIds: string[];
  targetDir: string;
  bundleName: string;
  resizeImages?: boolean;
}

async function pathExists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function writeAsset(data: Buffer, dest: string, asset: AssetDTO, resize: boolean) {
  const resizable = asset.kind === "image" && asset.mimeType !== "image/gif";
  if (
    resize &&
    resizable &&
    asset.width &&
    asset.height &&
    Math.max(asset.width, asset.height) > CLAUDE_MAX_IMAGE_EDGE
  ) {
    const s = scaledImageSize(asset.width, asset.height);
    await sharp(data).resize({ width: s.width, height: s.height }).toFile(dest);
    return { ...asset, width: s.width, height: s.height };
  }
  await fs.writeFile(dest, data);
  return asset;
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

/** Writes a self-contained bundle folder: context.md plus prompts, skills, rules… and copied assets. */
export async function exportBundle(opts: ExportOptions) {
  const raw = opts.targetDir.trim();
  if (!raw.startsWith("~") && !path.isAbsolute(raw)) throw new Error("Choose an absolute folder path.");
  const base = path.resolve(expandHome(raw));
  await fs.mkdir(base, { recursive: true });

  const bundleSlug = slugify(opts.bundleName, "ui-context");
  let root = path.join(/* turbopackIgnore: true */ base, bundleSlug);
  for (let i = 2; await pathExists(root); i++) root = path.join(base, `${bundleSlug}-${i}`);
  await fs.mkdir(root, { recursive: true });

  const items = await getResourcesByIds(opts.resourceIds);
  const usedAssetNames = new Set<string>();
  const usedFileNames = new Map<string, Set<string>>();
  const sections: string[] = [];
  const allPlanned: PlannedAsset[] = [];
  let fileCount = 0;

  for (const [i, r] of items.entries()) {
    const def = TYPE_DEFS[r.type];
    const slug = slugify(r.title);
    const meta = r.meta as Record<string, unknown>;

    // Assets → assets/<slug>.<ext>
    const planned: PlannedAsset[] = [];
    for (const a of relevantAssets(await listResourceAssets(r.id), opts)) {
      const row = await getAsset(a.id);
      const data = row && (await readAssetBytes(row));
      if (!row || !data) continue;
      const ext = path.extname(row.storagePath);
      const suffix = a.role === "screenshot-full" ? "-full" : "";
      const name = uniqueName(`${slug}${suffix}`, ext, usedAssetNames);
      await fs.mkdir(path.join(root, "assets"), { recursive: true });
      const written = await writeAsset(data, path.join(root, "assets", name), a, !!opts.resizeImages);
      fileCount++;
      planned.push({ asset: written, ref: `assets/${name}` });
    }
    allPlanned.push(...planned);

    // Text content → <exportDir>/<slug>.<ext>
    let fileRef: string | null = null;
    if (r.type === "skill") {
      const skillName = String((meta as SkillMeta).skillName ?? slug);
      const dest = path.join(root, "skills", skillName);
      const realPath = (meta as SkillMeta).realPath;
      if (realPath && (await pathExists(realPath))) await copyDir(realPath, dest);
      await fs.mkdir(dest, { recursive: true });
      await fs.writeFile(path.join(dest, "SKILL.md"), r.content, "utf8");
      fileRef = `skills/${skillName}/SKILL.md`;
      fileCount++;
    } else if (r.content.trim() && def.content !== "none") {
      const ext =
        def.content === "json"
          ? ".json"
          : def.content === "code"
            ? `.${LANG_EXT[String(meta.language ?? "").toLowerCase()] ?? "txt"}`
            : ".md";
      const used = usedFileNames.get(def.exportDir) ?? new Set<string>();
      usedFileNames.set(def.exportDir, used);
      const name = uniqueName(slug, ext, used);
      await fs.mkdir(path.join(root, def.exportDir), { recursive: true });
      const body = def.content === "markdown" ? `# ${r.title}\n\n${r.content.trim()}\n` : r.content;
      await fs.writeFile(path.join(root, def.exportDir, name), body, "utf8");
      fileRef = `${def.exportDir}/${name}`;
      fileCount++;
    }

    sections.push(sectionFor(r, i + 1, planned, fileRef));
  }

  const markdown = [header(items.length), ...sections].join("\n");
  await fs.writeFile(path.join(root, "context.md"), markdown, "utf8");
  fileCount++;
  return { path: root, fileCount, tokens: estimate(markdown, allPlanned) };
}
