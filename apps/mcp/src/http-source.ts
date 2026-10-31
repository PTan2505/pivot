import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolError, type PivotSource, type PivotWriter } from "@pivot/mcp-tools/source";
import type {
  CollectionDTO,
  DesignSessionDetailDTO,
  DesignSessionDTO,
  ResourceDetailDTO,
  ResourceDTO,
  ResourceType,
  SearchPage,
  SearchRequest,
  TagDTO,
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

  private async call(pathAndQuery: string, init: RequestInit = {}): Promise<Response | null> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${pathAndQuery}`, {
        ...init,
        headers: { ...init.headers, ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ToolError(
        "app_unreachable",
        `PIVOT isn't answering at ${this.base}. Start it with \`npm start\` in the PIVOT folder, then try again.`,
      );
    }
    if (res.status === 403) {
      throw new ToolError(
        "unauthorized",
        "PIVOT refused the write: the API token is missing or wrong. Set PIVOT_TOKEN to the token in PIVOT › Settings.",
      );
    }
    if (res.status === 404) return null;
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

  getResource(id: string) {
    return this.json<ResourceDetailDTO>(`/api/resources/${encodeURIComponent(id)}`);
  }

  async listTags() {
    return (await this.json<TagDTO[]>("/api/tags")) ?? [];
  }

  async listCollections() {
    return (await this.json<CollectionDTO[]>("/api/collections")) ?? [];
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

  recordDesignDecision(sessionId: string, input: Parameters<PivotWriter["recordDesignDecision"]>[1]) {
    return this.post<{ id: string }>(`/api/design/sessions/${encodeURIComponent(sessionId)}/decisions`, input);
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

  async getImage(assetId: string, variant: "thumb" | "original") {
    const res = await this.call(`/api/assets/${encodeURIComponent(assetId)}${variant === "thumb" ? "?thumb=1" : ""}`);
    if (!res) throw new ToolError("no_images", "That screenshot is missing from storage.");
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/webp" };
  }
}
