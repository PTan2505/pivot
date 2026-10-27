"use client";

import { Copy, ExternalLink, Pencil } from "lucide-react";
import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSkillPacks } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

interface GuideMeta {
  invocation?: string;
  usage?: string;
  examples?: string[];
  packId?: string;
  packOverride?: string;
}

type Change = (patch: { meta: Record<string, unknown> }) => void;

/** "How to use" for a skill: invocation, usage notes and example prompts, each copyable. */
export function SkillGuide({
  meta,
  sourceUrl,
  onChange,
}: {
  meta: Record<string, unknown>;
  sourceUrl: string;
  onChange: Change;
}) {
  const g = meta as GuideMeta;
  const empty = !g.usage && !g.examples?.length;
  const [editing, setEditing] = useState(false);
  const [examplesText, setExamplesText] = useState((g.examples ?? []).join("\n"));

  const set = (patch: Partial<GuideMeta>) => onChange({ meta: { ...meta, ...patch } });

  return (
    <section aria-labelledby="how-to-use" className="space-y-4 rounded-[14px] bg-surface p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="how-to-use" className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">
          How to use
        </h2>
        {g.invocation && !editing && (
          <button
            type="button"
            onClick={() => copyText(g.invocation!, `Copied ${g.invocation}`)}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 font-mono text-xs text-ink hover:bg-canvas"
            aria-label={`Copy ${g.invocation}`}
          >
            {g.invocation} <Copy className="size-3 text-ink-muted" aria-hidden />
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {sourceUrl && (
            <Button variant="secondary" size="sm" className="bg-surface-raised" asChild>
              <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Source
              </a>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="bg-surface-raised"
            onClick={() => {
              setExamplesText((g.examples ?? []).join("\n"));
              setEditing((v) => !v);
            }}
          >
            <Pencil /> {editing ? "Done" : "Edit guide"}
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="guide-invocation" className="text-xs font-normal text-ink-subtle">
              Invocation
            </Label>
            <Input
              id="guide-invocation"
              value={g.invocation ?? ""}
              onChange={(e) => set({ invocation: e.target.value })}
              placeholder="/skill-name"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guide-usage" className="text-xs font-normal text-ink-subtle">
              Usage (markdown)
            </Label>
            <Textarea
              id="guide-usage"
              value={g.usage ?? ""}
              onChange={(e) => set({ usage: e.target.value })}
              rows={6}
              placeholder="What it does, when to reach for it, what it needs."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="guide-examples" className="text-xs font-normal text-ink-subtle">
              Example prompts (one per line)
            </Label>
            <Textarea
              id="guide-examples"
              value={examplesText}
              onChange={(e) => {
                setExamplesText(e.target.value);
                set({
                  examples: e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean),
                });
              }}
              rows={5}
              className="font-mono text-xs"
            />
          </div>
        </div>
      ) : empty ? (
        <p className="text-sm text-ink-muted">
          No guide yet. Use “Edit guide” to add how and when to use this skill, with example prompts.
        </p>
      ) : (
        <>
          {g.usage && <Markdown>{g.usage}</Markdown>}
          {!!g.examples?.length && (
            <div className="space-y-2">
              <h3 className="text-xs text-ink-subtle">Examples</h3>
              <ul className="space-y-1.5">
                {g.examples.map((ex, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => copyText(ex, "Example copied")}
                      className="group flex w-full items-start gap-3 rounded-[10px] bg-surface-raised px-4 py-2.5 text-left font-mono text-xs leading-relaxed text-ink transition-colors hover:bg-canvas"
                    >
                      <span className="min-w-0 flex-1 whitespace-pre-wrap">{ex}</span>
                      <Copy
                        className="mt-0.5 size-3.5 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Copy"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Which pack a skill is grouped under: detected automatically, or chosen by hand. */
export function PackField({ meta, onChange }: { meta: Record<string, unknown>; onChange: Change }) {
  const g = meta as GuideMeta;
  const { data: packs = [] } = useSkillPacks();
  const detected = packs.find((p) => p.id === g.packId);
  const value = g.packOverride || "__auto__";
  return (
    <div className="space-y-1.5">
      <Label htmlFor="skill-pack" className="text-xs font-normal text-ink-subtle">
        Pack
      </Label>
      <Select
        value={value}
        onValueChange={(v) => onChange({ meta: { ...meta, packOverride: v === "__auto__" ? undefined : v } })}
      >
        <SelectTrigger id="skill-pack" size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__auto__">Detected{detected ? ` · ${detected.name}` : ""}</SelectItem>
          {packs.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {p.author ? ` · ${p.author}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
