import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appOutdated, missingAppFeatures, REQUIRED_APP_FEATURES, UPDATE_APP } from "@pivot/mcp-tools/app-compat";
import type { ImagePart, PageSlices } from "@pivot/mcp-tools/images";
import { ToolError, type PivotSource, type PivotWriter } from "@pivot/mcp-tools/source";
import type {
  DesignCandidateDTO,
  DesignFeedbackDTO,
  CollectionDTO,
  DesignSessionDetailDTO,
  DesignQaInput,
  DesignStatus,
  DesignSessionDTO,
  ResourceDetailDTO,
  ResourceDTO,
  ResourceType,
  DirectProviderId,
  ExternalSearchPage,
  SearchPage,
  SearchRequest,
  SourceCategory,
  TagDTO,
  UiSettings,
} from "@pivot/core/types";

/**
 * The API token the extension also uses (`<data dir>/api-token`, `~/.pivot` by default), unless PIVOT_TOKEN is set.
 * Reads don't need it; every write does.
 */
function readToken() {
  if (process.env.PIVOT_TOKEN) return process.env.PIVOT_TOKEN.trim();
  const dir = process.env.PIVOT_DATA_DIR?.replace(/^~(?=$|\/)/, os.homedir()) || path.join(os.homedir(), ".pivot");
  try {
    return fs.readFileSync(path.join(dir, "api-token"), "utf8").trim();
  } catch {
    return "";
  }
}

/** PivotSource over the running PIVOT app's HTTP API, so the app keeps its own database, storage and access rules. */
export class HttpSource implements PivotSource, PivotWriter {
  private token = readToken();

  constructor(private base = (process.env.PIVOT_URL ?? "http://127.0.0.1:4321").replace(/\/+$/, "")) {}

  get appUrl() {
    return this.base;
  }

  private unreachable() {
    return new ToolError(
      "app_unreachable",
      `PIVOT isn't answering at ${this.base}. Start it with \`npx pivot-studio\` (or \`npm start\` in a PIVOT checkout), then try again.`,
    );
  }

  /** Set once the app has shown every feature the tools need; checked again after a failure, so an update is seen. */
  private compatible = false;

