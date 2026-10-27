"use client";

import { ChevronDown, ExternalLink, Globe } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import type { ResourceDTO, SkillPackDTO } from "@stan-bag/core/types";
import { ResourceCard, ResourceRow } from "@/components/resource-card";
import GlassFolder, { hashString, type ArtPreset } from "@/components/ui/glass-folder-cards";
import { useSkillPacks } from "@/lib/api";
import { cn } from "@/lib/utils";

const packOf = (r: ResourceDTO) => {
  const m = r.meta as { packOverride?: string; packId?: string };
  return m.packOverride || m.packId || "local";
};

const ARTS: ArtPreset[] = ["aurora", "ember", "dusk", "glacier", "verdant"];
const sectionId = (packId: string) => `pack-${packId.replace(/[^a-z0-9]+/gi, "-")}`;

const KIND_LABEL: Record<SkillPackDTO["kind"], string> = {
  repo: "GitHub",
  plugin: "Plugin",
  author: "Author",
  local: "Local",
};

/** Skills grouped by where they come from: a GitHub repo, a Claude Code plugin, or an author. */
export function SkillPackGroups({
  items,
  view,
  selection,
  toggle,
}: {
  items: ResourceDTO[];
  view: "grid" | "list";
  selection: string[];
  toggle: (id: string) => (e: MouseEvent) => void;
}) {
  const { data: packs = [] } = useSkillPacks();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const { resolvedTheme } = useTheme();
  const router = useRouter();

  const byPack = new Map<string, ResourceDTO[]>();
  for (const r of items) byPack.set(packOf(r), [...(byPack.get(packOf(r)) ?? []), r]);
  const ordered = [
    ...packs.filter((p) => byPack.has(p.id)),
    ...[...byPack.keys()]
      .filter((id) => !packs.some((p) => p.id === id))
      .map((id): SkillPackDTO => ({
        id,
        name: id,
        author: null,
        kind: "local",
        repoUrl: null,
        homepage: null,
        description: "",
        count: 0,
      })),
  ];

  const showPack = (id: string) => {
    setCollapsed((c) => c.filter((x) => x !== id));
    document
      .getElementById(`${sectionId(id)}-title`)
      ?.closest("section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-16">
      <PackShelf
        packs={ordered}
        byPack={byPack}
        tone={resolvedTheme === "light" ? "light" : "dark"}
        onShow={showPack}
        onOpenSkill={(id) => router.push(`/r/${id}`)}
      />
      {ordered.map((pack) => {
        const list = byPack.get(pack.id) ?? [];
        const open = !collapsed.includes(pack.id);
        const panelId = sectionId(pack.id);
        return (
          <section key={pack.id} aria-labelledby={`${panelId}-title`} className="scroll-mt-8 space-y-6">
            <header className="space-y-2">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setCollapsed((c) => (open ? [...c, pack.id] : c.filter((x) => x !== pack.id)))}
                  className="group flex min-w-0 items-center gap-2 rounded-full text-left"
                >
                  <ChevronDown
                    className={cn(
                      "size-5 shrink-0 text-ink-muted transition-transform duration-150",
                      !open && "-rotate-90",
                    )}
                    aria-hidden
                  />
                  <h2
                    id={`${panelId}-title`}
                    className="truncate text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink"
                  >
                    {pack.name}
                  </h2>
                </button>
                <p className="pt-1 text-[13px] text-ink-subtle">
                  {[pack.author, KIND_LABEL[pack.kind], `${list.length} skill${list.length === 1 ? "" : "s"}`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="ml-auto flex gap-2">
                  {pack.homepage && (
                    <a
                      href={pack.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-medium text-ink-secondary hover:bg-surface-raised hover:text-ink"
                    >
                      <Globe className="size-3.5" aria-hidden /> Website
                    </a>
                  )}
                  {pack.repoUrl && (
                    <a
                      href={pack.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[12px] font-medium text-ink-secondary hover:bg-surface-raised hover:text-ink"
                    >
                      <ExternalLink className="size-3.5" aria-hidden /> Repository
                    </a>
                  )}
                </div>
              </div>
              {pack.description && <p className="max-w-3xl text-sm text-ink-muted">{pack.description}</p>}
            </header>
            {open && (
              <div id={panelId}>
                {view === "grid" ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] gap-x-6 gap-y-10">
                    {list.map((r) => (
                      <ResourceCard
                        key={r.id}
                        resource={r}
                        selected={selection.includes(r.id)}
                        selecting={selection.length > 0}
                        onToggle={toggle(r.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {list.map((r) => (
                      <ResourceRow
                        key={r.id}
                        resource={r}
                        selected={selection.includes(r.id)}
                        selecting={selection.length > 0}
                        onToggle={toggle(r.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** One glass folder per pack: the skills are the files inside, and opening one fans them out. */
function PackShelf({
  packs,
  byPack,
  tone,
  onShow,
  onOpenSkill,
}: {
  packs: SkillPackDTO[];
  byPack: Map<string, ResourceDTO[]>;
  tone: "light" | "dark";
  onShow: (packId: string) => void;
  onOpenSkill: (resourceId: string) => void;
}) {
  return (
    <div
      role="list"
      aria-label="Skill packs"
      className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] justify-items-center gap-x-8 gap-y-12"
    >
      {packs.map((pack, i) => {
        const list = byPack.get(pack.id) ?? [];
        const hash = hashString(pack.id);
        const links = [
          pack.repoUrl && { label: "Open repository", url: pack.repoUrl },
          pack.homepage && { label: "Open website", url: pack.homepage },
        ].filter((l): l is { label: string; url: string } => !!l);
        return (
          <div role="listitem" key={pack.id}>
            <GlassFolder
              // the folder reads its files once, so a changed list needs a fresh folder
              key={`${pack.id}:${list.map((r) => r.id).join()}`}
              width={300}
              tone={tone}
              label={pack.name}
              meta={`${list.length} skill${list.length === 1 ? "" : "s"}`}
              art={ARTS[hash % ARTS.length]}
              seed={hash % 97}
              files={list.map((r) => ({
                name: r.title,
                meta: ((r.meta.invocation as string) || "").split(" ")[0] || undefined,
              }))}
              onFileSelect={(_, index) => onOpenSkill(list[index].id)}
              action="more"
              menu={[
                { label: `Show all ${list.length} skills`, onSelect: () => onShow(pack.id) },
                ...links.map((l) => ({
                  label: l.label,
                  onSelect: () => window.open(l.url, "_blank", "noopener,noreferrer"),
                })),
              ]}
              appearDelay={Math.min(i, 5) * 90}
            />
          </div>
        );
      })}
    </div>
  );
}
