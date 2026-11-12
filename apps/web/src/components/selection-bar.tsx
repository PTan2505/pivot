"use client";

import {
  CheckCheck,
  ClipboardCopy,
  FolderInput,
  FolderMinus,
  FolderPlus,
  PackageOpen,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmButton } from "@/components/confirm-button";
import { useUi } from "@/components/ui-store";
import { copyContext } from "@/hooks/use-copy-resource";
import { api, useBulk, useCollections, useInvalidate } from "@/lib/api";

export function AddToCollection({
  ids,
  onDone,
  children,
}: {
  ids: string[];
  onDone?: () => void;
  children: React.ReactNode;
}) {
  const { data: collections = [] } = useCollections();
  const bulk = useBulk();
  const invalidate = useInvalidate();
  const [query, setQuery] = useState("");
  const name = query.trim();
  const exists = collections.some((c) => c.name.toLowerCase() === name.toLowerCase());

  const addTo = async (collection: { id: string; name: string }) => {
    await bulk.mutateAsync({ action: "addToCollection", ids, collectionId: collection.id });
    toast.success(`Added to ${collection.name}`);
    setQuery("");
    onDone?.();
  };
  const createAndAdd = async () => {
    try {
      const created = await api<{ id: string; name: string }>("/api/collections", { method: "POST", json: { name } });
      invalidate();
      await addTo(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the collection");
    }
  };

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Find or create a collection…" value={query} onValueChange={setQuery} />
          <CommandList>
            {/* With a name typed, the Create row below is the answer. */}
            {!name && <CommandEmpty>No collections yet. Type a name to create one.</CommandEmpty>}
            <CommandGroup>
              {collections.map((c) => (
                <CommandItem key={c.id} value={c.name} onSelect={() => addTo(c)}>
                  {c.name}
                  <span className="ml-auto font-mono text-[12px] text-ink-subtle">{c.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {name && !exists && (
              <CommandGroup forceMount>
                <CommandItem forceMount value={`create ${name}`} onSelect={createAndAdd}>
                  <FolderPlus /> Create “{name}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A read-only folder (index.html, screenshots, share.json) for someone else. Notes, annotations and pages saved as
 * private stay out.
 */
async function sharePackage(ids: string[], title: string) {
  const id = toast.loading("Making the share package…");
  try {
    const res = await api<{ path: string; shared: number; left: { title: string; why: string }[] }>("/api/share", {
      method: "POST",
      json: { ids, title },
    });
    toast.success(
      `Share package ready: ${res.shared} item${res.shared > 1 ? "s" : ""}${res.left.length ? `, ${res.left.length} left out (private)` : ""}`,
      {
        id,
        description: "Notes and annotations aren't in it.",
        action: {
          label: "Show",
          onClick: () => void api("/api/reveal", { method: "POST", json: { path: res.path } }).catch(() => {}),
        },
      },
    );
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Could not make the share package", { id });
  }
}

export function SelectionBar({
  ids,
  onClear,
  mode,
  collectionId,
  exportName,
  inbox = false,
}: {
  ids: string[];
  onClear: () => void;
  mode: "library" | "trash";
  collectionId?: string;
  exportName: string;
  /** Showing the Inbox: offer "Mark reviewed". */
  inbox?: boolean;
}) {
  const bulk = useBulk();
  const { openExport } = useUi();
  if (!ids.length) return null;

  const run = async (action: "trash" | "restore" | "purge" | "removeFromCollection" | "reviewed", message: string) => {
    await bulk.mutateAsync({ action, ids, collectionId });
    toast.success(message);
    onClear();
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="glass-strong fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 animate-in flex-wrap items-center gap-1 rounded-[28px] p-1.5 pl-4 duration-200 fade-in slide-in-from-bottom-2"
    >
      <span className="mr-2 font-mono text-xs text-ink-subtle tabular-nums">{ids.length} selected</span>
      {mode === "library" ? (
        <>
          <Button variant="ghost" onClick={() => copyContext(ids)}>
            <ClipboardCopy /> Copy context
          </Button>
          <Button variant="ghost" onClick={() => openExport({ ids, name: exportName })}>
            <PackageOpen /> Export
          </Button>
          <Button variant="ghost" onClick={() => sharePackage(ids, exportName)}>
            <Share2 /> Share package
          </Button>
          <AddToCollection ids={ids} onDone={onClear}>
            <Button variant="ghost">
              <FolderInput /> Collection
            </Button>
          </AddToCollection>
          {inbox && (
            <Button variant="ghost" onClick={() => run("reviewed", `Marked ${ids.length} as reviewed`)}>
              <CheckCheck /> Mark reviewed
            </Button>
          )}
          {collectionId && (
            <Button variant="ghost" onClick={() => run("removeFromCollection", "Removed from collection")}>
              <FolderMinus /> Remove
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={() => run("trash", `Moved ${ids.length} to trash`)}
          >
            <Trash2 /> Trash
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={() => run("restore", `Restored ${ids.length}`)}>
            <RotateCcw /> Restore
          </Button>
          <ConfirmButton
            title={`Delete ${ids.length} resource${ids.length > 1 ? "s" : ""} forever?`}
            description="Their files are removed too, unless another resource still uses them. This can't be undone."
            confirmLabel="Delete forever"
            onConfirm={() => run("purge", "Deleted permanently")}
          >
            <Button variant="ghost" className="text-danger hover:text-danger">
              <Trash2 /> Delete forever
            </Button>
          </ConfirmButton>
        </>
      )}
      <Button variant="ghost" size="icon" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}
