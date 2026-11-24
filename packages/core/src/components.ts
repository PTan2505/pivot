// Components saved with their code (docs/component-store-plan.md). A component the user picked in a design session
// is saved right after its code is fetched from 21st.dev (status "fetched") and again once it is built into a project
// ("built"), so the next use reads it from PIVOT and spends no 21st retrieval. PIVOT scans the code on every save; the
// scan flags, it never blocks or edits. Nothing here fetches anything from 21st: the agent passes what it retrieved.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { filesSha, MAX_FLAGS, NPM_NAME, NPM_VERSION, relativePath, scanFiles, SECRET_PATTERNS } from "./code-files";
import { getDb } from "./db/client";
import { resources } from "./db/schema";
import { getResource, setResourceTags } from "./resources";
import {
  COMPONENT_FILE_ROLES,
  COMPONENT_PROVIDERS,
  COMPONENT_STATUSES,
  LICENCE_SOURCES,
  REVIEW_VERDICTS,
  TAG_KINDS,
  type ComponentFile,
  type ComponentMeta,
  type ComponentOrigin,
  type ComponentScan,
  type ComponentScanFlag,
  type ResourceDetailDTO,
  type TagKind,
} from "./types";

/** Input PIVOT can't take: a bad URL, a secret, too much code. The API answers 400. */
export class ComponentError extends Error {}
/** A save that would replace code PIVOT already holds, without `replaceCode`. The API answers 409. */
export class ComponentConflictError extends Error {}

export const COMPONENT_LIMITS = { files: 30, fileBytes: 500_000, totalBytes: 1_000_000, deps: 60 } as const;
export const SCAN_VERSION = 1;
export const API_KEY_PLACEHOLDER = "$API_KEY_21ST";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const httpsOn = (hosts: string[]) =>
  z
    .string()
    .url()
    .max(2000)
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
        } catch {
          return false;
        }
      },
      `must be an https link on ${hosts.join(" or ")}`,
    );

const filePath = relativePath;

export const componentInput = z.object({
  provider: z.enum(COMPONENT_PROVIDERS),
  providerId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  pageUrl: httpsOn(["21st.dev"]),
  author: z.object({
    username: z.string().trim().min(1).max(100),
    name: z.string().trim().max(200).optional(),
    url: z.string().url().max(2000).startsWith("https://").optional(),
  }),
  licence: z.object({
    spdx: z.string().trim().max(60).optional(),
    name: z.string().trim().max(200).optional(),
    source: z.enum(LICENCE_SOURCES),
  }),
  files: z
    .array(
      z.object({
        path: filePath,
        role: z.enum(COMPONENT_FILE_ROLES),
        language: z.string().trim().min(1).max(20),
        code: z.string().max(COMPONENT_LIMITS.fileBytes),
      }),
    )
    .min(1)
    .max(COMPONENT_LIMITS.files),
  npmDependencies: z
    .array(
      z.object({
        name: z.string().regex(NPM_NAME, "isn't an npm package name"),
        version: z.string().regex(NPM_VERSION, "must be a registry version or range").optional(),
      }),
    )
    .max(COMPONENT_LIMITS.deps)
    .optional(),
  registryDependencies: z.array(z.string().trim().min(1).max(300)).max(COMPONENT_LIMITS.deps).optional(),
  installCommand: z.string().trim().max(1000).optional(),
  previewImageUrl: httpsOn(["cdn.21st.dev"]).optional(),
  videoUrl: httpsOn(["cdn.21st.dev"]).optional(),
  sessionId: z.string().regex(UUID).optional(),
  candidateId: z.string().regex(UUID).optional(),
  candidateN: z.number().int().min(1).optional(),
  project: z.string().trim().max(200).optional(),
  facets: z
    .array(z.object({ kind: z.enum(TAG_KINDS), name: z.string().trim().min(1).max(80) }))
    .max(20)
    .optional(),
  notes: z.string().max(5000).optional(),
  replaceCode: z.boolean().optional(),
  status: z.enum(COMPONENT_STATUSES),
  review: z
    .object({
      verdict: z.enum(REVIEW_VERDICTS),
      notes: z.string().trim().min(1).max(5000),
      userWords: z.string().trim().min(1).max(2000).optional(),
    })
    .refine((r) => r.verdict !== "concerns_accepted" || !!r.userWords, {
      message: "concerns_accepted needs the user's own words (userWords), quoted exactly",
      path: ["userWords"],
    })
    .optional(),
});
export type ComponentInput = z.infer<typeof componentInput>;

