"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CollectionDTO,
  ResourceDetailDTO,
  SkillPackDTO,
  ResourceDTO,
  ResourceType,
  SkillStatusDTO,
  TagDTO,
  TagKind,
} from "@stan-bag/core/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? res.statusText, res.status, data);
  return data as T;
}

export const keys = {
  resources: (params: Record<string, string | undefined>) => ["resources", params] as const,
  resource: (id: string) => ["resource", id] as const,
  tags: ["tags"] as const,
  collections: ["collections"] as const,
  counts: ["counts"] as const,
  settings: ["settings"] as const,
  skills: ["skills-status"] as const,
  skillPacks: ["skill-packs"] as const,
};

export interface ResourceQuery {
  q?: string;
  type?: ResourceType;
  exclude?: readonly ResourceType[];
  tags?: string[];
  collection?: string;
  trash?: boolean;
  sort?: string;
}

function toParams(q: ResourceQuery): Record<string, string | undefined> {
  return {
    q: q.q || undefined,
    type: q.type,
    exclude: q.exclude?.length ? q.exclude.join(",") : undefined,
    tags: q.tags?.length ? q.tags.join(",") : undefined,
    collection: q.collection,
    trash: q.trash ? "1" : undefined,
    sort: q.sort,
  };
}

export function useResources(query: ResourceQuery, { enabled = true } = {}) {
  const params = toParams(query);
  return useQuery({
    queryKey: keys.resources(params),
    queryFn: () => {
      const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
      return api<ResourceDTO[]>(`/api/resources?${sp}`);
    },
    placeholderData: keepPreviousData,
    enabled,
    // Keep polling while screenshots are being captured.
    refetchInterval: (q) => (q.state.data?.some((r) => r.captureStatus === "pending") ? 2000 : false),
  });
}

export function useResource(id: string) {
  return useQuery({
    queryKey: keys.resource(id),
    queryFn: () => api<ResourceDetailDTO>(`/api/resources/${id}`),
    refetchInterval: (q) => (q.state.data?.captureStatus === "pending" ? 2000 : false),
  });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: () => api<TagDTO[]>("/api/tags") });
}

export function useCollections() {
  return useQuery({ queryKey: keys.collections, queryFn: () => api<CollectionDTO[]>("/api/collections") });
}

export function useCounts() {
  return useQuery({ queryKey: keys.counts, queryFn: () => api<Record<string, number>>("/api/counts") });
}

export interface Settings {
  serverUrl: string;
  dataDir: string;
  dbMode: "neon" | "local";
  dbTarget: string;
  skillsDir: string;
  exportsDir: string;
  playwright: { installed: boolean; path?: string };
  storage: {
    mode: "local" | "r2";
    target: string;
    files: Partial<Record<"local" | "r2", { count: number; bytes: number }>>;
  };
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>("/api/settings"), staleTime: 60_000 });
}

export function useSkillStatuses(enabled = true) {
  return useQuery({ queryKey: keys.skills, queryFn: () => api<SkillStatusDTO[]>("/api/skills/status"), enabled });
}

export function useSkillPacks(enabled = true) {
  return useQuery({ queryKey: keys.skillPacks, queryFn: () => api<SkillPackDTO[]>("/api/skill-packs"), enabled });
}

/** Invalidate everything list-shaped after a write. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (resourceId?: string) => {
    qc.invalidateQueries({ queryKey: ["resources"] });
    qc.invalidateQueries({ queryKey: keys.tags });
    qc.invalidateQueries({ queryKey: keys.collections });
    qc.invalidateQueries({ queryKey: keys.counts });
    qc.invalidateQueries({ queryKey: keys.skills });
    qc.invalidateQueries({ queryKey: keys.skillPacks });
    if (resourceId) qc.invalidateQueries({ queryKey: keys.resource(resourceId) });
  };
}

export type TagInput = { kind: TagKind; name: string };

export interface ResourcePatch {
  title?: string;
  description?: string;
  sourceUrl?: string | null;
  notes?: string;
  content?: string;
  meta?: Record<string, unknown>;
  tags?: TagInput[];
  coverAssetId?: string | null;
  type?: ResourceType;
}

export function useUpdateResource(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (patch: ResourcePatch) =>
      api<ResourceDetailDTO>(`/api/resources/${id}`, { method: "PATCH", json: patch }),
    onSuccess: (data) => {
      qc.setQueryData(keys.resource(id), data);
      invalidate();
    },
  });
}

export function useBulk() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: {
      action: "trash" | "restore" | "purge" | "addToCollection" | "removeFromCollection";
      ids: string[];
      collectionId?: string;
    }) => api<{ ok: true }>("/api/resources/bulk", { method: "POST", json: input }),
    onSuccess: (_d, v) => {
      invalidate();
      v.ids.forEach((id) => invalidate(id));
    },
  });
}

export async function createResource(input: ResourcePatch & { type: ResourceType; title: string }) {
  return api<ResourceDetailDTO>("/api/resources", { method: "POST", json: input });
}

export async function uploadFiles(files: File[], extra: Record<string, string> = {}) {
  const form = new FormData();
  files.forEach((f) => form.append("file", f));
  Object.entries(extra).forEach(([k, v]) => form.append(k, v));
  return api<{ created: string[] }>("/api/upload", { method: "POST", body: form });
}

export async function uploadToResource(resourceId: string, files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append("file", f));
  return api<{ assetIds: string[] }>(`/api/resources/${resourceId}/assets`, { method: "POST", body: form });
}

export function assetUrl(id: string, opts: { thumb?: boolean; download?: boolean } = {}) {
  const sp = new URLSearchParams();
  if (opts.thumb) sp.set("thumb", "1");
  if (opts.download) sp.set("download", "1");
  const qs = sp.toString();
  return `/api/assets/${id}${qs ? `?${qs}` : ""}`;
}
