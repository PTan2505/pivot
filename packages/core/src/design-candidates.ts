import { asc, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "./db/client";
import { designCandidates, designSessions } from "./db/schema";
import { screenshotUrl } from "./capture";
import { DesignError } from "./design";
import { assertPublicUrl, safeFetch, UnsafeUrlError } from "./net-guard";
import { KNOWN_SOURCES } from "./known-sources";
import { getResource } from "./resources";
import { hostOf } from "./source-match";
import { storeFor, writeStore, type StorageKind } from "./storage";
import {
  DESIGN_REFERENCE_CATEGORIES,
  type DesignCandidateDTO,
  type DesignReferenceCategory,
  type ResourceType,
} from "./types";

/*
 * Gate 1 of a design session: the references proposed for the user to pick from, by number. Library references are
 * linked by id. External ones are real pages the agent found (a web search, a gallery, a component catalog): PIVOT
 * captures its own preview of each, so the user sees the page itself, not what an agent says about it. External
 * candidates belong to the session only; nothing is added to the library unless the user asks for it.
 */

export const CANDIDATE_LIMITS = { perSession: 30, perCall: 12, text: 1000, title: 200 } as const;
const PREVIEW_TIMEOUT_MS = 45_000;
/**
 * Image hosts a candidate's own preview image may come from (`previewImageUrl`): component catalogs that publish a
 * component-only preview, so the card shows the component instead of a capture of the whole catalog page.
 */
export const PREVIEW_IMAGE_HOSTS = ["cdn.21st.dev"] as const;
const PREVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_IMAGE_TIMEOUT_MS = 15_000;
const PREVIEW_IMAGE_MAX_WIDTH = 1440;

export interface CandidateInput {
  /** A library reference (from search_references). */
  resourceId?: string;
  /** An external page (http or https). */
  url?: string;
  title?: string;
  /** Where it was found, e.g. "web search", "land-book.com", "React Bits". */
  source?: string;
  /**
   * An external candidate's own component-only preview image (https, on a host in PREVIEW_IMAGE_HOSTS), e.g. the
   * `previewUrl` of a 21st.dev search result. PIVOT fetches it instead of capturing the page, and captures the page when
   * the image can't be used.
   */
  previewImageUrl?: string;
  /** A whole page or design ("layout"), or a single component ("component"); inferred when left out. */
  category?: DesignReferenceCategory;
  why: string;
  take?: string;
  avoid?: string;
}

/** Library types that hold a single component rather than a page or design. */
const COMPONENT_TYPES = new Set<ResourceType>(["library", "animation", "snippet"]);
/** Sites that publish components (the known sources in the "components" category: React Bits, shadcn/ui, Magic UI…). */
const COMPONENT_HOSTS = KNOWN_SOURCES.filter((s) => s.category === "components").flatMap((s) => [
  s.host,
  ...(s.aliases ?? []),
]);

const onHost = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/**
 * What a candidate shows when the agent didn't say: a library resource by its type, an external page by its site (a
 * component catalog, or anything else, which is taken as a page).
 */
export function inferCategory(c: { resourceType?: ResourceType | null; url?: string | null }): DesignReferenceCategory {
  if (c.resourceType) return COMPONENT_TYPES.has(c.resourceType) ? "component" : "layout";
  const host = hostOf(c.url);
  return host && COMPONENT_HOSTS.some((site) => onHost(host, site)) ? "component" : "layout";
}

const asCategory = (v: unknown): DesignReferenceCategory | null =>
  DESIGN_REFERENCE_CATEGORIES.includes(v as DesignReferenceCategory) ? (v as DesignReferenceCategory) : null;

/** Testing seam: the capture used for external previews, and the download of a candidate's own preview image. */
export const candidateDeps = {
  capture: async (url: string) =>
    (await screenshotUrl(url, { fullPage: false, timeoutMs: PREVIEW_TIMEOUT_MS })).viewport,
  /** The image's bytes and content type, through the network guard (every redirect hop must be public). */
  fetchImage: async (url: string): Promise<{ body: Buffer; contentType: string }> => {
    const { response, body } = await safeFetch(url, {
      accept: "image/*",
      maxBytes: PREVIEW_IMAGE_MAX_BYTES + 1,
      timeoutMs: PREVIEW_IMAGE_TIMEOUT_MS,
    });
    if (!response.ok) throw new Error(`The preview image answered HTTP ${response.status}.`);
    return { body, contentType: response.headers.get("content-type") ?? "" };
  },
};

/** A previewImageUrl as stored: https on an allowed image host, or an error saying why not. */
function checkPreviewImageUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new DesignError(`previewImageUrl "${input}" isn't a valid URL.`);
  }
  if (url.protocol !== "https:") throw new DesignError("previewImageUrl must be an https image.");
  if (!PREVIEW_IMAGE_HOSTS.some((h) => url.hostname.toLowerCase() === h))
    throw new DesignError(
      `previewImageUrl can only come from ${PREVIEW_IMAGE_HOSTS.join(", ")}; leave it out and PIVOT captures the page.`,
    );
  return url.href;
}

