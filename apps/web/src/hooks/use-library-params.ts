"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import {
  isResourceType,
  isSectionId,
  SECTIONS,
  sectionOf,
  SOURCE_CATEGORIES,
  type ResourceType,
  type Section,
  type SourceCategory,
} from "@pivot/core/types";

export interface LibraryParams {
  q: string;
  /** The navbar section. Follows `type` when one is chosen; Library by default. */
  section: Section;
  type: ResourceType | undefined;
  tags: string[];
  /** Source id: only resources saved from that source. */
  via: string;
  /** Sources only: one source category. */
  category: SourceCategory | undefined;
  sort: "updated" | "created" | "title";
  view: "grid" | "list";
}

type ParamsPatch = Partial<Omit<LibraryParams, "section">> & { section?: Section["id"] };

/** The link for a navbar section: single-type sections link to their type, so existing `?type=` links keep working. */
export function sectionHref(section: Section) {
  if (section.types.length === 1) return `/?type=${section.types[0]}`;
  return section.id === "library" ? "/" : `/?section=${section.id}`;
}

/** Filters live in the URL so every view is linkable and survives back/forward. */
export function useLibraryParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawType = sp.get("type");
  const rawSection = sp.get("section");
  const sort = sp.get("sort");
  let type = isResourceType(rawType) ? rawType : undefined;
  const section: Section = type
    ? sectionOf(type)
    : (SECTIONS.find((s) => s.id === (isSectionId(rawSection) ? rawSection : "library")) ?? SECTIONS[0]);
  // A one-type section (Sources, Skills) always means that type.
  if (!type && section.types.length === 1) type = section.types[0];
  const params: LibraryParams = {
    q: sp.get("q") ?? "",
    section,
    type,
    tags: sp.get("tags")?.split(",").filter(Boolean) ?? [],
    via: sp.get("via") ?? "",
    category: type === "source" ? SOURCE_CATEGORIES.find((c) => c.value === sp.get("category"))?.value : undefined,
    sort: sort === "created" || sort === "title" ? sort : "updated",
    view: sp.get("view") === "list" ? "list" : "grid",
  };

  const set = useCallback(
    (patch: ParamsPatch) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        const value = Array.isArray(v) ? v.join(",") : v;
        const isDefault =
          !value ||
          (k === "sort" && value === "updated") ||
          (k === "view" && value === "grid") ||
          (k === "section" && value === "library");
        if (isDefault) next.delete(k);
        else next.set(k, String(value));
      }
      // A type implies its section, so don't keep both in the URL.
      if (next.get("type")) next.delete("section");
      // A source category means nothing once you leave Sources.
      if ("type" in patch && !("category" in patch)) next.delete("category");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  return { ...params, set };
}