// ---- install command -------------------------------------------------------------------------------------------

/**
 * The install command as PIVOT keeps it: any `api_key=` value becomes the placeholder `$API_KEY_21ST`, and a command
 * that still holds something like a credential is refused (never stored, never echoed back).
 */
export function sanitizeInstallCommand(cmd: string): string {
  const out = cmd.replace(
    /([?&]api_key=)("?)[^\s&"']*/gi,
    (_m, key: string, q: string) => `${key}${q}${API_KEY_PLACEHOLDER}`,
  );
  if (SECRET_PATTERNS.some((p) => p.test(out))) {
    throw new ComponentError(
      "The install command seems to hold a secret (a key or token). Pass it with the placeholder $API_KEY_21ST instead; nothing was saved.",
    );
  }
  return out;
}

// ---- the scan --------------------------------------------------------------------------------------------------

const INSTALL_OK =
  /^npx\s+shadcn@(latest|[0-9][0-9A-Za-z.-]*)\s+add\s+"?https:\/\/21st\.dev\/r\/[\w@.~/-]+(\?api_key=\$API_KEY_21ST)?"?$/;
const REGISTRY_HOSTS = ["21st.dev", "ui.shadcn.com"];

/** sha256 of the component and demo files, in path order. Support files are left out. */
export function componentCodeSha(files: Pick<ComponentFile, "path" | "role" | "code">[]) {
  return filesSha(files.filter((f) => f.role !== "support"));
}

/**
 * What a reviewer should look at before this code goes into a project: network use and hosts, code run from strings,
 * reaching beyond the component, obfuscation, an unusual install command or registry. Flags only: it never blocks.
 */
export function scanComponent(c: {
  files: ComponentFile[];
  installCommand?: string;
  registryDependencies?: string[];
}): ComponentScan {
  const { flags, hosts } = scanFiles(c.files);
  const add = (f: ComponentScanFlag) => flags.length < MAX_FLAGS && flags.push(f);
  if (c.installCommand && !INSTALL_OK.test(c.installCommand)) {
    add({
      kind: "install-command",
      what: 'not the usual `npx shadcn@latest add "https://21st.dev/r/…"`',
      file: "installCommand",
      line: 0,
      excerpt: c.installCommand.slice(0, 160),
    });
  }
  for (const dep of c.registryDependencies ?? []) {
    let ok = /^[a-z0-9][a-z0-9-]*$/.test(dep);
    if (!ok && /^https:\/\//.test(dep)) {
      try {
        const h = new URL(dep).hostname;
        ok = REGISTRY_HOSTS.some((r) => h === r || h.endsWith(`.${r}`));
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      add({
        kind: "registry",
        what: "a registry outside 21st.dev and shadcn/ui",
        file: "registryDependencies",
        line: 0,
        excerpt: dep.slice(0, 160),
      });
    }
  }
  return { version: SCAN_VERSION, codeSha256: componentCodeSha(c.files), flags, hosts };
}

// ---- save and look up ------------------------------------------------------------------------------------------

/** "<author>/<component>/<demo>" from a 21st CDN preview URL. */
function slugFrom(previewImageUrl?: string) {
  if (!previewImageUrl) return undefined;
  try {
    const parts = new URL(previewImageUrl).pathname.split("/").filter(Boolean);
    return parts.length >= 4 ? parts.slice(0, 3).join("/") : undefined;
  } catch {
    return undefined;
  }
}

const mainFile = (files: ComponentFile[]) => files.find((f) => f.role === "component") ?? files[0];

export const componentOf = (r: { meta: Record<string, unknown> }) =>
  (r.meta?.component ?? null) as ComponentMeta | null;

/**
 * What may leave PIVOT about a component (Share package, Export, copied context): where it is, who made it and its
 * licence. Never its code, demo or 21st's media: the code is the author's, kept here for the owner's own reuse.
 */
export function componentCredit(c: ComponentMeta): string[] {
  const licence = c.licence.spdx || c.licence.name || "unknown";
  return [
    `**Original:** ${c.pageUrl}`,
    `**Author:** ${c.author.name ? `${c.author.name} (@${c.author.username})` : `@${c.author.username}`}`,
    `**Licence:** ${licence}`,
  ];
}

/** The newest saved (not trashed) component with this provider id. */
async function findRow(provider: string, providerId: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.type, "component"),
        isNull(resources.deletedAt),
        sql`${resources.meta}->'component'->>'provider' = ${provider}`,
        sql`${resources.meta}->'component'->>'providerId' = ${String(providerId)}`,
      ),
    )
    .orderBy(desc(resources.updatedAt))
    .limit(1);
  return row ?? null;
}

