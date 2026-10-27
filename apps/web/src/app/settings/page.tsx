"use client";

import { Check, Copy, Eye, EyeOff, Pencil, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { TAG_KIND_LABELS, TAG_KINDS, type TagDTO } from "@stan-bag/core/types";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useInvalidate, useSettings, useTags } from "@/lib/api";
import { copyText } from "@/lib/clipboard";

function Row({ label, value, mono = true, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] items-start gap-4 border-b border-divider py-3.5 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[13px]">
        {value && (
          <button type="button" onClick={() => copyText(value, "Copied")} className={mono ? "font-mono text-xs break-all hover:underline" : "hover:underline"}>
            {value}
          </button>
        )}
        {children}
      </dd>
    </div>
  );
}

function TagRow({ tag }: { tag: TagDTO }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const invalidate = useInvalidate();
  const save = async () => {
    setEditing(false);
    if (!name.trim() || name === tag.name) return setName(tag.name);
    try {
      await api(`/api/tags/${tag.id}`, { method: "PATCH", json: { name } });
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  };
  return (
    <li className="group flex h-9 items-center gap-2 rounded-full px-3 text-[13px] hover:bg-surface-raised">
      {editing ? (
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} className="h-7 text-[13px]" />
      ) : (
        <span className="truncate">{tag.name}</span>
      )}
      <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{tag.count}</span>
      <div className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <Button variant="ghost" size="icon-xs" aria-label={`Rename ${tag.name}`} onClick={() => setEditing(true)}>
          {editing ? <Check /> : <Pencil />}
        </Button>
        <ConfirmButton
          title={`Delete “${tag.name}”?`}
          description={tag.count ? `It is removed from ${tag.count} resource${tag.count > 1 ? "s" : ""}.` : undefined}
          confirmLabel="Delete"
          onConfirm={async () => {
            await api(`/api/tags/${tag.id}`, { method: "DELETE" });
            invalidate();
          }}
        >
          <Button variant="ghost" size="icon-xs" aria-label={`Delete ${tag.name}`} className="hover:text-destructive">
            <Trash2 />
          </Button>
        </ConfirmButton>
      </div>
    </li>
  );
}

function ExtensionSection({ serverUrl }: { serverUrl?: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["api-token"], queryFn: () => api<{ token: string }>("/api/settings/token") });
  const [shown, setShown] = useState(false);
  const token = data?.token ?? "";
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">Browser extension</h2>
        <p className="text-sm text-muted-foreground">Save the current tab, images and selected text from Chrome. The extension needs this server address and token.</p>
      </div>
      <dl className="rounded-[14px] bg-surface px-5">
        <Row label="Server URL" value={serverUrl} />
        <Row label="API token">
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{shown ? token : "•".repeat(32)}</code>
            <Button variant="ghost" size="icon-xs" aria-label={shown ? "Hide token" : "Show token"} onClick={() => setShown((v) => !v)}>
              {shown ? <EyeOff /> : <Eye />}
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Copy token" onClick={() => copyText(token, "Token copied")}>
              <Copy />
            </Button>
            <ConfirmButton
              title="Generate a new token?"
              description="The extension stops working until you paste the new token into its options."
              confirmLabel="Regenerate"
              onConfirm={async () => {
                await api("/api/settings/token", { method: "POST" });
                qc.invalidateQueries({ queryKey: ["api-token"] });
                toast.success("New token generated");
              }}
            >
              <Button variant="ghost" size="icon-xs" aria-label="Regenerate token">
                <RefreshCw />
              </Button>
            </ConfirmButton>
          </div>
        </Row>
        <Row label="Install" mono={false}>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              Run <code className="font-mono">pnpm ext:build</code> in the repo.
            </li>
            <li>
              Open <code className="font-mono">chrome://extensions</code>, enable Developer mode, click “Load unpacked” and pick{" "}
              <code className="font-mono">apps/extension/dist</code>.
            </li>
            <li>Open the extension’s options and paste the server URL and token.</li>
          </ol>
        </Row>
      </dl>
    </section>
  );
}

export default function SettingsPage() {
  const { data: s } = useSettings();
  const { data: tags = [] } = useTags();
  return (
    <div className="mx-auto max-w-4xl space-y-12 px-4 pt-10 pb-16 md:px-10">
      <section className="space-y-3">
        <h1 className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em]">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure these with environment variables in <code className="font-mono text-xs">.env</code> at the repo root, then restart with{" "}
          <code className="font-mono text-xs">npm start</code>.
        </p>
        <dl className="rounded-[14px] bg-surface px-5">
          <Row label="Data folder" value={s?.dataDir} />
          <Row label="Database">
            {s && (
              <div className="space-y-0.5">
                <div>{s.dbMode === "neon" ? "Neon (cloud Postgres)" : "Local Postgres (PGlite, offline)"}</div>
                <div className="font-mono text-xs break-all text-muted-foreground">{s.dbTarget}</div>
              </div>
            )}
          </Row>
          <Row label="Global skills" value={s?.skillsDir} />
          <Row label="Default export folder" value={s?.exportsDir} />
          <Row label="Screenshots">
            {s &&
              (s.playwright.installed ? (
                <span className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-success" aria-hidden /> Chromium ready
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <TriangleAlert className="size-3.5 text-warning" aria-hidden /> Chromium is not installed. Run{" "}
                  <code className="font-mono text-xs">pnpm setup:browser</code>
                </span>
              ))}
          </Row>
        </dl>
      </section>

      <ExtensionSection serverUrl={s?.serverUrl} />

      <section className="space-y-3">
        <div>
          <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">Tags & facets</h2>
          <p className="text-sm text-muted-foreground">Renaming to an existing name merges the two.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {TAG_KINDS.map((kind) => {
            const list = tags.filter((t) => t.kind === kind);
            return (
              <div key={kind} className="rounded-[14px] bg-surface p-2">
                <h3 className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
                  {TAG_KIND_LABELS[kind]} <span className="font-mono">{list.length}</span>
                </h3>
                {list.length ? (
                  <ul className="max-h-64 overflow-y-auto">
                    {list.map((t) => (
                      <TagRow key={t.id} tag={t} />
                    ))}
                  </ul>
                ) : (
                  <p className="px-2 pb-2 text-xs text-muted-foreground">None yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2 text-sm text-muted-foreground">
        <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-ink">Shortcuts</h2>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <li><kbd className="font-mono">⌘K</kbd> search & commands</li>
          <li><kbd className="font-mono">/</kbd> focus library search</li>
          <li><kbd className="font-mono">⌘V</kbd> paste URL or image anywhere</li>
          <li><kbd className="font-mono">⌘S</kbd> save now</li>
          <li><kbd className="font-mono">⇧ click</kbd> select a range</li>
          <li><kbd className="font-mono">⌘A</kbd> select all · <kbd className="font-mono">esc</kbd> clear</li>
        </ul>
      </section>
    </div>
  );
}
