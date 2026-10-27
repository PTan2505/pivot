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

export function AddToCollection({ ids, onDone, children }: { ids: string[]; onDone?: () => void; children: React.ReactNode }) {
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
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">{c.count}</span>
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
      className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover p-1.5 pl-3 shadow-2xl shadow-black/40 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <span className="mr-2 font-mono text-xs text-muted-foreground tabular-nums">{ids.length} selected</span>
      {mode === "library" ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => copyContext(ids)}>
            <ClipboardCopy /> Copy context
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openExport({ ids, name: exportName })}>
            <PackageOpen /> Export
          </Button>
          <AddToCollection ids={ids} onDone={onClear}>
            <Button variant="ghost" size="sm">
              <FolderInput /> Collection
            </Button>
          </AddToCollection>
          {collectionId && (
            <Button variant="ghost" size="sm" onClick={() => run("removeFromCollection", "Removed from collection")}>
              <FolderMinus /> Remove
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => run("trash", `Moved ${ids.length} to trash`)}>
            <Trash2 /> Trash
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => run("restore", `Restored ${ids.length}`)}>
            <RotateCcw /> Restore
          </Button>
          <ConfirmButton
            title={`Delete ${ids.length} resource${ids.length > 1 ? "s" : ""} forever?`}
            description="Their files are removed too, unless another resource still uses them. This can't be undone."
            confirmLabel="Delete forever"
            onConfirm={() => run("purge", "Deleted permanently")}
          >
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 /> Delete forever
            </Button>
          </ConfirmButton>
        </>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  );
}
