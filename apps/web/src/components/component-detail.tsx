"use client";

// The page of a component saved with its code (type `component`, docs/component-store-plan.md Phase 3). Design
// session 118304e2, version 3 "Today's layout, component stage", approved by the owner: the visual types' grid kept,
// with a stage holding Preview / Code tabs and Install in the main column, and Review and Used in at the top of the
// side panel. The code is read-only: PIVOT keeps it as fetched.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FileCode,
  Hammer,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { previewMessage, previewOriginFor } from "@pivot/core/preview-messages";
import type { ComponentFile, ComponentMeta, DesignSessionDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const componentMeta = (meta: Record<string, unknown>) => (meta?.component ?? null) as ComponentMeta | null;

const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The tab, file and line on show live in the URL (`?tab=code&file=…&line=…`), so a flag can open them. */
function useComponentView(c: ComponentMeta) {
  const params = useSearchParams();
  const tab = params.get("tab") === "code" ? "code" : "preview";
  const files = orderedFiles(c.files);
  const file = files.find((f) => f.path === params.get("file"))?.path ?? files[0]?.path ?? "";
  const line = Number(params.get("line")) || 0;
  // the native history API: Next keeps useSearchParams in step, with no server round trip (the tabs switch at once)
  const go = (next: { tab?: "preview" | "code"; file?: string; line?: number }) => {
    const sp = new URLSearchParams(window.location.search);
    const t = next.tab ?? tab;
    if (t === "code") sp.set("tab", "code");
    else sp.delete("tab");
    sp.delete("line");
    if (next.file !== undefined) sp.set("file", next.file);
    if (next.line) sp.set("line", String(next.line));
    if (t !== "code") sp.delete("file");
    const q = sp.toString();
    window.history.replaceState(null, "", q ? `${window.location.pathname}?${q}` : window.location.pathname);
  };
  return { tab, file, line, files, go };
}

const ROLE_ORDER = { component: 0, demo: 1, support: 2 } as const;
const ROLE_LABEL = { component: "Component", demo: "Demo", support: "Support" } as const;
const orderedFiles = (files: ComponentFile[]) =>
  [...files].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.path.localeCompare(b.path));
const baseName = (p: string) => p.split("/").pop() ?? p;

// ---- review state --------------------------------------------------------------------------------------------

type Tone = "ok" | "warn" | "bad" | "none";
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  none: "text-ink-muted",
};

function reviewState(c: ComponentMeta): { tone: Tone; icon: LucideIcon; label: string; short: string } {
  const r = c.review;
  if (!r) return { tone: "none", icon: ShieldQuestion, label: "Not reviewed yet", short: "Not reviewed" };
  if (r.codeSha256 !== c.codeSha256)
    return { tone: "warn", icon: AlertTriangle, label: "Reviewed an older version", short: "Review again" };
  if (r.verdict === "clean") return { tone: "ok", icon: ShieldCheck, label: "Clean", short: "Clean" };
  if (r.verdict === "concerns_accepted")
    return { tone: "warn", icon: AlertTriangle, label: "Built with concerns accepted", short: "Concerns accepted" };
  return { tone: "bad", icon: XCircle, label: "Rejected: don’t build", short: "Rejected" };
}

/** The review as a small chip: icon and word, never colour alone. */
export function ReviewChip({ c, className }: { c: ComponentMeta; className?: string }) {
  const s = reviewState(c);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/8 px-2.5 text-xs font-medium",
        TONE_TEXT[s.tone],
        className,
      )}
    >
      <s.icon className="size-3.5" aria-hidden />
      {s.tone === "ok" ? "Review: clean" : s.short}
    </span>
  );
}

function licenceText(c: ComponentMeta) {
  return c.licence.spdx || c.licence.name || null;
}

