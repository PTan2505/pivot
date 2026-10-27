"use client";

import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { extractVariables, fillVariables } from "@stan-bag/core/prompt-vars";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Kbd } from "@/components/ui/kbd";
import { useUi } from "@/components/ui-store";
import { useResource } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

function Body({ id, onDone }: { id: string; onDone: () => void }) {
  const { data } = useResource(id);
  const vars = useMemo(() => extractVariables(data?.content ?? ""), [data?.content]);
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = fillVariables(data?.content ?? "", values);

  const copy = async () => {
    if (await copyText(filled, "Prompt copied")) onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        copy();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) copy();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{data?.title ?? "Prompt"}</DialogTitle>
        <DialogDescription>Fill in the variables, then copy. Empty fields keep their default.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {vars.map((v, i) => (
          <div key={v.name} className="grid grid-cols-[140px_1fr] items-center gap-3">
            <Label htmlFor={`var-${v.name}`} className="font-mono text-xs">
              {v.name}
            </Label>
            <Input
              id={`var-${v.name}`}
              autoFocus={i === 0}
              placeholder={v.defaultValue || "…"}
              value={values[v.name] ?? ""}
              onChange={(e) => setValues((s) => ({ ...s, [v.name]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {filled}
      </pre>
      <DialogFooter>
        <Button type="submit">
          <Copy /> Copy prompt <Kbd className="bg-primary-foreground/20 text-primary-foreground">⌘↵</Kbd>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PromptCopyDialog() {
  const { promptResourceId, closePromptCopy } = useUi();
  return (
    <Dialog open={!!promptResourceId} onOpenChange={(o) => !o && closePromptCopy()}>
      <DialogContent className="sm:max-w-xl">{promptResourceId && <Body key={promptResourceId} id={promptResourceId} onDone={closePromptCopy} />}</DialogContent>
    </Dialog>
  );
}
