"use client";

import { HardDriveUpload, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

/**
 * Writing a skill into Claude Code's skills folder is owner only: a skill there is loaded into every Claude Code session
 * as instructions. The dialog saves the editor first, then asks for the owner passphrase, with a single-use challenge
 * bound to exactly the content saved.
 */
/** sha256 hex of text, as the server hashes a skill's content. */
async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function SkillWriteDialog({
  resourceId,
  content,
  force,
  open,
  onOpenChange,
  flush,
  onWritten,
}: {
  resourceId: string;
  /** The content the editor shows: the challenge is refused if the stored content isn't exactly this. */
  content: string;
  force: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flush: () => Promise<void>;
  onWritten: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const prepared = useQuery({
    queryKey: ["skill-write-challenge", resourceId, force, attempt],
    queryFn: async () => {
      await flush(); // store the draft first; the server then checks the stored content is what this page shows
      const hash = await sha256(content);
      return api<{
        ready: boolean;
        challenge?: string;
        contentHash?: string;
        content?: string;
        target?: string;
      }>(`/api/skills/${resourceId}/write-challenge?hash=${hash}${force ? "&force=1" : ""}`);
    },
    enabled: open,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
  });
  const ready = prepared.data ? (prepared.data.ready && prepared.data.challenge ? prepared.data : false) : null;
  const write = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const r = await api<{ path: string }>(`/api/skills/${resourceId}/write`, {
        method: "POST",
        json: { force, passphrase, challenge: ready.challenge, contentHash: ready.contentHash },
      });
      setPassphrase("");
      onOpenChange(false);
      toast.success(`Saved to ${r.path}`);
      onWritten();
    } catch (err) {
      if (err instanceof ApiError && err.data.conflict) {
        onOpenChange(false);
        toast.error(err.message, { description: "Use “Overwrite disk” or “Use disk version”." });
      } else toast.error(err instanceof Error ? err.message : "Could not write skill");
      setAttempt((a) => a + 1); // each challenge works once
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (saving) return;
        if (!o) setAttempt((a) => a + 1);
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{force ? "Overwrite SKILL.md on disk?" : "Save this skill to disk?"}</DialogTitle>
          <DialogDescription>
            Claude Code loads skills in its skills folder into every session, so only you can put one there, never an
            agent.
            {force && " The file on disk was changed outside PIVOT; writing replaces those changes."}
          </DialogDescription>
        </DialogHeader>
        {ready && (
          <div className="space-y-1.5">
            <p className="text-[13px] text-ink-muted">
              Writes <span className="font-mono [overflow-wrap:anywhere] text-ink">{ready.target}</span> (content{" "}
              <span className="font-mono">{ready.contentHash?.slice(0, 12)}</span>), exactly this:
            </p>
            <pre className="max-h-56 overflow-auto rounded-[10px] bg-surface-raised p-3 font-mono text-xs whitespace-pre-wrap text-ink-secondary">
              {ready.content}
            </pre>
          </div>
        )}
        {prepared.error ? (
          <p role="alert" className="text-[13px] text-danger">
            {prepared.error.message}
          </p>
        ) : ready === false ? (
          <p role="alert" className="text-[13px] text-ink-muted">
            Saving a skill to disk needs your owner passphrase. Set it once in a terminal in the PIVOT folder:{" "}
            <span className="font-mono text-ink">pnpm owner:passphrase</span>, then open this dialog again.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="skill-write-passphrase">Owner passphrase</Label>
            <Input
              id="skill-write-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passphrase && !saving && void write()}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !ready || !passphrase} onClick={write}>
            {saving ? <Loader2 className="animate-spin" /> : <HardDriveUpload />} {force ? "Overwrite disk" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
