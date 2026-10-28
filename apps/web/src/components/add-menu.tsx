"use client";

import { ChevronDown, Link2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { RESOURCE_TYPES, TYPE_DEFS, type ResourceType } from "@pivot/core/types";
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
import { createResource, uploadFiles, useInvalidate } from "@/lib/api";

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

export function AddMenu({ preferType }: { preferType?: ResourceType }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const forcedType = useRef<ResourceType | null>(null);
  const router = useRouter();
  const invalidate = useInvalidate();
  const { openAddUrl } = useUi();
  const createOfType = useCreateOfType();

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

  const primaryLabel = preferType ? `New ${TYPE_DEFS[preferType].label.toLowerCase()}` : "Add";

  return (
    <div className="flex">
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        size="lg"
        className="rounded-r-none pr-4"
        onClick={() => (preferType ? createOfType(preferType, pickFile) : openAddUrl())}
      >
        <Plus />
        {primaryLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="border-on-accent/25 rounded-l-none border-l pr-3 pl-2.5"
            aria-label="More ways to add"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => openAddUrl()}>
            <Link2 /> Add from URL…
            <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pickFile()}>
            <Upload /> Upload files…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">New</DropdownMenuLabel>
          {RESOURCE_TYPES.map((t) => (
            <DropdownMenuItem key={t} onSelect={() => createOfType(t, pickFile)}>
              <TypeIcon type={t} /> {TYPE_DEFS[t].label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