  /**
   * Refuses to call an app older than this server (`app_outdated`), instead of letting its missing routes look like
   * missing items. An answer that isn't clear (a server error) doesn't block the call.
   */
  private async checkApp() {
    if (this.compatible) return;
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/capabilities`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      throw this.unreachable();
    }
    // every PIVOT that has the features this server needs has /api/capabilities
    if (res.status === 404) throw appOutdated(this.base, REQUIRED_APP_FEATURES);
    if (!res.ok) return;
    const missing = missingAppFeatures(await res.json().catch(() => null));
    if (missing.length) throw appOutdated(this.base, missing);
    this.compatible = true;
  }

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Response | null> {
    await this.checkApp();
    let res: Response;
    try {
      res = await fetch(`${this.base}${pathAndQuery}`, {
        ...init,
        headers: { ...init.headers, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw this.unreachable();
    }
    if (res.status === 403) {
      throw new ToolError(
        "unauthorized",
        "PIVOT refused the write: the API token is missing or wrong. Set PIVOT_TOKEN to the token in PIVOT › Settings.",
      );
    }
    if (res.status === 404) return null;
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ToolError("conflict", body.error ?? "PIVOT refused the change in its current state.");
    }
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      throw new ToolError(
        body.code === "invalid_cursor" ? "invalid_cursor" : "invalid_input",
        body.error ?? "Bad request.",
      );
    }
    if (!res.ok) throw new Error(`PIVOT answered ${res.status} for ${pathAndQuery.split("?")[0]}.`);
    return res;
  }

  private async json<T>(pathAndQuery: string): Promise<T | null> {
    const res = await this.call(pathAndQuery);
    return res ? ((await res.json()) as T) : null;
  }

  async search(req: SearchRequest): Promise<SearchPage> {
    const sp = new URLSearchParams({ paged: "1" });
    if (req.query) sp.set("q", req.query);
    if (req.types?.length) sp.set("types", req.types.join(","));
    if (req.section) sp.set("section", req.section);
    for (const f of req.facets ?? []) sp.append("facet", `${f.kind}:${f.name}`);
    if (req.collectionId) sp.set("collection", req.collectionId);
    if (req.sourceId) sp.set("via", req.sourceId);
    if (req.sort) sp.set("sort", req.sort);
    if (req.limit) sp.set("limit", String(req.limit));
    if (req.cursor) sp.set("cursor", req.cursor);
    return (await this.json<SearchPage>(`/api/resources?${sp}`))!;
  }

  /** Null when the app predates hybrid search (no such route). */
  externalSearch(req: { query: string; providers?: DirectProviderId[]; limit?: number; category?: SourceCategory }) {
    const sp = new URLSearchParams({ q: req.query });
    if (req.category) sp.set("category", req.category);
    if (req.providers?.length) sp.set("providers", req.providers.join(","));
    if (req.limit) sp.set("limit", String(req.limit));
    return this.json<ExternalSearchPage>(`/api/search/external?${sp}`);
  }

  getResource(id: string) {
    return this.json<ResourceDetailDTO>(`/api/resources/${encodeURIComponent(id)}`);
  }

  async listTags() {
    return (await this.json<TagDTO[]>("/api/tags")) ?? [];
  }

  async listCollections() {
    return (await this.json<CollectionDTO[]>("/api/collections")) ?? [];
  }

  /** An app from before the setting (no such route) hides nothing. */
  async uiSettings(): Promise<UiSettings> {
    return (await this.json<UiSettings>("/api/settings/ui")) ?? { showOtherTypes: true };
  }

  async counts() {
    return (await this.json<Partial<Record<ResourceType, number>>>("/api/counts")) ?? {};
  }

  async listSources() {
    return (await this.json<ResourceDTO[]>("/api/resources?type=source")) ?? [];
  }

  private async post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const res = await this.call(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res) throw new ToolError("not_found", "PIVOT has no such item.");
    return (await res.json()) as T;
  }

  saveDesignBrief(input: Parameters<PivotWriter["saveDesignBrief"]>[0]) {
    return this.post<Awaited<ReturnType<PivotWriter["saveDesignBrief"]>>>("/api/design/briefs", input);
  }

  approveInChat(sessionId: string, input: Parameters<NonNullable<PivotWriter["approveInChat"]>>[1]) {
    return this.post<{ id: string; sessionId: string }>(
      `/api/design/sessions/${encodeURIComponent(sessionId)}/chat-approval`,
      input,
    );
  }

  recordDesignDecision(sessionId: string, input: Parameters<PivotWriter["recordDesignDecision"]>[1]) {
    return this.post<{ id: string }>(`/api/design/sessions/${encodeURIComponent(sessionId)}/decisions`, input);
  }

  saveDesignMockups(sessionId: string, input: Parameters<PivotWriter["saveDesignMockups"]>[1]) {
    return this.post<Awaited<ReturnType<PivotWriter["saveDesignMockups"]>>>(
      `/api/design/sessions/${encodeURIComponent(sessionId)}/mockups`,
      input,
    );
  }

  proposeReferences(sessionId: string, candidates: Parameters<NonNullable<PivotWriter["proposeReferences"]>>[1]) {
    return this.post<{ candidates: DesignCandidateDTO[] }>(
      `/api/design/sessions/${encodeURIComponent(sessionId)}/candidates`,
      { candidates },
    );
  }

  async listCandidates(sessionId: string) {
    return (
      (
        await this.json<{ candidates: DesignCandidateDTO[] }>(
          `/api/design/sessions/${encodeURIComponent(sessionId)}/candidates`,
        )
      )?.candidates ?? []
    );
  }

  selectReferences(sessionId: string, input: { numbers: number[]; userWords: string }) {
    return this.post<{ selected: DesignCandidateDTO[] }>(
      `/api/design/sessions/${encodeURIComponent(sessionId)}/candidates/select`,
      input,
    );
  }

  async getCandidatePreview(candidateId: string) {
    const res = await this.call(`/api/design/candidates/${encodeURIComponent(candidateId)}/preview`);
    if (!res) return null;
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/webp" };
  }

  recordDesignQa(sessionId: string, input: DesignQaInput) {
    return this.post<{ id: string }>(`/api/design/sessions/${encodeURIComponent(sessionId)}/qa`, input);
  }

  setDesignStatus(sessionId: string, status: DesignStatus) {
    return this.post<DesignSessionDetailDTO>(
      `/api/design/sessions/${encodeURIComponent(sessionId)}`,
      { status },
      "PATCH",
    );
  }

  getDesignSession(id: string) {
    return this.json<DesignSessionDetailDTO>(`/api/design/sessions/${encodeURIComponent(id)}`);
  }

  async listDesignSessions(targetProject?: string) {
    const q = targetProject ? `?project=${encodeURIComponent(targetProject)}` : "";
    return (await this.json<{ sessions: DesignSessionDTO[] }>(`/api/design/sessions${q}`))?.sessions ?? [];
  }

  addSuggestions(resourceId: string, suggestions: Parameters<PivotWriter["addSuggestions"]>[1]) {
    return this.post<Awaited<ReturnType<PivotWriter["addSuggestions"]>>>(
      `/api/resources/${encodeURIComponent(resourceId)}/suggestions`,
      { suggestions },
    );
  }

  annotate(resourceId: string, note: string) {
    return this.post<{ line: string }>(`/api/resources/${encodeURIComponent(resourceId)}/annotate`, { note });
  }

  async findComponent(q: { provider: "21st"; providerId?: number; pageUrl?: string; resourceId?: string }) {
    const sp = new URLSearchParams({ provider: q.provider });
    if (q.providerId) sp.set("id", String(q.providerId));
    if (q.pageUrl) sp.set("url", q.pageUrl);
    if (q.resourceId) sp.set("resourceId", q.resourceId);
    return this.json<ResourceDetailDTO>(`/api/components/lookup?${sp}`);
  }

  async saveComponent(input: Record<string, unknown>) {
    const res = await this.call("/api/components", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res) {
      throw new ToolError(
        "app_outdated",
        `The PIVOT app at ${this.base} can't hold components yet. ${UPDATE_APP} Then call save_component again.`,
      );
    }
    return (await res.json()) as { outcome: "created" | "updated" | "unchanged"; resource: ResourceDetailDTO };
  }

  /** Through the extension's endpoint, so duplicates, the Inbox and the background capture work the same way. */
  async saveReference(input: Parameters<PivotWriter["saveReference"]>[0]) {
    const form = new FormData();
    form.set(
      "data",
      JSON.stringify({
        kind: "page",
        url: input.url,
        type: input.type,
        title: input.title,
        notes: input.notes,
        tags: input.tags,
        collectionIds: input.collectionIds,
        serverCapture: true,
        needsReview: true,
        ifExists: "skip",
      }),
    );
    const res = await this.call("/api/clip", { method: "POST", body: form });
    if (!res) throw new ToolError("not_found", "PIVOT has no clip endpoint.");
    return (await res.json()) as { id: string; path: string; existing?: boolean; title?: string };
  }

  /** The app shrinks the screenshot; an app from before that route answers 404. */
  getFeedback(id: string) {
    return this.json<DesignFeedbackDTO>(`/api/design/feedback/${encodeURIComponent(id)}`);
  }

  async feedbackPinImage(feedbackId: string, index: number) {
    const res = await this.call(`/api/design/feedback/${encodeURIComponent(feedbackId)}/pins/${index}`);
    if (!res) return null;
    const [left, top, width, height] = (res.headers.get("x-region") ?? "0,0,0,0").split(",").map(Number);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mimeType: "image/jpeg" as const,
      width: Number(res.headers.get("x-image-width")) || 0,
      height: Number(res.headers.get("x-image-height")) || 0,
      region: { left, top, width, height },
    };
  }

  async agentImage(assetId: string): Promise<ImagePart> {
    const res = await this.call(`/api/assets/${encodeURIComponent(assetId)}/agent`);
    if (!res) throw missingImage();
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mimeType: "image/jpeg",
      width: Number(res.headers.get("x-image-width")) || 0,
      height: Number(res.headers.get("x-image-height")) || 0,
    };
  }

  async agentSlices(assetId: string, from: number, count: number): Promise<PageSlices> {
    const page = await this.json<
      Omit<PageSlices, "slices"> & { slices: (Omit<PageSlices["slices"][number], "data"> & { data: string })[] }
    >(`/api/assets/${encodeURIComponent(assetId)}/agent?slices=1&from=${from}&count=${count}`);
    if (!page) throw missingImage();
    return { ...page, slices: page.slices.map((s) => ({ ...s, data: Buffer.from(s.data, "base64") })) };
  }
}

/** The screenshot is gone, or PIVOT predates `/api/assets/[id]/agent`. */
function missingImage() {
  return new ToolError(
    "no_images",
    "PIVOT couldn't prepare that screenshot: it is missing from storage, or PIVOT is older than this MCP server (update PIVOT).",
  );
}
