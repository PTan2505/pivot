"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import GlassFolder, { hashString, type ArtPreset, type FolderMenuItem } from "@/components/ui/glass-folder-cards";

const ARTS: ArtPreset[] = ["aurora", "ember", "dusk", "glacier", "verdant"];

export interface ShelfFolder {
  id: string;
  label: string;
  meta: string;
  /** Resources inside the folder; choosing one opens its page. */
  items: { id: string; name: string; meta?: string; image?: string }[];
  menu: FolderMenuItem[];
}

/** A row of glass folders used as a visual index above grouped sections (skill packs, source categories). */
export function FolderShelf({ label, folders }: { label: string; folders: ShelfFolder[] }) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  return (
    <div
      role="list"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] justify-items-center gap-x-8 gap-y-12"
    >
      {folders.map((f, i) => {
        // the art is picked from the id, so a folder keeps its look
        const hash = hashString(f.id);
        return (
          <div role="listitem" key={f.id}>
            <GlassFolder
              width={300}
              tone={resolvedTheme === "light" ? "light" : "dark"}
              label={f.label}
              meta={f.meta}
              art={ARTS[hash % ARTS.length]}
              seed={hash % 97}
              files={f.items.map(({ name, meta, image }) => ({ name, meta, image }))}
              onFileSelect={(_, index) => router.push(`/r/${f.items[index].id}`)}
              action="more"
              menu={f.menu}
              appearDelay={Math.min(i, 5) * 90}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Scrolls a grouped section into view; the shelf's "Show all" menu item uses it. */
export function scrollToSection(headingId: string) {
  document.getElementById(headingId)?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