export type SaveOutcome = "created" | "updated" | "unchanged";

/**
 * Saves a component, or adds to the one already saved with this provider id. A repeat save adds where it was used,
 * its support files, the review and the "built" status, and fills what is empty; it never changes the title, notes or
 * facets the owner has (facets are only added), and refuses different code unless `replaceCode` is set.
 */
export async function saveComponent(raw: unknown): Promise<{ outcome: SaveOutcome; resource: ResourceDetailDTO }> {
  const input = componentInput.parse(raw);
  const total = input.files.reduce((n, f) => n + Buffer.byteLength(f.code), 0);
  if (total > COMPONENT_LIMITS.totalBytes) {
    throw new ComponentError(`The files add up to ${total} bytes; a component holds at most 1 MB.`);
  }
  const paths = new Set<string>();
  for (const f of input.files) {
    if (paths.has(f.path)) throw new ComponentError(`The file ${f.path} is listed twice.`);
    paths.add(f.path);
  }
  if (!input.files.some((f) => f.role === "component")) {
    throw new ComponentError('At least one file must have role "component".');
  }
  const installCommand = input.installCommand ? sanitizeInstallCommand(input.installCommand) : undefined;
  const now = new Date().toISOString();
  const codeSha256 = componentCodeSha(input.files);
  const origin: ComponentOrigin = {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
    ...(input.candidateN ? { candidateN: input.candidateN } : {}),
    ...(input.project ? { project: input.project } : {}),
    status: input.status,
    savedAt: now,
  };
  const review = input.review ? { ...input.review, codeSha256, reviewedAt: now } : undefined;
  const db = await getDb();
  const existing = await findRow(input.provider, input.providerId);

  if (!existing) {
    const files: ComponentFile[] = input.files;
    const meta: ComponentMeta = {
      provider: input.provider,
      providerId: input.providerId,
      ...(slugFrom(input.previewImageUrl) ? { slug: slugFrom(input.previewImageUrl) } : {}),
      pageUrl: input.pageUrl,
      author: input.author,
      licence: input.licence,
      files,
      npmDependencies: input.npmDependencies ?? [],
      registryDependencies: input.registryDependencies ?? [],
      ...(installCommand ? { installCommand } : {}),
      ...(input.previewImageUrl ? { previewImageUrl: input.previewImageUrl } : {}),
      ...(input.videoUrl ? { videoUrl: input.videoUrl } : {}),
      codeSha256,
      status: input.status,
      fetchedAt: now,
      origins: [origin],
      scan: scanComponent({ files, installCommand, registryDependencies: input.registryDependencies }),
      ...(review ? { review } : {}),
    };
    const [row] = await db
      .insert(resources)
      .values({
        type: "component",
        title: input.name,
        sourceUrl: input.pageUrl,
        notes: input.notes ?? "",
        content: mainFile(files).code,
        meta: { component: meta },
      })
      .returning();
    if (input.facets?.length) await setResourceTags(row.id, input.facets as { kind: TagKind; name: string }[]);
    return { outcome: "created", resource: (await getResource(row.id))! };
  }

  const current = componentOf(existing as { meta: Record<string, unknown> });
  if (!current) throw new ComponentError("This component's saved data is unreadable.");
  const codeChanged = codeSha256 !== current.codeSha256;
  if (codeChanged && !input.replaceCode) {
    throw new ComponentConflictError(
      `PIVOT already holds different code for this component (saved ${current.fetchedAt.slice(0, 10)}). Use the saved code (get_saved_component), or pass replaceCode: true only if the user asked to refresh it.`,
    );
  }
  // support files: the ones given replace those with the same path; component and demo files come from the code kept
  const given = new Map(input.files.map((f) => [f.path, f]));
  const files: ComponentFile[] = codeChanged
    ? [...input.files, ...current.files.filter((f) => f.role === "support" && !given.has(f.path))]
    : [
        ...current.files.filter((f) => f.role !== "support"),
        ...current.files.filter((f) => f.role === "support" && !given.has(f.path)),
        ...input.files.filter((f) => f.role === "support"),
      ];
  const next: ComponentMeta = {
    ...current,
    slug: current.slug ?? slugFrom(input.previewImageUrl),
    licence:
      current.licence.source === "unknown" && input.licence.source !== "unknown" ? input.licence : current.licence,
    files,
    npmDependencies:
      codeChanged || !current.npmDependencies.length
        ? (input.npmDependencies ?? current.npmDependencies)
        : current.npmDependencies,
    registryDependencies:
      codeChanged || !current.registryDependencies.length
        ? (input.registryDependencies ?? current.registryDependencies)
        : current.registryDependencies,
    installCommand:
      current.installCommand && !codeChanged ? current.installCommand : (installCommand ?? current.installCommand),
    previewImageUrl: current.previewImageUrl ?? input.previewImageUrl,
    videoUrl: current.videoUrl ?? input.videoUrl,
    codeSha256,
    status: current.status === "built" && !codeChanged ? "built" : input.status,
    fetchedAt: codeChanged ? now : current.fetchedAt,
    origins: [...current.origins, origin].slice(-50),
    review: review ?? (codeChanged ? undefined : current.review),
    preview: codeChanged ? undefined : current.preview,
  };
  next.scan = scanComponent({
    files,
    installCommand: next.installCommand,
    registryDependencies: next.registryDependencies,
  });
  for (const k of Object.keys(next) as (keyof ComponentMeta)[]) if (next[k] === undefined) delete next[k];

  const unchanged =
    !codeChanged &&
    JSON.stringify({ ...current, origins: [], scan: null }) === JSON.stringify({ ...next, origins: [], scan: null });
  await db
    .update(resources)
    .set({
      meta: { ...(existing.meta ?? {}), component: next },
      content: mainFile(files).code,
      ...(unchanged ? {} : { updatedAt: new Date() }),
    })
    .where(eq(resources.id, existing.id));
  if (input.facets?.length) {
    const have = (await getResource(existing.id))!.tags;
    const merged = [...have.map((t) => ({ kind: t.kind, name: t.name }))];
    for (const f of input.facets) {
      if (!merged.some((t) => t.kind === f.kind && t.name.toLowerCase() === f.name.toLowerCase())) merged.push(f);
    }
    await setResourceTags(existing.id, merged as { kind: TagKind; name: string }[]);
  }
  return { outcome: unchanged ? "unchanged" : "updated", resource: (await getResource(existing.id))! };
}

