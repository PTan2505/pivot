"use client";

import { ClipboardCopy, FolderInput, FolderMinus, PackageOpen, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmButton } from "@/components/confirm-button";
import { useUi } from "@/components/ui-store";
import { copyContext } from "@/hooks/use-copy-resource";
import { useBulk, useCollections } from "@/lib/api";

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
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Add to collection…" />
          <CommandList>
            <CommandEmpty>No collections yet — create one in the sidebar.</CommandEmpty>
            <CommandGroup>
              {collections.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={async () => {
                    await bulk.mutateAsync({ action: "addToCollection", ids, collectionId: c.id });
                    toast.success(`Added to ${c.name}`);
                    onDone?.();
                  }}
                >
                  {c.name}
                  <span className="ml-auto font-mono text-[12px] text-muted-foreground">{c.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SelectionBar({
  ids,
  onClear,
  mode,
  collectionId,
  exportName,
}: {
  ids: string[];
  onClear: () => void;
  mode: "library" | "trash";
  collectionId?: string;
  exportName: string;
}) {
  const bulk = useBulk();
  const { openExport } = useUi();
  if (!ids.length) return null;

  const run = async (action: "trash" | "restore" | "purge" | "removeFromCollection", message: string) => {
    await bulk.mutateAsync({ action, ids, collectionId });
    toast.success(message);
    onClear();
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 animate-in flex-wrap items-center gap-1 rounded-[28px] bg-surface-raised p-1.5 pl-4 shadow-overlay duration-200 fade-in slide-in-from-bottom-2"
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
          <AddToCollection ids={ids} onDone={onClear}>
            <Button variant="ghost">
              <FolderInput /> Collection
            </Button>
          </AddToCollection>
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
