import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { designCandidates, designSessions } from "./db/schema";
import { screenshotUrl } from "./capture";
import { DesignError } from "./design";
import { assertPublicUrl, UnsafeUrlError } from "./net-guard";
import { getResource } from "./resources";
import { storeFor, writeStore, type StorageKind } from "./storage";
import type { DesignCandidateDTO } from "./types";

/*
 * Gate 1 of a design session: the references proposed for the user to pick from, by number. Library references are
 * linked by id. External ones are real pages the agent found (a web search, a gallery, a component catalog): PIVOT
 * captures its own preview of each, so the user sees the page itself, not what an agent says about it. External
 * candidates belong to the session only; nothing is added to the library unless the user asks for it.
 */

export const CANDIDATE_LIMITS = { perSession: 30, perCall: 12, text: 1000, title: 200 } as const;
const PREVIEW_TIMEOUT_MS = 45_000;

export interface CandidateInput {
  /** A library reference (from search_references). */
  resourceId?: string;
  /** An external page (http or https). */
  url?: string;
  title?: string;
  /** Where it was found, e.g. "web search", "land-book.com", "React Bits". */
  source?: string;
  why: string;
  take?: string;
  avoid?: string;
}

/** Testing seam: the capture used for external previews. */
export const candidateDeps = {
  capture: async (url: string) =>
    (await screenshotUrl(url, { fullPage: false, timeoutMs: PREVIEW_TIMEOUT_MS })).viewport,
};

const clip = (s: unknown, max: number = CANDIDATE_LIMITS.text) =>
  String(s ?? "")
    .trim()
    .slice(0, max);

function toDTO(r: typeof designCandidates.$inferSelect, cover: Map<string, string | null>): DesignCandidateDTO {
  const external = !r.resourceId;
  const coverId = r.resourceId ? cover.get(r.resourceId) : null;
  return {
    id: r.id,
    n: r.n,
    kind: external ? "external" : "library",
    resourceId: r.resourceId,
    title: r.title,
    url: r.url,
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
  const cover = new Map<string, string | null>();
  for (const id of new Set(rows.flatMap((r) => (r.resourceId ? [r.resourceId] : []))))
    cover.set(id, (await getResource(id))?.coverAssetId ?? null);
  return rows.map((r) => toDTO(r, cover));
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
  const captures: { id: string; url: string }[] = [];
  for (const item of items) {
    if (!!item.resourceId === !!item.url)
      throw new DesignError("Each reference needs either resourceId (library) or url (external), not both.");
    const why = clip(item.why);
    if (!why) throw new DesignError("Say why each reference fits (why).");
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
        url: r.sourceUrl,
        source: "library",
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
        why,
        take: clip(item.take),
        avoid: clip(item.avoid),
      };
    }
    const [inserted] = await db.insert(designCandidates).values(row).returning({ id: designCandidates.id });
    added.push(inserted.id);
    if (!row.resourceId) captures.push({ id: inserted.id, url: row.url! });
  }
  // previews are captured in the background, three at a time: a page can take tens of seconds, longer than a request
  const done = captureAll(sessionId, captures);
  if (wait) await done;
  else void done;
  return (await listCandidates(sessionId)).filter((c) => added.includes(c.id));
}

async function captureAll(sessionId: string, jobs: { id: string; url: string }[]) {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await capturePreview(sessionId, job.id, job.url);
    }),
  );
}

async function capturePreview(sessionId: string, id: string, url: string) {
  const db = await getDb();
  try {
    const image = await candidateDeps.capture(url);
    const store = writeStore();
    const key = `design-candidates/${sessionId}/${id}.webp`;
    await store.put(key, image, "image/webp");
    await db
      .update(designCandidates)
      .set({ previewKey: key, previewStorage: store.kind, previewError: null })
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