/** Downloads a candidate's own preview image and re-encodes it as PIVOT's WebP preview (first frame only). */
async function previewFromImage(url: string): Promise<Buffer> {
  // checked again here: the stored URL is the agent's, and the host list may have changed since it was proposed
  checkPreviewImageUrl(url);
  const { body, contentType } = await candidateDeps.fetchImage(url);
  if (!/^image\//i.test(contentType.trim()))
    throw new Error(`The preview image isn't an image (${contentType || "no type"}).`);
  if (!body.length) throw new Error("The preview image is empty.");
  if (body.length > PREVIEW_IMAGE_MAX_BYTES) throw new Error("The preview image is larger than 5 MB.");
  return sharp(body, { animated: false, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: PREVIEW_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

/** Only http(s) links are ever shown as a page link (a library resource's sourceUrl isn't checked when saved). */
const webUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

const clip = (s: unknown, max: number = CANDIDATE_LIMITS.text) =>
  String(s ?? "")
    .trim()
    .slice(0, max);

function toDTO(
  r: typeof designCandidates.$inferSelect,
  library: Map<string, { cover: string | null; type: ResourceType | null }>,
): DesignCandidateDTO {
  const external = !r.resourceId;
  const res = r.resourceId ? library.get(r.resourceId) : undefined;
  const coverId = res?.cover ?? null;
  return {
    id: r.id,
    n: r.n,
    kind: external ? "external" : "library",
    category: asCategory(r.category) ?? inferCategory({ resourceType: res?.type, url: r.url }),
    resourceId: r.resourceId,
    title: r.title,
    url: webUrl(r.url),
    source: r.source,
    why: r.why,
    take: r.take,
    avoid: r.avoid,
    previewUrl: external
      ? r.previewKey
        ? `/api/design/candidates/${r.id}/preview`
        : null
      : coverId
        ? `/api/assets/${coverId}?thumb=1`
        : null,
    previewKind: external && r.previewKey ? (r.previewKind === "image" ? "image" : "capture") : null,
    previewImageUrl: external ? r.previewImageUrl : null,
    previewError: r.previewError,
    previewStatus: !external
      ? coverId
        ? "ready"
        : "none"
      : r.previewKey
        ? "ready"
        : r.previewError
          ? "failed"
          : "pending",
    selected: r.selected,
    selectedWords: r.selectedWords,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listCandidates(sessionId: string): Promise<DesignCandidateDTO[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(designCandidates)
    .where(eq(designCandidates.sessionId, sessionId))
    .orderBy(asc(designCandidates.n));
  const library = new Map<string, { cover: string | null; type: ResourceType | null }>();
  for (const id of new Set(rows.flatMap((r) => (r.resourceId ? [r.resourceId] : [])))) {
    const res = await getResource(id);
    library.set(id, { cover: res?.coverAssetId ?? null, type: res?.type ?? null });
  }
  return rows.map((r) => toDTO(r, library));
}

async function exploringSession(sessionId: string) {
  const db = await getDb();
  const [s] = await db.select().from(designSessions).where(eq(designSessions.id, sessionId)).limit(1);
  if (!s) throw new DesignError("No such design session.");
  if (s.status !== "exploring")
    throw new DesignError("References can be proposed and picked only while the session is exploring.");
  return s;
}

/**
 * Adds candidates to a session, numbered after the existing ones. External pages are checked (public http/https only)
 * and captured one at a time; a page that can't be captured is still listed, with the reason instead of a preview.
 */
export async function addCandidates(
  sessionId: string,
  items: CandidateInput[],
  { wait = false }: { wait?: boolean } = {},
): Promise<DesignCandidateDTO[]> {
  await exploringSession(sessionId);
  if (!items.length) throw new DesignError("Propose at least one reference.");
  if (items.length > CANDIDATE_LIMITS.perCall)
    throw new DesignError(`Propose at most ${CANDIDATE_LIMITS.perCall} references at a time.`);
  const db = await getDb();
  const existing = await db
    .select({ n: designCandidates.n, resourceId: designCandidates.resourceId, url: designCandidates.url })
    .from(designCandidates)
    .where(eq(designCandidates.sessionId, sessionId));
  if (existing.length + items.length > CANDIDATE_LIMITS.perSession)
    throw new DesignError(`A session holds at most ${CANDIDATE_LIMITS.perSession} proposed references.`);

  let n = existing.reduce((m, r) => Math.max(m, r.n), 0);
  const seen = new Set(existing.map((r) => r.resourceId ?? r.url));
  const added: string[] = [];
  const captures: { id: string; url: string; imageUrl: string | null }[] = [];
  const rows: (typeof designCandidates.$inferInsert)[] = [];
  for (const item of items) {
    if (!!item.resourceId === !!item.url)
      throw new DesignError("Each reference needs either resourceId (library) or url (external), not both.");
    const why = clip(item.why);
    if (!why) throw new DesignError("Say why each reference fits (why).");
    if (item.category !== undefined && !asCategory(item.category))
      throw new DesignError(`category is "layout" or "component", not "${item.category}".`);
    if (item.previewImageUrl !== undefined && item.resourceId)
      throw new DesignError("previewImageUrl is for an external page (url); a library reference shows its own cover.");
    const previewImageUrl = item.previewImageUrl ? checkPreviewImageUrl(item.previewImageUrl) : null;
    let row: typeof designCandidates.$inferInsert;
    if (item.resourceId) {
      const r = await getResource(item.resourceId);
      if (!r || r.deletedAt) throw new DesignError(`No library reference ${item.resourceId}.`);
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      row = {
        sessionId,
        n: ++n,
        resourceId: r.id,
        title: clip(item.title || r.title, CANDIDATE_LIMITS.title),
        url: webUrl(r.sourceUrl),
        source: "library",
        category: item.category ?? inferCategory({ resourceType: r.type }),
        why,
        take: clip(item.take),
        avoid: clip(item.avoid),
      };
    } else {
      let url: URL;
      try {
        url = await assertPublicUrl(item.url!);
      } catch (err) {
        throw new DesignError(
          err instanceof UnsafeUrlError ? err.message : `"${item.url}" isn't a public http or https page.`,
        );
      }
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      row = {
        sessionId,
        n: ++n,
        resourceId: null,
        title: clip(item.title || url.hostname, CANDIDATE_LIMITS.title),
        url: url.href,
        source: clip(item.source || url.hostname, 120),
        category: item.category ?? inferCategory({ url: url.href }),
        why,
        take: clip(item.take),
        avoid: clip(item.avoid),
        previewImageUrl,
      };
    }
    rows.push(row);
  }
  // every item was checked before any is stored: one bad item stores nothing
  for (const row of rows) {
    const [inserted] = await db.insert(designCandidates).values(row).returning({ id: designCandidates.id });
    added.push(inserted.id);
    if (!row.resourceId) captures.push({ id: inserted.id, url: row.url!, imageUrl: row.previewImageUrl ?? null });
  }
  // previews are captured in the background, three at a time: a page can take tens of seconds, longer than a request
  const done = captureAll(sessionId, captures);
  if (wait) await done;
  else void done;
  return (await listCandidates(sessionId)).filter((c) => added.includes(c.id));
}

async function captureAll(sessionId: string, jobs: { id: string; url: string; imageUrl: string | null }[]) {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await capturePreview(sessionId, job);
    }),
  );
}

/**
 * Stores an external candidate's preview: its own preview image when it has one, else (or when that image can't be
 * used) PIVOT's capture of the page.
 */
async function capturePreview(
  sessionId: string,
  { id, url, imageUrl }: { id: string; url: string; imageUrl: string | null },
) {
  const db = await getDb();
  try {
    let image: Buffer | null = null;
    let kind: "image" | "capture" = "image";
    if (imageUrl) image = await previewFromImage(imageUrl).catch(() => null);
    if (!image) {
      image = await candidateDeps.capture(url);
      kind = "capture";
    }
    const store = writeStore();
    const key = `design-candidates/${sessionId}/${id}.webp`;
    await store.put(key, image, "image/webp");
    await db
      .update(designCandidates)
      .set({ previewKey: key, previewStorage: store.kind, previewKind: kind, previewError: null })
      .where(eq(designCandidates.id, id));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await db.update(designCandidates).set({ previewError: message }).where(eq(designCandidates.id, id));
  }
}

/** PIVOT's capture of an external candidate, or null. */
export async function candidatePreview(id: string): Promise<Buffer | null> {
  const db = await getDb();
  const [r] = await db.select().from(designCandidates).where(eq(designCandidates.id, id)).limit(1);
  if (!r?.previewKey || !r.previewStorage) return null;
  return storeFor(r.previewStorage as StorageKind).get(r.previewKey);
}

/**
 * Records the user's pick (gate 1): exactly these numbers become selected, the others not, with the user's own words.
 * Only the user picks; an agent records what they said, never a choice of its own.
 */
export async function selectCandidates(
  sessionId: string,
  { numbers, userWords }: { numbers: number[]; userWords: string },
): Promise<DesignCandidateDTO[]> {
  await exploringSession(sessionId);
  const words = clip(userWords, 2000);
  if (!words) throw new DesignError("Quote the user's own words for the pick (userWords).");
  const want = [...new Set(numbers)];
  if (!want.length) throw new DesignError("Pick at least one reference by number.");
  const all = await listCandidates(sessionId);
  const unknown = want.filter((n) => !all.some((c) => c.n === n));
  if (unknown.length) throw new DesignError(`No proposed reference numbered ${unknown.join(", ")} in this session.`);
  const db = await getDb();
  await db
    .update(designCandidates)
    .set({
      selected: sql`${designCandidates.n} in (${sql.join(
        want.map((n) => sql`${n}`),
        sql`, `,
      )})`,
      selectedWords: words,
    })
    .where(eq(designCandidates.sessionId, sessionId));
  return (await listCandidates(sessionId)).filter((c) => c.selected);
}
