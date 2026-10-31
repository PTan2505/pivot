import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolError, type PivotSource } from "@pivot/mcp-tools/source";
import type {
  CollectionDTO,
  ResourceDetailDTO,
  ResourceDTO,
  ResourceType,
  SearchPage,
  SearchRequest,
  TagDTO,
} from "@pivot/core/types";

/** The API token the extension also uses (`~/.pivot/api-token`), unless PIVOT_TOKEN is set. Reads don't need it today. */
function readToken() {
  if (process.env.PIVOT_TOKEN) return process.env.PIVOT_TOKEN.trim();
  try {
    return fs.readFileSync(path.join(os.homedir(), ".pivot", "api-token"), "utf8").trim();
  } catch {
    return "";
  }
}

/** PivotSource over the running PIVOT app's HTTP API, so the app keeps its own database, storage and access rules. */
export class HttpSource implements PivotSource {
  private token = readToken();

  constructor(private base = (process.env.PIVOT_URL ?? "http://127.0.0.1:4321").replace(/\/+$/, "")) {}

  private async call(pathAndQuery: string): Promise<Response | null> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${pathAndQuery}`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ToolError(
        "app_unreachable",
        `PIVOT isn't answering at ${this.base}. Start it with \`npm start\` in the PIVOT folder, then try again.`,
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

  async getImage(assetId: string, variant: "thumb" | "original") {
    const res = await this.call(`/api/assets/${encodeURIComponent(assetId)}${variant === "thumb" ? "?thumb=1" : ""}`);
    if (!res) throw new ToolError("no_images", "That screenshot is missing from storage.");
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "image/webp" };
  }
}
