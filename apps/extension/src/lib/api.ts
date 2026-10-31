import type { CollectionDTO, ResourceType, TagDTO, TagKind } from "@pivot/core/types";

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
  tags: () => request<TagDTO[]>("/api/tags"),
  collections: () => request<CollectionDTO[]>("/api/collections"),
  lookup: (url: string) =>
    request<{ duplicates: { id: string; title: string; type: ResourceType }[] }>(
      `/api/lookup?url=${encodeURIComponent(url)}`,
    ),
  clip: (data: ClipData, files: { screenshot?: Blob; image?: Blob; imageName?: string } = {}) => {
    const form = new FormData();
    form.set("data", JSON.stringify(data));
    if (files.screenshot) form.set("screenshot", files.screenshot, "view.jpg");
    if (files.image) form.set("image", files.image, files.imageName ?? "image.png");
    return request<{ id: string; path: string; existing?: boolean; title?: string }>("/api/clip", {
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
  serverCapture?: boolean;
  /** Let the server capture click "Load more" buttons; off unless asked for. */
  expandContent?: boolean;
  /** "skip": when the page is already saved, return that one instead of saving it again. */
  ifExists?: "create" | "skip";
}

export async function openInApp(path: string) {
  const { serverUrl } = await getConfig();
  await chrome.tabs.create({ url: `${serverUrl}${path}` });
}