/** Under the title: who made it, its licence, the review, and its page on 21st.dev. */
export function ComponentIdentity({ c }: { c: ComponentMeta }) {
  const licence = licenceText(c);
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-[6px] bg-surface-raised text-xs text-ink-secondary uppercase"
        >
          {(c.author.name || c.author.username).slice(0, 1)}
        </span>
        {c.author.name && <span className="text-ink-secondary">{c.author.name}</span>}
        <span className="font-mono">@{c.author.username}</span>
      </span>
      {licence ? (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/8 px-2.5 text-xs font-medium text-ink">
          <span className="font-normal text-ink-secondary">Licence</span> {licence}
        </span>
      ) : (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/8 px-2.5 text-xs font-medium text-warning">
          <AlertTriangle className="size-3.5" aria-hidden /> Licence unknown
        </span>
      )}
      <ReviewChip c={c} />
      <a
        href={c.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 break-all text-accent-text hover:underline"
      >
        {c.pageUrl.replace(/^https:\/\/(www\.)?/, "")}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

// ---- main column: stage, code, install -----------------------------------------------------------------------

const STAGE_H = "h-[min(46vh,420px)]";

/** PIVOT's own live preview when it has one (the preview origin), else 21st's image or video by link. */
function Stage({ c, id, title, onShowCode }: { c: ComponentMeta; id: string; title: string; onShowCode: () => void }) {
  // the last good build keeps showing while a new one runs or after one fails
  const live = c.preview?.sha256 ? c.preview : null;
  const has21st = !!(c.previewImageUrl || c.videoUrl);
  const [mode, setMode] = useState<"live" | "21st">("live");
  const build = <BuildButton c={c} id={id} />;
  const notes = <BuildNotes c={c} />;
  if (live && (mode === "live" || !has21st)) {
    return (
      <div>
        <LivePreview
          sha256={live.sha256!}
          title={title}
          extra={
            <>
              {build}
              {has21st && (
                <Button variant="secondary" size="xs" onClick={() => setMode("21st")}>
                  <ImageIcon /> Show 21st’s preview
                </Button>
              )}
            </>
          }
          open={<OpenOn21st c={c} />}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          PIVOT’s live preview, running on its own origin with no network.
          {live.builtFrom && live.builtFrom !== c.codeSha256 && " Built from earlier code."}
        </p>
        {notes}
      </div>
    );
  }
  return (
    <div>
      <ImageStage
        c={c}
        title={title}
        onShowCode={onShowCode}
        extra={
          <>
            {build}
            {live && (
              <Button variant="secondary" size="xs" onClick={() => setMode("live")}>
                <Eye /> Show live preview
              </Button>
            )}
          </>
        }
      />
      {has21st && (
        <p className="mt-2 text-xs text-ink-subtle">
          Preview from 21st.dev, shown by its link.
          {!live && " Build preview makes PIVOT’s own live one."}
        </p>
      )}
      {notes}
    </div>
  );
}

const rejectedNow = (c: ComponentMeta) => c.review?.verdict === "rejected" && c.review.codeSha256 === c.codeSha256;

/**
 * Build preview: installs the component's npm packages from registry.npmjs.org (install scripts off) and bundles it on
 * this machine. Never offered for a rejected component; off while a build runs.
 */
function BuildButton({ c, id }: { c: ComponentMeta; id: string }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  if (rejectedNow(c)) return null;
  const building = c.preview?.status === "building";
  const start = async () => {
    setAsking(true);
    try {
      await api(`/api/components/${id}/preview`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["resource", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The build couldn’t start.");
    } finally {
      setAsking(false);
    }
  };
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={start}
      disabled={building || asking}
      title="Installs its npm packages from registry.npmjs.org (install scripts off) and bundles it on this machine"
    >
      {building || asking ? <Loader2 className="animate-spin" /> : <Hammer />}
      {building ? "Building…" : c.preview?.sha256 ? "Rebuild preview" : "Build preview"}
    </Button>
  );
}

function BuildNotes({ c }: { c: ComponentMeta }) {
  const p = c.preview;
  if (p?.status === "building")
    return (
      <p role="status" className="mt-1 text-xs text-ink-muted">
        Building the preview: installing its npm packages from registry.npmjs.org with install scripts off, then
        bundling it on this machine…
      </p>
    );
  if (p?.status === "failed")
    return (
      <div role="status" className="mt-2 flex gap-2 rounded-[10px] bg-surface p-3 text-danger">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 text-xs text-ink-secondary">
          <span className="block font-medium text-danger">The preview build failed</span>
          <span className="font-mono break-words whitespace-pre-wrap text-ink-muted">{p.error}</span>
        </p>
      </div>
    );
  return null;
}

function OpenOn21st({ c }: { c: ComponentMeta }) {
  return (
    <Button variant="secondary" size="xs" asChild>
      <a href={c.pageUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink /> Open on 21st.dev<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}

/** The stage's controls: over its top-right corner from sm up, a row under it on phones (the owner's change). */
function StageControls({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 sm:absolute sm:top-5 sm:right-5 sm:mt-0 sm:justify-end">{children}</div>
  );
}

/**
 * The preview in a sandboxed frame on the preview origin (PIVOT's port + 1): `allow-scripts allow-same-origin`, where
 * same-origin is that origin, never PIVOT's; never `srcDoc` (it would inherit PIVOT's origin). PIVOT sends nothing in
 * and reads only "ready" from that frame (previewMessage).
 */
function LivePreview({
  sha256,
  title,
  extra,
  open,
}: {
  sha256: string;
  title: string;
  extra?: React.ReactNode;
  open: React.ReactNode;
}) {
  const { data, isError } = useQuery({
    queryKey: ["preview-origin"],
    queryFn: () => api<{ port: number }>("/api/components/preview-origin"),
    staleTime: Infinity,
  });
  const origin = data ? previewOriginFor(window.location, data.port) : null;
  const ref = useRef<HTMLIFrameElement>(null);
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!origin) return;
    const on = (e: MessageEvent) => {
      if (previewMessage(e, ref.current?.contentWindow, origin) === "ready") setLoaded(true);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [origin]);
  return (
    <div className="relative rounded-[14px] bg-surface p-3">
      <div className={cn("relative overflow-hidden rounded-[10px] bg-canvas", STAGE_H)}>
        {origin && (
          <iframe
            key={run}
            ref={ref}
            src={`${origin}/p/${sha256}.html?theme=dark`}
            sandbox="allow-scripts allow-same-origin"
            allow=""
            referrerPolicy="no-referrer"
            title={`Live preview of ${title}`}
            onLoad={() => setLoaded(true)}
            className="block size-full border-0"
          />
        )}
        {(!loaded || isError) && (
          <p role="status" className="absolute inset-0 grid place-items-center bg-canvas text-sm text-ink-muted">
            {isError ? "The preview server isn’t answering." : "Loading the preview…"}
          </p>
        )}
      </div>
      <StageControls>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => {
            setLoaded(false);
            setRun((n) => n + 1);
          }}
        >
          <RotateCcw /> Reload
        </Button>
        {extra}
        {open}
      </StageControls>
    </div>
  );
}

function ImageStage({
  c,
  title,
  onShowCode,
  extra,
}: {
  c: ComponentMeta;
  title: string;
  onShowCode: () => void;
  extra?: React.ReactNode;
}) {
  const [video, setVideo] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const open = <OpenOn21st c={c} />;
  if (!c.previewImageUrl && !c.videoUrl) {
    return (
      <StageEmpty title="No preview saved" body="21st gave no preview image for this component.">
        {extra}
        <Button variant="secondary" size="xs" onClick={onShowCode}>
          <FileCode /> Show code
        </Button>
        {open}
      </StageEmpty>
    );
  }
  if (failed && !video && !c.videoUrl) {
    return (
      <StageEmpty title="Preview couldn’t load" body="21st.dev didn’t answer for its preview image.">
        <Button variant="secondary" size="xs" onClick={onShowCode}>
          <FileCode /> Show code
        </Button>
        {open}
      </StageEmpty>
    );
  }
  return (
    <div className="relative rounded-[14px] bg-surface p-3">
      {video && c.videoUrl ? (
        <video
          key="video"
          src={c.videoUrl}
          poster={c.previewImageUrl}
          className={cn("block w-full rounded-[10px] bg-canvas object-contain", STAGE_H)}
          controls
          muted
          playsInline
          loop
          autoPlay={!reduced}
          aria-label={`Preview video of ${title}`}
        />
      ) : failed || !c.previewImageUrl ? (
        <div className={cn("grid place-items-center rounded-[10px] bg-canvas p-6 text-center", STAGE_H)}>
          <p className="text-sm text-ink-muted">
            <ImageOff className="mx-auto mb-2 size-5 text-ink-subtle" aria-hidden />
            {failed ? "The preview image couldn’t load." : "No preview image saved."} The video may still play.
          </p>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 21st's preview, shown by its link (never copied)
        <img
          src={c.previewImageUrl}
          alt={`Preview of ${title}`}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={cn("block w-full rounded-[10px] bg-canvas object-cover object-top", STAGE_H)}
        />
      )}
      <StageControls>
        {extra}
        {c.videoUrl && (
          <Button variant="secondary" size="xs" onClick={() => setVideo((v) => !v)}>
            <Play /> {video ? "Show image" : "Play video"}
          </Button>
        )}
        {open}
      </StageControls>
    </div>
  );
}

function StageEmpty({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[14px] bg-surface p-3">
      <div className={cn("grid place-items-center rounded-[10px] bg-canvas p-6 text-center", STAGE_H)}>
        <div className="space-y-1">
          <ImageOff className="mx-auto mb-2 size-5 text-ink-subtle" aria-hidden />
          <p className="font-medium text-ink">{title}</p>
          <p className="text-sm text-ink-muted">{body}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (on: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
};

/** True under reduced motion (no autoplay then); false on the server. */
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Copies text with a check and "Copied" for 1.5 s, announced politely; a blocked clipboard selects the text instead. */
function CopyButton({
  text,
  label,
  name,
  selectOnFail,
}: {
  text: string;
  label: string;
  /** What it copies, e.g. "install command"; screen readers hear "<label>, <name>" (the visible label first). */
  name: string;
  selectOnFail?: () => void;
}) {
  const [done, setDone] = useState(false);
  const [said, setSaid] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setSaid(`Copied ${name}`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setDone(false);
        setSaid("");
      }, 1500);
    } catch {
      selectOnFail?.();
      toast.error("The browser blocked the clipboard: the text is selected, press ⌘C to copy.");
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        onClick={copy}
        aria-label={done ? `Copied, ${name}` : `${label}, ${name}`}
        className={cn("shrink-0", done && "text-success")}
      >
        {done ? <Check /> : <Copy />} {done ? "Copied" : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </>
  );
}

const KEYWORDS =
  /\b(import|from|export|default|function|return|const|let|var|type|interface|extends|if|else|for|while|new|async|await|class|true|false|null|undefined)\b/;
const TOKEN = new RegExp(
  `(//.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|${KEYWORDS.source}`,
  "g",
);

/** A quiet emphasis, not a highlighter: keywords in ink, strings muted, comments subtle (no new dependency). */
function emphasise(line: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const cls = m[1] ? "text-ink-subtle italic" : m[2] ? "text-ink-muted" : "font-medium text-ink";
    out.push(
      <span key={i} className={cls}>
        {m[0]}
      </span>,
    );
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const FIRST_LINES = 40;

function CodeBlock({ file, line }: { file: ComponentFile; line: number }) {
  const lines = useMemo(() => file.code.replace(/\n$/, "").split("\n"), [file.code]);
  const [all, setAll] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const long = lines.length > FIRST_LINES;
  const shown = all || !long || line > FIRST_LINES ? lines : lines.slice(0, FIRST_LINES);
  useEffect(() => {
    if (!line) return;
    preRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: "center" });
  }, [line, file.path]);
  const select = () => {
    const r = document.createRange();
    if (!preRef.current) return;
    r.selectNodeContents(preRef.current.querySelector("code")!);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
          {file.path} · {lines.length} {lines.length === 1 ? "line" : "lines"}
        </p>
        <CopyButton text={file.code} label="Copy file" name={baseName(file.path)} selectOnFail={select} />
      </div>
      <pre
        ref={preRef}
        tabIndex={0}
        role="region"
        aria-label={`${file.path}, ${lines.length} lines`}
        className="overflow-x-auto rounded-[10px] bg-canvas py-3.5 font-mono text-[12.5px] leading-[1.7] text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text"
      >
        <code className="grid w-max min-w-full grid-cols-[auto_1fr]">
          {shown.map((l, i) => (
            <Fragment key={i}>
              <span
                aria-hidden
                className={cn(
                  "pr-3.5 pl-4 text-right text-ink-subtle select-none",
                  line === i + 1 && "bg-surface-raised text-ink",
                )}
              >
                {i + 1}
              </span>
              <span
                data-line={i + 1}
                aria-current={line === i + 1 ? "true" : undefined}
                className={cn("pr-4 whitespace-pre", line === i + 1 && "bg-surface-raised")}
              >
                {line === i + 1 && <span className="sr-only">Flagged line {i + 1}: </span>}
                {emphasise(l) || " "}
                {"\n"}
              </span>
            </Fragment>
          ))}
        </code>
      </pre>
      {long && shown.length < lines.length && (
        <Button variant="secondary" size="xs" onClick={() => setAll(true)}>
          Show all {lines.length} lines
        </Button>
      )}
    </div>
  );
}

function CodeView({
  c,
  file,
  line,
  onFile,
}: {
  c: ComponentMeta;
  file: string;
  line: number;
  onFile: (path: string) => void;
}) {
  const files = orderedFiles(c.files);
  return (
    <Tabs value={file} onValueChange={onFile} className="gap-3">
      <TabsList aria-label="Files" className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
        {files.map((f) => (
          <TabsTrigger
            key={f.path}
            value={f.path}
            className="h-8 flex-none bg-surface-raised px-3 text-[13px] text-ink-secondary focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text"
          >
            <FileCode className="size-3.5" aria-hidden />
            {baseName(f.path)}
            <span className="text-xs font-normal opacity-70">{ROLE_LABEL[f.role]}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {files.map((f) => (
        <TabsContent key={f.path} value={f.path} tabIndex={-1}>
          <CodeBlock file={f} line={f.path === file ? line : 0} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function InstallPanel({ c }: { c: ComponentMeta }) {
  const cmdRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const select = () => {
    const r = document.createRange();
    if (!cmdRef.current) return;
    r.selectNodeContents(cmdRef.current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
  };
  const parts = c.installCommand?.split("$API_KEY_21ST") ?? [];
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-[14px] bg-surface p-4">
      <h2 id={headingId} className="text-xs text-ink-subtle">
        Install
      </h2>
      {c.installCommand ? (
        <>
          <div className="flex items-start gap-2 rounded-[10px] bg-surface-raised py-2 pr-2 pl-3">
            <code
              ref={cmdRef}
              className="min-w-0 flex-1 pt-0.5 font-mono text-[12.5px] leading-relaxed break-all text-ink-secondary"
            >
              {parts.map((p, i) => (
                <Fragment key={i}>
                  {p}
                  {i < parts.length - 1 && (
                    <span className="rounded-[6px] bg-surface px-1.5 py-px text-ink">$API_KEY_21ST</span>
                  )}
                </Fragment>
              ))}
            </code>
            <CopyButton text={c.installCommand} label="Copy command" name="install command" selectOnFail={select} />
          </div>
          <p className="text-xs text-ink-subtle">
            Replace <span className="rounded-[6px] bg-surface-raised px-1.5 font-mono text-ink">$API_KEY_21ST</span>{" "}
            with your 21st API key, or skip the install and copy the files: PIVOT holds them, so no 21st retrieval is
            spent.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">No install command saved: copy the files from Code.</p>
      )}
      {(c.npmDependencies.length > 0 || c.registryDependencies.length > 0) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Dependencies">
          {c.npmDependencies.map((d) => (
            <li key={d.name} className={CHIP}>
              <span className="font-normal text-ink-secondary">npm</span> {d.name}
              {d.version && <span className="font-mono font-normal text-ink-muted">{d.version}</span>}
            </li>
          ))}
          {c.registryDependencies.map((d) => (
            <li key={d} className={cn(CHIP, "max-w-full")}>
              <span className="font-normal text-ink-secondary">registry</span> <span className="truncate">{d}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/8 px-2.5 text-xs font-medium text-ink";

function RejectedBanner({ c }: { c: ComponentMeta }) {
  const r = c.review!;
  const n = c.scan?.flags?.length ?? 0;
  return (
    <div role="note" className="flex gap-3 rounded-[14px] bg-surface p-4 text-danger">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-sm text-ink-secondary">
        <span className="block font-medium text-danger">Rejected on {date(r.reviewedAt)}: don’t build it</span>
        {r.notes}
        {n > 0 && ` (${n} ${n === 1 ? "flag" : "flags"} in PIVOT’s scan.)`} It stays saved so it isn’t fetched again by
        mistake.
      </p>
    </div>
  );
}

/** The main column: Preview / Code over one stage, then Install. */
export function ComponentMain({ c, id, title }: { c: ComponentMeta; id: string; title: string }) {
  const view = useComponentView(c);
  const rejected = c.review?.verdict === "rejected" && c.review.codeSha256 === c.codeSha256;
  return (
    <div className="min-w-0 space-y-6">
      <Tabs value={view.tab} onValueChange={(t) => view.go({ tab: t as "preview" | "code" })} className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <TabsList aria-label="Preview or code">
            <TabsTrigger
              value="preview"
              className="px-4 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text"
            >
              Preview
            </TabsTrigger>
            <TabsTrigger
              value="code"
              className="px-4 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text"
            >
              Code
            </TabsTrigger>
          </TabsList>
          <span className="text-xs text-ink-subtle">
            {c.files.length} {c.files.length === 1 ? "file" : "files"}
          </span>
        </div>
        <TabsContent
          value="preview"
          tabIndex={-1}
          className="motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0"
        >
          <Stage c={c} id={id} title={title} onShowCode={() => view.go({ tab: "code" })} />
        </TabsContent>
        <TabsContent
          value="code"
          tabIndex={-1}
          className="rounded-[14px] bg-surface p-4 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0"
        >
          <CodeView c={c} file={view.file} line={view.line} onFile={(file) => view.go({ tab: "code", file })} />
        </TabsContent>
      </Tabs>
      {rejected && <RejectedBanner c={c} />}
      <InstallPanel c={c} />
    </div>
  );
}

// ---- side panel: review, used in, source --------------------------------------------------------------------

function PanelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-[14px] bg-surface p-4">
      <h2 id={id} className="text-xs text-ink-subtle">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ComponentReviewGroup({ c }: { c: ComponentMeta }) {
  const view = useComponentView(c);
  const s = reviewState(c);
  const r = c.review;
  const flags = c.scan?.flags ?? [];
  const inFiles = new Set(c.files.map((f) => f.path));
  return (
    <PanelGroup title="Review">
      <div className={cn("flex gap-2.5 rounded-[10px] bg-surface-raised p-3", TONE_TEXT[s.tone])}>
        <s.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 text-sm text-ink-secondary">
          <span className={cn("block font-medium", TONE_TEXT[s.tone])}>{s.label}</span>
          {!r ? (
            <>
              {c.status === "built" ? "Built" : "Fetched"} {date(c.fetchedAt)}. The agent reviews the code before the
              first edit to a project.
            </>
          ) : r.codeSha256 !== c.codeSha256 ? (
            <>
              The last review ({r.verdict.replace("_", " ")}, {date(r.reviewedAt)}) was for earlier code; review it
              again before the next build.
            </>
          ) : (
            <>
              {date(r.reviewedAt)}: {r.notes}
              {r.userWords && (
                <>
                  {" "}
                  You said: <q className="text-ink">{r.userWords}</q>
                </>
              )}
            </>
          )}
        </p>
      </div>
      <h3 className="pt-1 text-xs text-ink-subtle">
        PIVOT’s scan · {flags.length ? `${flags.length} ${flags.length === 1 ? "flag" : "flags"}` : "found nothing"}
      </h3>
      {flags.length > 0 && (
        <ul className="space-y-1.5">
          {flags.slice(0, 50).map((f, i) => (
            <li
              key={i}
              className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 rounded-[10px] bg-surface-raised p-2.5"
            >
              <span className={cn(CHIP, "h-5 px-2")}>{f.kind}</span>
              <span className="min-w-0 text-[13px] break-words text-ink">{f.what}</span>
              <span className="col-start-2 min-w-0 font-mono text-xs break-all text-ink-muted">
                {inFiles.has(f.file) && f.line ? (
                  <button
                    type="button"
                    className="text-accent-text hover:underline"
                    onClick={() => view.go({ tab: "code", file: f.file, line: f.line })}
                    aria-label={`Open ${f.file} at line ${f.line}`}
                  >
                    {baseName(f.file)}:{f.line}
                  </button>
                ) : (
                  <span>{f.file}</span>
                )}
                {f.excerpt && <> · {f.excerpt}</>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {flags.length > 50 && <p className="text-xs text-ink-subtle">…and {flags.length - 50} more.</p>}
      {c.scan?.hosts?.length > 0 && (
        <p className="text-xs text-ink-subtle">
          Hosts named in the code: <span className="break-all text-ink-muted">{c.scan.hosts.join(", ")}</span>
        </p>
      )}
    </PanelGroup>
  );
}

export function ComponentUsedIn({ c }: { c: ComponentMeta }) {
  const { data } = useQuery({
    queryKey: ["design-sessions"],
    queryFn: () => api<{ sessions: DesignSessionDTO[] }>("/api/design/sessions?limit=200"),
    staleTime: 60_000,
  });
  const titles = new Map((data?.sessions ?? []).map((s) => [s.id, s.title]));
  // newest first, one row per session or project, with its latest status
  const rows = new Map<string, (typeof c.origins)[number]>();
  for (const o of [...c.origins].reverse()) {
    const key = o.sessionId ?? `project:${o.project ?? ""}`;
    if (!rows.has(key)) rows.set(key, o);
  }
  const list = [...rows.values()].filter((o) => o.sessionId || o.project).slice(0, 10);
  return (
    <PanelGroup title="Used in">
      {list.length === 0 ? (
        <p className="text-sm text-ink-muted">Not used yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((o, i) => (
            <li key={i} className="rounded-[10px] bg-surface-raised p-2.5 text-sm text-ink-secondary">
              {o.sessionId ? (
                <Link href={`/design/${o.sessionId}`} className="text-accent-text hover:underline">
                  {titles.get(o.sessionId) ?? "Design session"}
                </Link>
              ) : (
                <span className="text-ink">{o.project}</span>
              )}
              {o.candidateN && <> · picked as #{o.candidateN}</>}
              <span className="block text-xs text-ink-subtle">
                {o.status === "built" ? `Built${o.project ? ` in ${o.project}` : ""}` : "Fetched, not built"} ·{" "}
                {date(o.savedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelGroup>
  );
}

/** Where it came from, in the Source group: the facts PIVOT keeps, read-only. */
export function ComponentFacts({ c }: { c: ComponentMeta }) {
  const licence = licenceText(c);
  const read = {
    "21st_result": "from 21st",
    component_page: "read on the component’s page",
    user: "given by you",
    unknown: "",
  }[c.licence.source];
  return (
    <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-ink-subtle">Original</dt>
      <dd className="min-w-0 break-all">
        <a href={c.pageUrl} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
          {c.pageUrl.replace(/^https:\/\/(www\.)?/, "")}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </dd>
      <dt className="text-ink-subtle">Author</dt>
      <dd className="min-w-0 text-ink-secondary">
        {c.author.name && `${c.author.name} `}
        <span className="font-mono">@{c.author.username}</span>
      </dd>
      <dt className="text-ink-subtle">Licence</dt>
      <dd className="min-w-0 text-ink-secondary">
        {licence ?? <span className="text-warning">Unknown: check before you ship it</span>}
        {licence && read && <span className="text-ink-subtle"> · {read}</span>}
      </dd>
      <dt className="text-ink-subtle">21st id</dt>
      <dd className="font-mono text-ink-secondary">{c.providerId}</dd>
      <dt className="text-ink-subtle">Fetched</dt>
      <dd className="font-mono text-ink-secondary">{c.fetchedAt.slice(0, 10)}</dd>
    </dl>
  );
}
