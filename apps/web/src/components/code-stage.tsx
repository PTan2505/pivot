"use client";

// The parts the component page (component-detail.tsx) and a saved design's page (my-design-detail.tsx) share: the
// preview stage and its controls, the live preview on the preview origin, the read-only code viewer with file tabs, and
// the copy button. Moved out of component-detail.tsx unchanged (docs/my-designs-plan.md, Phase 3).
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FileCode, ImageOff, RotateCcw, XCircle } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { previewMessage, previewOriginFor } from "@pivot/core/preview-messages";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** A file shown in the code viewer: a component's or a saved design's. */
export type CodeFile = { path: string; role: string; code: string };

export const baseName = (p: string) => p.split("/").pop() ?? p;

/** The height of a stage that has nothing to preview (an empty or failed state). */
export const STAGE_H = "h-[min(46vh,420px)]";

/**
 * The preview stage: a screen's proportions (16:10 from sm up, 4:5 on phones) and never taller than 75% of the window,
 * so a preview keeps its own shape instead of being squeezed into a strip or cropped.
 */
export const STAGE = "aspect-[4/5] max-h-[75vh] w-full sm:aspect-[16/10]";

/** A wide stage at least this many px shows a page at its `viewport` width, scaled down to fit. */
const SCALE_FROM = 640;

/** The stage's controls: over its top-right corner from sm up, a row under it on phones (the owner's change). */
export function StageControls({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 sm:absolute sm:top-5 sm:right-5 sm:mt-0 sm:justify-end">{children}</div>
  );
}

/**
 * The preview in a sandboxed frame on the preview origin (PIVOT's port + 1): `allow-scripts allow-same-origin`, where
 * same-origin is that origin, never PIVOT's; never `srcDoc` (it would inherit PIVOT's origin). PIVOT sends nothing in
 * and reads only "ready" from that frame (previewMessage).
 */
export function LivePreview({
  sha256,
  title,
  extra,
  viewport,
}: {
  sha256: string;
  title: string;
  extra?: React.ReactNode;
  /** Render at this width (a page designed for a desktop screen) and scale it down to the stage; phones show it as is. */
  viewport?: number;
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
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !viewport) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewport]);
  const scale = viewport && size && size.w >= SCALE_FROM && size.w < viewport ? size.w / viewport : 1;
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
      <div ref={box} className={cn("relative overflow-hidden rounded-[10px] bg-canvas", STAGE)}>
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
            className={cn("block border-0", scale === 1 && "size-full")}
            style={
              scale === 1
                ? undefined
                : {
                    width: viewport,
                    height: size!.h / scale,
                    transform: `scale(${scale})`,
                    transformOrigin: "0 0",
                  }
            }
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
      </StageControls>
    </div>
  );
}

export function StageEmpty({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
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
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** Copies text with a check and "Copied" for 1.5 s, announced politely; a blocked clipboard selects the text instead. */
export function CopyButton({
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

export function CodeBlock({ file, line }: { file: CodeFile; line: number }) {
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

/** File tabs over the code, one per file, in the order given; `roleLabel` names each file's part (Component, Demo…). */
export function CodeView({
  files,
  file,
  line,
  onFile,
  roleLabel,
}: {
  files: CodeFile[];
  file: string;
  line: number;
  onFile: (path: string) => void;
  roleLabel: (role: string) => string;
}) {
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
            <span className="text-xs font-normal opacity-70">{roleLabel(f.role)}</span>
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

export const CHIP = "inline-flex h-6 items-center gap-1.5 rounded-full bg-ink/8 px-2.5 text-xs font-medium text-ink";

/** The first useful line of a build error, for the one-line summary (the raw text stays behind "Show details"). */
function summariseBuildError(error: string) {
  const unresolved = error.match(/Could not resolve/g)?.length ?? 0;
  if (unresolved)
    return `${unresolved} ${unresolved === 1 ? "import" : "imports"} couldn’t be found. A file it imports may not be saved.`;
  const first = error.split(/\n|; /)[0]?.trim() ?? "";
  return first || "No reason given.";
}

/** A failed preview build: one line that says what went wrong, the raw bundler output behind "Show details". */
/** Where a preview build runs, for its status line. */
export const buildsWhere = (runner?: "local" | "cloud") =>
  runner === "cloud" ? "on GitHub Actions" : "on this machine";

export function BuildFailed({ error }: { error?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const raw = error?.trim() ?? "";
  return (
    <div role="status" className="mt-2 rounded-[10px] bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2 text-xs">
        <XCircle className="mt-px size-4 shrink-0 text-danger" aria-hidden />
        <p className="min-w-0 flex-1 pt-0.5 text-ink-secondary">
          <span className="font-medium text-danger">The preview build failed:</span>{" "}
          {raw ? summariseBuildError(raw) : "No reason given."}
        </p>
        {raw && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-ink-muted max-sm:h-11"
          >
            {open ? "Hide details" : "Show details"}
          </Button>
        )}
      </div>
      {raw && (
        <pre id={id} hidden={!open} className="mt-2 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
          {raw}
        </pre>
      )}
    </div>
  );
}

/** The warning row's one line, shown whenever PIVOT's scan has flags (null when it found nothing). */
export function scanWarning(scan?: { flags?: { kind: string; what: string }[] }) {
  const flags = scan?.flags ?? [];
  if (!flags.length) return null;
  if (flags.every((f) => f.kind === "host")) {
    const hosts = [...new Set(flags.map((f) => f.what))];
    const more = hosts.length - 1;
    return `Reaches ${hosts[0]}${more ? ` and ${more} other ${more === 1 ? "host" : "hosts"}` : ""}`;
  }
  return `PIVOT’s scan: ${flags.length} ${flags.length === 1 ? "flag" : "flags"}`;
}
