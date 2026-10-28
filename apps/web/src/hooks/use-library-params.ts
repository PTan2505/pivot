"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { isResourceType, type ResourceType } from "@stan-bag/core/types";

export interface LibraryParams {
  q: string;
  type: ResourceType | undefined;
  tags: string[];
  /** Source id: only resources saved from that source. */
  via: string;
  sort: "updated" | "created" | "title";
  view: "grid" | "list";
}

/** Filters live in the URL so every view is linkable and survives back/forward. */
export function useLibraryParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const type = sp.get("type");
  const sort = sp.get("sort");
  const params: LibraryParams = {
    q: sp.get("q") ?? "",
    type: isResourceType(type) ? type : undefined,
    tags: sp.get("tags")?.split(",").filter(Boolean) ?? [],
    via: sp.get("via") ?? "",
    sort: sort === "created" || sort === "title" ? sort : "updated",
    view: sp.get("view") === "list" ? "list" : "grid",
  };

  const set = useCallback(
    (patch: Partial<LibraryParams>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        const value = Array.isArray(v) ? v.join(",") : v;
        const isDefault = !value || (k === "sort" && value === "updated") || (k === "view" && value === "grid");
        if (isDefault) next.delete(k);
        else next.set(k, String(value));
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  return { ...params, set };
}
