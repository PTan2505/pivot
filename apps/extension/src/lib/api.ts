import type { CollectionDTO, ResourceDTO, ResourceType, TagDTO, TagKind } from "@pivot/core/types";

export interface Config {
  serverUrl: string;
  token: string;
}

export const DEFAULT_SERVER = "http://127.0.0.1:4321";

export async function getConfig(): Promise<Config> {
  const { serverUrl, token } = await chrome.storage.local.get(["serverUrl", "token"]);
  return { serverUrl: (serverUrl as string) || DEFAULT_SERVER, token: (token as string) || "" };
}

export async function setConfig(config: Config) {
  await chrome.storage.local.set({ serverUrl: config.serverUrl.replace(/\/+$/, ""), token: config.token.trim() });
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, config?: Config): Promise<T> {
  const { serverUrl, token } = config ?? (await getConfig());
  let res: Response;
  try {
    res = await fetch(`${serverUrl}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError("PIVOT isn’t running. Start it with `npm start`.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status);
  return data as T;
}

export const api = {
  /** Verifies reachability (GET) and the token (a harmless authenticated POST). */
  async check(config?: Config) {
    await request("/api/counts", {}, config);
    await request("/api/ping", { method: "POST" }, config);
  },
  /** Throws a 403 ApiError when the token is wrong, before anything is typed. */
  ping: () => request("/api/ping", { method: "POST" }),
  /** Is the page private without your login? (A guess made by the server, which has no cookies.) */
  visibility: (url: string) =>
    request<{ private: boolean | null; reason: string; appUrl: boolean }>(
      `/api/visibility?url=${encodeURIComponent(url)}`,
    ),
  /** What the server supports; a server from before this endpoint answers 404, which counts as nothing. */
  capabilities: () => request<{ apiVersion: number; features: string[] }>("/api/capabilities"),
  tags: () => request<TagDTO[]>("/api/tags"),
  collections: () => request<CollectionDTO[]>("/api/collections"),
  /** The newest 3 saves of the same page (with a thumbnail path when they have a cover) and how many in all. */
  lookup: (url: string) =>
    request<{ duplicates: Duplicate[]; total?: number }>(`/api/lookup?url=${encodeURIComponent(url)}`),
  /** A short list for the popup's Library tab: `q`, `url`, `host`, `sort` like the app's own list. */
  list: (params: { q?: string; url?: string; host?: string; sort?: string; limit?: number }) => {
    const sp = new URLSearchParams(
      Object.entries({ ...params, limit: String(params.limit ?? 8) }).filter(([, v]) => v) as [string, string][],
    );
    return request<ResourceDTO[]>(`/api/resources?${sp}`);
  },
  /** Quick edit after saving. `tags` replaces the item's tags and facets. */
  update: (id: string, patch: { title?: string; notes?: string; tags?: { kind: TagKind; name: string }[] }) =>
    request<ResourceDTO>(`/api/resources/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }),
  /** Saves picked assets onto a reference: image and SVG files, font names (no files), gradients. */
  extract: (
    id: string,
    body: {
      images?: { url: string }[];
      svgs?: { markup: string; name?: string }[];
      fonts?: { family: string; weight?: string; style?: string; src?: string }[];
      gradients?: string[];
    },
  ) =>
    request<{ saved: string[]; failed: { item: string; error: string }[]; fonts: number; gradients: number }>(
      `/api/resources/${id}/extract`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    ),
  addToCollection: (collectionId: string, ids: string[]) =>
    request("/api/resources/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "addToCollection", collectionId, ids }),
    }),
  removeFromCollection: (collectionId: string, ids: string[]) =>
    request("/api/resources/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "removeFromCollection", collectionId, ids }),
    }),
  clip: (data: ClipData, files: { screenshot?: Blob; image?: Blob; imageName?: string } = {}) => {
    const form = new FormData();
    form.set("data", JSON.stringify(data));
    if (files.screenshot) form.set("screenshot", files.screenshot, "view.jpg");
    if (files.image) form.set("image", files.image, files.imageName ?? "image.png");
    return request<{ id: string; path: string; existing?: boolean; replayed?: boolean; title?: string }>("/api/clip", {
      method: "POST",
      body: form,
    });
  },
};

export interface ClipData {
  kind: "page" | "image" | "selection";
  url: string;
  type?: ResourceType;
  title?: string;
  description?: string;
  notes?: string;
  text?: string;
  imageUrl?: string;
  tags?: { kind: TagKind; name: string }[];
  collectionId?: string;
  collectionIds?: string[];
  /** Quick saves go to the Inbox ("needs review"). */
  needsReview?: boolean;
  /** A part of the page saved as its own reference. */
  section?: SectionContext;
  /** Add the screenshot to this saved reference as an interaction state (named by `state`) instead of a new one. */
  attachTo?: string;
  state?: string;
  /** The page looked private: kept out of share packages. */
  privatePage?: boolean;
  /** The address bar's URL when it differs from the saved (canonical) one. */
  capturedUrl?: string;
  serverCapture?: boolean;
  /** Let the server capture click "Load more" buttons; off unless asked for. */
  expandContent?: boolean;
  /** "skip": when the page is already saved, return that one instead of saving it again. */
  ifExists?: "create" | "skip";
  /** Set from the offline queue's item id, so a resend never saves twice. */
  clientRequestId?: string;
}

export interface SectionContext {
  type: string;
  /** Where it sits on the page, in CSS pixels from the top of the document. */
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  scrollY?: number;
  /** A hint for finding it again; pages change, so it isn't relied on. */
  selector?: string;
  pageTitle?: string;
  method?: "select" | "crop" | "list";
}

export interface Duplicate {
  id: string;
  title: string;
  type: ResourceType;
  createdAt?: string;
  /** A path on the server (`/api/assets/…`), or null. */
  thumbnail?: string | null;
}

/** A server path as a full URL (thumbnails and covers in the popup). */
export async function serverUrlFor(path: string) {
  return `${(await getConfig()).serverUrl}${path}`;
}

export async function openInApp(path: string) {
  const { serverUrl } = await getConfig();
  await chrome.tabs.create({ url: `${serverUrl}${path}` });
}
