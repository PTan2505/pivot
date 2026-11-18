"use client";

import { ChevronDown, FolderPlus, Link2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { TYPE_DEFS, visibleTypes, type ResourceType } from "@pivot/core/types";
import { TypeIcon } from "@/components/type-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUi } from "@/components/ui-store";
import { createResource, uploadFiles, useInvalidate, useShowOther } from "@/lib/api";

const UPLOAD_TYPES: ResourceType[] = ["media", "icon", "animation"];
const ACCEPT = "image/*,video/*,.svg,.json,.lottie,.woff,.woff2,.ttf,.otf";

/** Creates a resource of the given type in the way that fits it: URL dialog, file picker, or a blank editor. */
export function useCreateOfType() {
  const router = useRouter();
  const { openAddUrl } = useUi();
  return async (type: ResourceType, pickFile?: (type: ResourceType) => void) => {
    const def = TYPE_DEFS[type];
    if (def.url === "primary") return openAddUrl([], type);
    if (UPLOAD_TYPES.includes(type) && pickFile) return pickFile(type);
    try {
      const r = await createResource({
        type,
        title: `Untitled ${def.label.toLowerCase()}`,
        content: starterContent(type),
      });
      router.push(`/r/${r.id}?new=1`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    }
  };
}

function starterContent(type: ResourceType) {
  if (type === "skill")
    return "---\nname: my-skill\ndescription: What this skill does and when Claude should use it.\n---\n\n# My skill\n\n";
  if (type === "checklist") return "- [ ] \n";
  if (type === "mcp") return '{\n  "mcpServers": {\n  }\n}\n';
  return "";
}

/**
 * Add, the one ember action. In the top bar: a split button (the main action, then a menu of every way to add). In the
 * phone dock (`fab`): a round button that opens the same menu upward.
 */
export function AddMenu({
  preferType,
  fab,
  onNewCollection,
}: {
  preferType?: ResourceType;
  fab?: boolean;
  onNewCollection?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const forcedType = useRef<ResourceType | null>(null);
  const router = useRouter();
  const invalidate = useInvalidate();
  const { openAddUrl } = useUi();
  const createOfType = useCreateOfType();
  const newTypes = visibleTypes(useShowOther());

  const pickFile = (type?: ResourceType) => {
    forcedType.current = type ?? null;
    fileRef.current?.click();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    const id = toast.loading(`Uploading ${list.length} file${list.length > 1 ? "s" : ""}…`);
    try {
      const { created } = await uploadFiles(list, forcedType.current ? { type: forcedType.current } : {});
      invalidate();
      toast.success(`Added ${created.length} resource${created.length > 1 ? "s" : ""}`, { id });
      if (created.length === 1) router.push(`/r/${created[0]}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed", { id });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const menu = (
    <DropdownMenuContent side={fab ? "top" : "bottom"} align="end" sideOffset={8} className="w-56">
      <DropdownMenuItem onSelect={() => openAddUrl()}>
        <Link2 /> Add from URL…
        <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => pickFile()}>
        <Upload /> Upload files…
      </DropdownMenuItem>
      {onNewCollection && (
        <DropdownMenuItem onSelect={() => setTimeout(onNewCollection, 0)}>
          <FolderPlus /> New collection…
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">New</DropdownMenuLabel>
      {newTypes.map((t) => (
        <DropdownMenuItem key={t} onSelect={() => createOfType(t, pickFile)}>
          <TypeIcon type={t} /> {TYPE_DEFS[t].label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
  const input = (
    <input
      ref={fileRef}
      type="file"
      multiple
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => onFiles(e.target.files)}
    />
  );

  if (fab)
    return (
      <DropdownMenu>
        {input}
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Add"
            className="size-[52px] rounded-full p-0 shadow-[0_12px_32px_rgb(0_0_0/0.5)] [&_svg]:size-[22px]"
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );

  return (
    <div className="flex">
      {input}
      <Button
        className="rounded-r-none pr-3.5 pl-3"
        aria-label={preferType ? `New ${TYPE_DEFS[preferType].label.toLowerCase()}` : undefined}
        onClick={() => (preferType ? createOfType(preferType, pickFile) : openAddUrl())}
      >
        <Plus />
        {preferType ? (
          <span>
            New<span className="max-xl:hidden"> {TYPE_DEFS[preferType].label.toLowerCase()}</span>
          </span>
        ) : (
          <span>Add</span>
        )}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="border-on-accent/25 w-8 rounded-l-none border-l p-0" aria-label="More ways to add">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    </div>
  );
}
