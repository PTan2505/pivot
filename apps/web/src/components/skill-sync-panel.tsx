"use client";

import { FolderSync, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SkillStatusDTO } from "@stan-bag/core/types";
import { Button } from "@/components/ui/button";
import { api, useInvalidate, useSettings, useSkillStatuses } from "@/lib/api";
import { cn } from "@/lib/utils";

export const SKILL_STATE_LABEL: Record<SkillStatusDTO["state"], string> = {
  synced: "In sync",
  "app-changed": "Edited here — not saved to disk",
  "disk-changed": "Changed on disk",
  conflict: "Conflict",
  missing: "Missing on disk",
  untracked: "Not imported",
};

export const SKILL_STATE_TONE: Record<SkillStatusDTO["state"], string> = {
  synced: "text-muted-foreground",
  "app-changed": "text-warning",
  "disk-changed": "text-accent-text",
  conflict: "text-danger",
  missing: "text-muted-foreground",
  untracked: "text-accent-text",
};

let autoSynced = false;

export function SkillSyncPanel() {
  const { data: statuses = [] } = useSkillStatuses();
  const { data: settings } = useSettings();
  const invalidate = useInvalidate();
  const sync = useMutation({
    mutationFn: async ({ auto }: { auto: boolean }) => ({
      ...(await api<{ created: number; updated: number; conflicts: number; total: number }>("/api/skills/sync", { method: "POST" })),
      auto,
    }),
    onSuccess: (r) => {
      invalidate();
      if (!r.auto || r.created || r.updated) {
        toast.success(
          `Synced ${r.total} skills${r.created ? ` · ${r.created} imported` : ""}${r.updated ? ` · ${r.updated} updated from disk` : ""}${r.conflicts ? ` · ${r.conflicts} conflict${r.conflicts > 1 ? "s" : ""}` : ""}`,
        );
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const ran = useRef(false);

  // Import new skills and pull disk edits automatically the first time the Skills view opens.
  useEffect(() => {
    if (ran.current || autoSynced) return;
    ran.current = autoSynced = true;
    sync.mutate({ auto: true });
  }, [sync]);

  const attention = statuses.filter((s) => s.state !== "synced" && s.state !== "untracked");

  return (
    <div className="rounded-[14px] bg-surface p-4">
      <div className="flex items-center gap-3">
        <FolderSync className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium text-foreground">Global skills</div>
          <div className="truncate font-mono text-muted-foreground">{settings?.skillsDir ?? "~/.claude/skills"}</div>
        </div>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {statuses.filter((s) => s.state === "synced").length}/{statuses.length} in sync
        </span>
        <Button variant="secondary" className="bg-surface-raised" onClick={() => sync.mutate({ auto: false })} disabled={sync.isPending}>
          {sync.isPending ? <Loader2 className="animate-spin" /> : <FolderSync />}
          Sync from disk
        </Button>
      </div>
      {attention.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-divider pt-4">
          {attention.map((s) => (
            <li key={s.skillName} className="flex items-center gap-2 text-xs">
              {s.resourceId ? (
                <Link href={`/r/${s.resourceId}`} className="font-mono hover:underline">
                  {s.skillName}
                </Link>
              ) : (
                <span className="font-mono">{s.skillName}</span>
              )}
              <span className={cn(SKILL_STATE_TONE[s.state])}>· {SKILL_STATE_LABEL[s.state]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
