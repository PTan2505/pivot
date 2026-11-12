"use client";

import { useRouter } from "next/navigation";
import GlassFolder, { hashString, type ArtPreset, type FolderMenuItem } from "@/components/ui/glass-folder-cards";

// The folders keep the component's multi-colour art (owner's call, 2026-10-28): a spot of colour in the ember world.
const ARTS: ArtPreset[] = ["aurora", "ember", "dusk", "glacier", "verdant"];

export interface ShelfFolder {
  id: string;
  label: string;
  meta: string;
  /** Resources inside the folder; choosing one opens its page. */
  items: { id: string; name: string; meta?: string; image?: string }[];
  /** Clicking the folder: go to the page it stands for. */
  activate: () => void;
  /** Extra actions behind the folder's `···` key; none hides the key. */
  menu?: FolderMenuItem[];
}

/**
 * A row of glass folders used as a visual index (section types, source categories, skill packs). Hovering a folder
 * opens it and fans its contents; clicking it goes to its page.
 */
export function FolderShelf({ label, folders }: { label: string; folders: ShelfFolder[] }) {
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
              tone="dark"
              label={f.label}
              meta={f.meta}
              art={ARTS[hash % ARTS.length]}
              seed={hash % 97}
              files={f.items.map(({ name, meta, image }) => ({ name, meta, image }))}
              onFileSelect={(_, index) => router.push(`/r/${f.items[index].id}`)}
              openOn="hover"
              onActivate={f.activate}
              action={f.menu?.length ? "more" : "none"}
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
