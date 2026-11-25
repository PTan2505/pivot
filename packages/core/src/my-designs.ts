// The owner's own designs, saved to be rebuilt exactly (docs/my-designs-plan.md). A design the owner liked, whoever made
// it (the owner or Claude), is saved when the owner asks: its exact code files, the tokens and dependencies it relies
// on, usage notes, its non-code files (SVG, fonts, models) and screenshots of how it looked. Reuse writes the same bytes
// back into a project. PIVOT scans the code on every save; the scan flags, it never blocks. Files that can hold secrets
// and code holding a credential are refused.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attachAsset,
  deleteOrphanAssets,
  detachAsset,
  getAsset,
  listResourceAssets,
  readAssetBytes,
  saveAsset,
} from "./assets";
import {
  findSecretLine,
  filesSha,
  NPM_NAME,
  NPM_VERSION,
  refusedFileReason,
  relativePath,
  scanFiles,
} from "./code-files";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { getResource, setResourceFields, setResourceTags } from "./resources";
import {
  MY_DESIGN_FILE_ROLES,
  MY_DESIGN_KINDS,
  TAG_KINDS,
  type AssetRole,
  type MyDesignAsset,
  type MyDesignFile,
  type MyDesignMeta,
  type ResourceDetailDTO,
  type TagKind,
} from "./types";
import { zipFiles, type ZipEntry } from "./zip";

/** Input PIVOT can't take: a refused file, a secret, too much code. The API answers 400. */
export class MyDesignError extends Error {}
/** A save that would replace code PIVOT already holds, without `replaceCode`. The API answers 409. */
export class MyDesignConflictError extends Error {}

export const MY_DESIGN_LIMITS = {
  files: 80,
  fileBytes: 1_000_000,
  totalBytes: 4_000_000,
  deps: 80,
  /** Each non-code file, screenshot or video. */
  assetBytes: 25 * 1024 * 1024,
  /** Everything stored for one design besides its code. */
  totalAssetBytes: 100 * 1024 * 1024,
  assets: 60,
  shots: 12,
  videos: 3,
} as const;
export const MY_DESIGN_SCAN_VERSION = 1;
export const MY_DESIGN_ASSET_ROLES = ["design-asset", "design-shot", "design-video"] as const satisfies AssetRole[];
export type MyDesignAssetRole = (typeof MY_DESIGN_ASSET_ROLES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LANGUAGES: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  vue: "vue",
  svelte: "svelte",
  json: "json",
  md: "md",
  mdx: "mdx",
  glsl: "glsl",
  frag: "glsl",
  vert: "glsl",
  svg: "svg",
  txt: "text",
};

/** A file's language from its extension ("text" when unknown). */
export function languageOf(p: string) {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[ext] ?? "text";
}

/** A relative path PIVOT will store: well formed, and not a file that can hold secrets. */
const storedPath = relativePath.refine((p) => !refusedFileReason(p), {
  message: "is a file PIVOT never stores (environment files, keys, node_modules, .git)",
});