export const lookupInput = z
  .object({
    provider: z.enum(COMPONENT_PROVIDERS).default("21st"),
    providerId: z.coerce.number().int().positive().optional(),
    pageUrl: z.string().url().max(2000).optional(),
    resourceId: z.string().regex(UUID).optional(),
  })
  .refine((v) => v.providerId || v.pageUrl || v.resourceId, "Give providerId, pageUrl or resourceId.");

const samePage = (a: string, b: string) => {
  const norm = (u: string) => {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  };
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
};

/** A saved component by its 21st id, its 21st page or its PIVOT id; null when PIVOT doesn't hold it. */
export async function findComponent(raw: unknown): Promise<ResourceDetailDTO | null> {
  const q = lookupInput.parse(raw);
  if (q.resourceId) {
    const r = await getResource(q.resourceId);
    return r && r.type === "component" && !r.deletedAt ? r : null;
  }
  if (q.providerId) {
    const row = await findRow(q.provider, q.providerId);
    return row ? getResource(row.id) : null;
  }
  const db = await getDb();
  const rows = await db
    .select({ id: resources.id, meta: resources.meta, sourceUrl: resources.sourceUrl })
    .from(resources)
    .where(and(eq(resources.type, "component"), isNull(resources.deletedAt)))
    .orderBy(desc(resources.updatedAt));
  const hit = rows.find((r) => {
    const c = componentOf(r as { meta: Record<string, unknown> });
    return c?.provider === q.provider && samePage(c.pageUrl, q.pageUrl!);
  });
  return hit ? getResource(hit.id) : null;
}