export const myDesignInput = z.object({
  /** Update this saved design instead of creating one. */
  id: z.string().regex(UUID).optional(),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(MY_DESIGN_KINDS),
  files: z
    .array(
      z.object({
        path: storedPath,
        role: z.enum(MY_DESIGN_FILE_ROLES),
        language: z.string().trim().min(1).max(20).optional(),
        code: z.string().max(MY_DESIGN_LIMITS.fileBytes),
      }),
    )
    .min(1)
    .max(MY_DESIGN_LIMITS.files),
  dependencies: z
    .array(
      z.object({
        name: z.string().regex(NPM_NAME, "isn't an npm package name"),
        version: z.string().regex(NPM_VERSION, "must be a registry version or range"),
      }),
    )
    .max(MY_DESIGN_LIMITS.deps)
    .optional(),
  install: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  usage: z.string().trim().min(1).max(20_000),
  tokens: z
    .array(
      z.object({
        name: z.string().regex(/^--[A-Za-z0-9_-]{1,100}$/, "must be a CSS custom property like --color-ink"),
        value: z.string().trim().max(500),
      }),
    )
    .max(400)
    .optional(),
  source: z
    .object({
      project: z.string().trim().max(200).optional(),
      folder: z.string().trim().max(500).optional(),
      paths: z.array(z.string().trim().min(1).max(300)).max(MY_DESIGN_LIMITS.files).optional(),
      sessionId: z.string().regex(UUID).optional(),
      mockupId: z.string().regex(UUID).optional(),
    })
    .optional(),
  facets: z
    .array(z.object({ kind: z.enum(TAG_KINDS), name: z.string().trim().min(1).max(80) }))
    .max(20)
    .optional(),
  notes: z.string().max(5000).optional(),
  replaceCode: z.boolean().optional(),
});
export type MyDesignInput = z.infer<typeof myDesignInput>;

export const myDesignOf = (r: { meta: Record<string, unknown> | null }) =>
  (r.meta?.myDesign ?? null) as MyDesignMeta | null;

const mainFile = (files: MyDesignFile[]) =>
  files.find((f) => f.role === "component") ?? files.find((f) => f.role === "demo") ?? files[0];

/** Checks a set of files and returns them with their language filled in. Throws MyDesignError. */
function checkFiles(files: MyDesignInput["files"]): MyDesignFile[] {
  const total = files.reduce((n, f) => n + Buffer.byteLength(f.code), 0);
  if (total > MY_DESIGN_LIMITS.totalBytes) {
    throw new MyDesignError(`The files add up to ${total} bytes; a saved design holds at most 4 MB of code.`);
  }
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) throw new MyDesignError(`The file ${f.path} is listed twice.`);
    seen.add(f.path);
    const line = findSecretLine(f.code);
    if (line) {
      throw new MyDesignError(
        `${f.path} line ${line} seems to hold a credential (a key or token). Move it out of the code before saving; nothing was saved.`,
      );
    }
  }
  if (!files.some((f) => f.role === "component" || f.role === "demo")) {
    throw new MyDesignError('At least one file must have role "component" or "demo".');
  }
  return files.map((f) => ({ path: f.path, role: f.role, language: f.language ?? languageOf(f.path), code: f.code }));
}

function scanOf(files: MyDesignFile[]) {
  const { flags, hosts } = scanFiles(files);
  return { version: MY_DESIGN_SCAN_VERSION, codeSha256: filesSha(files), flags, hosts };
}

async function liveRow(id: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(resources)
    .where(and(eq(resources.id, id), eq(resources.type, "my_design"), isNull(resources.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function mergeFacets(id: string, facets: MyDesignInput["facets"]) {
  if (!facets?.length) return;
  const have = (await getResource(id))!.tags;
  const merged = have.map((t) => ({ kind: t.kind, name: t.name }));
  for (const f of facets) {
    if (!merged.some((t) => t.kind === f.kind && t.name.toLowerCase() === f.name.toLowerCase())) merged.push(f);
  }
  await setResourceTags(id, merged as { kind: TagKind; name: string }[]);
}

export type MyDesignOutcome = "created" | "updated" | "unchanged";

/**
 * Saves one of the owner's designs, or updates the one with `id`. An update refuses different code unless
 * `replaceCode` is set; it replaces the usage, tokens, dependencies and install steps it is given, adds the session,
 * and never changes the title or notes the owner has (facets are only added).
 */
export async function saveMyDesign(raw: unknown): Promise<{ outcome: MyDesignOutcome; resource: ResourceDetailDTO }> {
  const input = myDesignInput.parse(raw);
  const files = checkFiles(input.files);
  const codeSha256 = filesSha(files);
  const now = new Date().toISOString();
  const db = await getDb();

  if (!input.id) {
    const meta: MyDesignMeta = {
      kind: input.kind,
      files,
      dependencies: input.dependencies ?? [],
      install: input.install ?? [],
      usage: input.usage,
      tokens: input.tokens ?? [],
      source: {
        ...(input.source?.project ? { project: input.source.project } : {}),
        ...(input.source?.folder ? { folder: input.source.folder } : {}),
        ...(input.source?.paths?.length ? { paths: input.source.paths } : {}),
        ...(input.source?.sessionId ? { sessionIds: [input.source.sessionId] } : {}),
        ...(input.source?.mockupId ? { mockupId: input.source.mockupId } : {}),
      },
      assets: [],
      codeSha256,
      scan: scanOf(files),
      savedAt: now,
      codeSavedAt: now,
    };
    const [row] = await db
      .insert(resources)
      .values({
        type: "my_design",
        title: input.name,
        notes: input.notes ?? "",
        content: mainFile(files).code,
        meta: { myDesign: meta },
      })
      .returning();
    if (input.facets?.length) await setResourceTags(row.id, input.facets as { kind: TagKind; name: string }[]);
    return { outcome: "created", resource: (await getResource(row.id))! };
  }

  const existing = await liveRow(input.id);
  if (!existing) throw new MyDesignError("There is no saved design with that id.");
  const current = myDesignOf(existing);
  if (!current) throw new MyDesignError("This design's saved data is unreadable.");
  const codeChanged = codeSha256 !== current.codeSha256;
  if (codeChanged && !input.replaceCode) {
    throw new MyDesignConflictError(
      `PIVOT already holds different code for this design (saved ${current.codeSavedAt.slice(0, 10)}). Pass replaceCode: true only if the owner asked to replace it.`,
    );
  }
  const sessionIds = [
    ...new Set([...(current.source.sessionIds ?? []), ...(input.source?.sessionId ? [input.source.sessionId] : [])]),
  ];
  const next: MyDesignMeta = {
    ...current,
    kind: input.kind,
    files: codeChanged ? files : current.files,
    dependencies: input.dependencies ?? current.dependencies,
    install: input.install ?? current.install,
    usage: input.usage,
    tokens: input.tokens ?? current.tokens,
    source: {
      ...current.source,
      ...(input.source?.project ? { project: input.source.project } : {}),
      ...(input.source?.folder ? { folder: input.source.folder } : {}),
      ...(input.source?.paths?.length ? { paths: input.source.paths } : {}),
      ...(sessionIds.length ? { sessionIds } : {}),
      ...(input.source?.mockupId ? { mockupId: input.source.mockupId } : {}),
    },
    codeSha256,
    scan: codeChanged ? scanOf(files) : current.scan,
    codeSavedAt: codeChanged ? now : current.codeSavedAt,
  };
  const unchanged = JSON.stringify(current) === JSON.stringify(next);
  await db
    .update(resources)
    .set({
      meta: { ...(existing.meta ?? {}), myDesign: next },
      content: mainFile(next.files).code,
      ...(!existing.notes && input.notes ? { notes: input.notes } : {}),
      ...(unchanged ? {} : { updatedAt: new Date() }),
    })
    .where(eq(resources.id, existing.id));
  await mergeFacets(existing.id, input.facets);
  return { outcome: unchanged ? "unchanged" : "updated", resource: (await getResource(existing.id))! };
}

// ---- non-code files, screenshots and videos --------------------------------------------------------------------

export interface MyDesignUpload {
  data: Buffer;
  fileName: string;
  mimeType?: string;
  role: MyDesignAssetRole;
  /** For a design-asset: where it goes, relative to the design's files (e.g. public/logo.svg). */
  path?: string;
  /** For a design-shot: desktop or mobile. */
  viewport?: "desktop" | "mobile";
}

const VIDEO_TYPES = /^video\//;

/**
 * Adds a non-code file (written back to its path on reuse), a screenshot or a video to a saved design. A design-asset at
 * a path already used replaces the file there. The first screenshot becomes the cover.
 */
export async function addMyDesignAsset(id: string, upload: MyDesignUpload): Promise<ResourceDetailDTO> {
  const row = await liveRow(id);
  const current = row && myDesignOf(row);
  if (!row || !current) throw new MyDesignError("There is no saved design with that id.");
  if (upload.data.byteLength > MY_DESIGN_LIMITS.assetBytes) {
    throw new MyDesignError(`${upload.fileName} is ${upload.data.byteLength} bytes; a file can be at most 25 MB.`);
  }
  let assetPath: string | undefined;
  if (upload.role === "design-asset") {
    const parsed = storedPath.safeParse(upload.path ?? "");
    if (!parsed.success) {
      throw new MyDesignError(
        `A design file needs the relative path it goes to (e.g. public/logo.svg): ${parsed.error.issues[0]?.message ?? "missing"}.`,
      );
    }
    assetPath = parsed.data;
  }
  const attached = (await listResourceAssets(id)).filter((a) =>
    (MY_DESIGN_ASSET_ROLES as readonly string[]).includes(a.role),
  );
  const replacing = assetPath ? current.assets.find((a) => a.path === assetPath) : undefined;
  const used = attached.reduce((n, a) => n + (a.id === replacing?.assetId ? 0 : a.size), 0);
  if (used + upload.data.byteLength > MY_DESIGN_LIMITS.totalAssetBytes) {
    throw new MyDesignError("This design's files, screenshots and videos would pass 100 MB; nothing was added.");
  }
  const count = (role: string) => attached.filter((a) => a.role === role).length;
  if (upload.role === "design-asset" && !replacing && current.assets.length >= MY_DESIGN_LIMITS.assets) {
    throw new MyDesignError(`A saved design holds at most ${MY_DESIGN_LIMITS.assets} files besides its code.`);
  }
  if (upload.role === "design-shot" && count("design-shot") >= MY_DESIGN_LIMITS.shots) {
    throw new MyDesignError(`A saved design holds at most ${MY_DESIGN_LIMITS.shots} screenshots.`);
  }
  if (upload.role === "design-video" && count("design-video") >= MY_DESIGN_LIMITS.videos) {
    throw new MyDesignError(`A saved design holds at most ${MY_DESIGN_LIMITS.videos} videos.`);
  }

  const asset = await saveAsset({
    data: upload.data,
    fileName: upload.fileName,
    mimeType: upload.mimeType,
    meta: upload.viewport ? { viewport: upload.viewport } : undefined,
  });
  if (upload.role === "design-shot" && asset.kind !== "image") {
    await deleteOrphanAssets([asset.id]);
    throw new MyDesignError("A screenshot has to be an image (PNG, JPEG or WebP).");
  }
  if (upload.role === "design-video" && !(asset.kind === "video" || VIDEO_TYPES.test(asset.mimeType))) {
    await deleteOrphanAssets([asset.id]);
    throw new MyDesignError("A video has to be a video file (MP4 or WebM).");
  }
  await attachAsset(id, asset.id, upload.role);

  if (assetPath) {
    const entry: MyDesignAsset = { path: assetPath, assetId: asset.id, sha256: asset.sha256, size: asset.size };
    const assets = [...current.assets.filter((a) => a.path !== assetPath), entry].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const db = await getDb();
    await db
      .update(resources)
      .set({ meta: { ...(row.meta ?? {}), myDesign: { ...current, assets } }, updatedAt: new Date() })
      .where(eq(resources.id, id));
    // the file the path held before, when no other path of this design still uses it
    if (replacing && replacing.assetId !== asset.id && !assets.some((a) => a.assetId === replacing.assetId)) {
      await detachAsset(id, replacing.assetId);
    }
  }
  if (upload.role === "design-shot" && !row.coverAssetId) await setResourceFields(id, { coverAssetId: asset.id });
  return (await getResource(id))!;
}

// ---- look up ---------------------------------------------------------------------------------------------------

export const myDesignLookup = z
  .object({ id: z.string().regex(UUID).optional(), name: z.string().trim().min(1).max(200).optional() })
  .refine((v) => v.id || v.name, "Give id or name.");

/** A saved design by its PIVOT id, or by its name (exact, any case; the newest when several share it). */
export async function findMyDesign(raw: unknown): Promise<ResourceDetailDTO | null> {
  const q = myDesignLookup.parse(raw);
  if (q.id) {
    const r = await getResource(q.id);
    return r && r.type === "my_design" && !r.deletedAt ? r : null;
  }
  const db = await getDb();
  const [row] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.type, "my_design"),
        isNull(resources.deletedAt),
        sql`lower(${resources.title}) = ${q.name!.toLowerCase()}`,
      ),
    )
    .orderBy(desc(resources.updatedAt))
    .limit(1);
  return row ? getResource(row.id) : null;
}

/**
 * What may leave PIVOT about a saved design besides its title, notes and usage notes (Share package, Export, copied
 * context). Never the code: reuse goes through `get_my_design`.
 */
export function myDesignCredit(d: MyDesignMeta): string[] {
  return [`**Kind:** ${d.kind}`];
}

// ---- download as zip ---------------------------------------------------------------------------------------------

/** The name of a design's archive: its title as a file name. */
export const archiveName = (title: string) =>
  `${
    title
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "design"
  }.zip`;

/** The notes that go with the files: usage, install steps, exact dependencies and tokens, as Markdown. */
export function myDesignNotes(title: string, d: MyDesignMeta) {
  const out = [`# ${title}`, "", ...myDesignCredit(d), ""];
  if (d.dependencies.length) {
    out.push("## Dependencies", "", ...d.dependencies.map((x) => `- ${x.name}@${x.version}`), "");
  }
  if (d.install.length) out.push("## Install", "", ...d.install.map((s, i) => `${i + 1}. ${s}`), "");
  if (d.tokens.length) out.push("## Tokens", "", ...d.tokens.map((t) => `- \`${t.name}\`: \`${t.value}\``), "");
  out.push("## Usage", "", d.usage.trim(), "");
  return out.join("\n");
}

/**
 * A saved design as a zip: its code files and non-code files at their paths, byte for byte, and `_pivot/` with the
 * notes (usage, install, dependencies, tokens) and the screenshots. Only the owner downloads it, from its page.
 */
export async function myDesignArchive(id: string): Promise<{ fileName: string; data: Buffer }> {
  const row = await liveRow(id);
  const d = row && myDesignOf(row);
  if (!row || !d) throw new MyDesignError("There is no saved design with that id.");
  const entries: ZipEntry[] = d.files.map((f) => ({ path: f.path, data: Buffer.from(f.code, "utf8") }));
  const taken = new Set(d.files.map((f) => f.path));
  for (const a of d.assets) {
    const asset = await getAsset(a.assetId);
    const data = asset && (await readAssetBytes(asset));
    if (data && !taken.has(a.path)) {
      entries.push({ path: a.path, data });
      taken.add(a.path);
    }
  }
  entries.push({ path: "_pivot/USAGE.md", data: Buffer.from(myDesignNotes(row.title, d), "utf8") });
  const shots = (await listResourceAssets(id)).filter((a) => a.role === "design-shot" || a.role === "design-video");
  for (const [i, s] of shots.entries()) {
    const asset = await getAsset(s.id);
    const data = asset && (await readAssetBytes(asset));
    const viewport = (s.meta as { viewport?: string } | null)?.viewport;
    const ext = s.fileName.includes(".") ? s.fileName.slice(s.fileName.lastIndexOf(".")) : "";
    const label = viewport ?? (s.role === "design-video" ? "video" : "shot");
    if (data) entries.push({ path: `_pivot/screenshots/${i + 1}-${label}${ext}`, data });
  }
  return { fileName: archiveName(row.title), data: zipFiles(entries) };
}
