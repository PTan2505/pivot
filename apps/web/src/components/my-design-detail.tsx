"use client";

// The page of one of the owner's saved designs (type `my_design`, docs/my-designs-plan.md Phase 3). No new layout: it
// is the component page (component-detail.tsx, design session 118304e2) with a design's facts. A stage with Preview /
// Code tabs and Install in the main column, then Usage; the design's facts at the top of the side panel. The code is
// read-only: PIVOT keeps it as saved, and reuse goes through get_my_design or Download zip. Declutter (direction C
// "Inspector", 2026-11-25): Preview / Code / How to use tabs, the shots switched by viewport under the stage instead of
// a pill per shot over it, and the side panel's rows rendered by resource-detail.tsx's inspector from the parts here.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, FileCode, Hammer, Image as ImageIcon, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { myDesignPreviewPlan } from "@pivot/core/preview-plan";
import type { AssetDTO, DesignSessionDTO, MyDesignKind, MyDesignMeta } from "@pivot/core/types";
import {
  baseName,
  BuildFailed,
  CHIP,
  CodeView,
  CopyButton,
  LivePreview,
  STAGE,
  StageControls,
  StageEmpty,
  useReducedMotion,
} from "@/components/code-stage";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const myDesignMeta = (meta: Record<string, unknown>) => (meta?.myDesign ?? null) as MyDesignMeta | null;

export const KIND_LABEL: Record<MyDesignKind, string> = {
  component: "Component",
  section: "Section",
  page: "Page",
  effect: "Effect",
  animation: "Animation",
  "3d": "3D",
  logo: "Logo",
  theme: "Theme",
  email: "Email",
};

const ROLE_ORDER = { component: 0, demo: 1, style: 2, support: 3 } as const;
const ROLE_LABEL = { component: "Component", demo: "Demo", style: "Style", support: "Support" } as const;
const orderedFiles = (files: MyDesignMeta["files"]) =>
  [...files].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.path.localeCompare(b.path));

type DesignTab = "preview" | "code" | "usage";

/** The tab, file and line on show live in the URL (`?tab=code&file=…&line=…`), as on the component page. */
function useDesignView(d: MyDesignMeta) {
  const params = useSearchParams();
  const asked = params.get("tab");
  const tab: DesignTab = asked === "code" || asked === "usage" ? asked : "preview";
  const files = orderedFiles(d.files);
  const file = files.find((f) => f.path === params.get("file"))?.path ?? files[0]?.path ?? "";
  const line = Number(params.get("line")) || 0;
  const go = (next: { tab?: DesignTab; file?: string; line?: number }) => {
    const sp = new URLSearchParams(window.location.search);
    const t = next.tab ?? tab;
    if (t !== "preview") sp.set("tab", t);
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

/** The About row's summary: its kind and the project it came from. */
export function myDesignAboutSummary(d: MyDesignMeta) {
  return `${KIND_LABEL[d.kind]}${d.source.project ? ` · from ${d.source.project}` : ""}`;
}

// ---- main column: stage, code, install, usage -------------------------------------------------------------------

/** The live preview when PIVOT has built one, else the screenshots and video saved with the design. */
function Stage({
  d,
  id,
  title,
  media,
  onShowCode,
}: {
  d: MyDesignMeta;
  id: string;
  title: string;
  media: AssetDTO[];
  onShowCode: () => void;
}) {
  const live = d.preview?.sha256 ? d.preview : null;
  const plan = myDesignPreviewPlan(d);
  const [mode, setMode] = useState<"live" | "shots">("live");
  const build = plan.kind !== "none" ? <BuildButton d={d} id={id} /> : null;
  const notes = <BuildNotes d={d} />;
  if (live && (mode === "live" || media.length === 0)) {
    return (
      <div>
        <LivePreview
          sha256={live.sha256!}
          title={title}
          viewport={1440}
          extra={
            <>
              {build}
              {media.length > 0 && (
                <Button variant="secondary" size="xs" onClick={() => setMode("shots")}>
                  <ImageIcon /> Show screenshots
                </Button>
              )}
            </>
          }
        />
        <p className="mt-2 text-xs text-ink-subtle">
          PIVOT’s live preview, running on its own origin with no network.
          {live.builtFrom && live.builtFrom !== d.codeSha256 && " Built from earlier code."}
        </p>
        {notes}
      </div>
    );
  }
  return (
    <div>
      <ShotStage
        title={title}
        media={media}
        onShowCode={onShowCode}
        emptyBody={plan.kind === "none" ? plan.reason : "Build preview makes a live one on this machine."}
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
      {media.length > 0 && (
        <p className="mt-2 text-xs text-ink-subtle">
          Screenshots saved with the design.
          {plan.kind === "none" ? ` ${plan.reason.split(";")[0]}.` : !live && " Build preview makes a live one."}
        </p>
      )}
      {notes}
    </div>
  );
}

const viewportOf = (a: AssetDTO) => (a.meta as { viewport?: string } | null)?.viewport;

/**
 * The saved screenshots and videos, one at a time. Under the stage: one pill per kind (Desktop, Mobile, Video) and,
 * when a kind has several, a ‹ 2 / 4 › stepper, so every shot stays one or two presses away without covering it.
 */
function ShotStage({
  title,
  media,
  onShowCode,
  emptyBody,
  extra,
}: {
  title: string;
  media: AssetDTO[];
  onShowCode: () => void;
  emptyBody: string;
  extra?: React.ReactNode;
}) {
  const shots = media.filter((a) => a.role === "design-shot");
  const videos = media.filter((a) => a.role === "design-video");
  const [shown, setShown] = useState(shots[0]?.id ?? videos[0]?.id ?? "");
  const reduced = useReducedMotion();
  if (media.length === 0) {
    return (
      <StageEmpty title="No preview saved" body={emptyBody}>
        {extra}
        <Button variant="secondary" size="xs" onClick={onShowCode}>
          <FileCode /> Show code
        </Button>
      </StageEmpty>
    );
  }
  const current = media.find((a) => a.id === shown) ?? media[0];
  const labels = new Map<string, string>();
  shots.forEach((s, i) => {
    const vp = viewportOf(s);
    const same = shots.filter((x) => viewportOf(x) === vp).length > 1;
    labels.set(s.id, vp ? `${vp === "mobile" ? "Mobile" : "Desktop"}${same ? ` ${i + 1}` : ""}` : `Shot ${i + 1}`);
  });
  const groups = [
    { key: "desktop", label: "Desktop", items: shots.filter((a) => viewportOf(a) && viewportOf(a) !== "mobile") },
    { key: "mobile", label: "Mobile", items: shots.filter((a) => viewportOf(a) === "mobile") },
    { key: "shots", label: "Shots", items: shots.filter((a) => !viewportOf(a)) },
    { key: "video", label: "Video", items: videos },
  ].filter((g) => g.items.length > 0);
  const group = groups.find((g) => g.items.some((a) => a.id === current.id)) ?? groups[0];
  const at = group.items.findIndex((a) => a.id === current.id);
  const step = (by: number) => setShown(group.items[(at + by + group.items.length) % group.items.length].id);
  const noun = group.key === "video" ? "video" : "shot";
  return (
    <div className="relative rounded-[14px] bg-surface p-3">
      {current.role === "design-video" ? (
        <video
          key={current.id}
          src={`/api/assets/${current.id}`}
          className={cn("block rounded-[10px] bg-canvas object-contain", STAGE)}
          controls
          muted
          playsInline
          loop
          autoPlay={!reduced}
          aria-label={`Video of ${title}`}
        />
      ) : (
        // a screen-shaped window that scrolls: a shot keeps its own proportions, and a full-page one scrolls in it
        <div
          key={current.id}
          tabIndex={0}
          role="region"
          aria-label={`${labels.get(current.id) ?? "Screenshot"}, scrolls`}
          className={cn("overflow-y-auto overscroll-contain rounded-[10px] bg-canvas", STAGE)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored screenshot, served by PIVOT's asset route */}
          <img
            src={`/api/assets/${current.id}`}
            alt={`${labels.get(current.id) ?? "Screenshot"} of ${title}`}
            className={cn("block h-auto", viewportOf(current) === "mobile" ? "mx-auto w-full max-w-[390px]" : "w-full")}
          />
        </div>
      )}
      {extra && <StageControls>{extra}</StageControls>}
      {media.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {groups.length > 1 && (
            <div role="group" aria-label="Which view" className="flex flex-wrap gap-1">
              {groups.map((g) => (
                <Button
                  key={g.key}
                  variant="secondary"
                  size="sm"
                  aria-pressed={g.key === group.key}
                  className={cn(
                    "bg-surface-raised max-sm:h-11",
                    g.key === group.key && "bg-inverse text-on-inverse hover:bg-inverse hover:text-on-inverse",
                  )}
                  onClick={() => setShown(g.items[0].id)}
                >
                  {g.key === "video" && <Play />}
                  {g.label}
                  {g.items.length > 1 && <span className="font-mono text-xs opacity-70">{g.items.length}</span>}
                </Button>
              ))}
            </div>
          )}
          {group.items.length > 1 && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className="max-sm:size-11"
                aria-label={`Previous ${group.label.toLowerCase()} ${noun}`}
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </Button>
              <span className="min-w-12 text-center font-mono text-xs text-ink-muted tabular-nums" aria-live="polite">
                {at + 1} / {group.items.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="max-sm:size-11"
                aria-label={`Next ${group.label.toLowerCase()} ${noun}`}
                onClick={() => step(1)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Build preview: a React design installs its npm packages (exact versions, registry.npmjs.org, install scripts off) and
 * is bundled on this machine; an HTML demo is bundled and inlined. Off while a build runs.
 */
function BuildButton({ d, id }: { d: MyDesignMeta; id: string }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const building = d.preview?.status === "building";
  const start = async () => {
    setAsking(true);
    try {
      await api(`/api/my-designs/${id}/preview`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["resource", id] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The build couldn’t start.");
    } finally {
      setAsking(false);
    }
  };
  const npm = myDesignPreviewPlan(d).kind === "react" || d.dependencies.length > 0;
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={start}
      disabled={building || asking}
      title={
        npm
          ? "Installs its npm packages at their saved versions from registry.npmjs.org (install scripts off) and bundles it on this machine"
          : "Bundles its demo page into one file on this machine"
      }
    >
      {building || asking ? <Loader2 className="animate-spin" /> : <Hammer />}
      {building ? "Building…" : d.preview?.sha256 ? "Rebuild preview" : "Build preview"}
    </Button>
  );
}

function BuildNotes({ d }: { d: MyDesignMeta }) {
  const p = d.preview;
  if (p?.status === "building")
    return (
      <p role="status" className="mt-1 text-xs text-ink-muted">
        Building the preview
        {myDesignPreviewPlan(d).kind === "react" || d.dependencies.length > 0
          ? ": installing its npm packages at their saved versions with install scripts off, then bundling it on this machine…"
          : ": bundling its demo page on this machine…"}
      </p>
    );
  if (p?.status === "failed") return <BuildFailed error={p.error} />;
  return null;
}

function InstallPanel({ d }: { d: MyDesignMeta }) {
  const cmdRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const command = d.dependencies.length
    ? `npm install ${d.dependencies.map((x) => `${x.name}@${x.version}`).join(" ")}`
    : "";
  const select = () => {
    const r = document.createRange();
    if (!cmdRef.current) return;
    r.selectNodeContents(cmdRef.current);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
  };
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-[14px] bg-surface p-4">
      <h2 id={headingId} className="text-sm font-medium text-ink">
        Install
      </h2>
      {command ? (
        <div className="flex items-start gap-2 rounded-[10px] bg-surface-raised py-2 pr-2 pl-3">
          <code
            ref={cmdRef}
            className="min-w-0 flex-1 pt-0.5 font-mono text-[12.5px] leading-relaxed break-all text-ink-secondary"
          >
            {command}
          </code>
          <CopyButton text={command} label="Copy command" name="install command" selectOnFail={select} />
        </div>
      ) : (
        <p className="text-sm text-ink-muted">No npm packages: copy the files from Code, or download the zip.</p>
      )}
      {d.install.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-secondary marker:text-ink-subtle">
          {d.install.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {d.dependencies.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Dependencies">
          {d.dependencies.map((x) => (
            <li key={x.name} className={CHIP}>
              <span className="font-normal text-ink-secondary">npm</span> {x.name}
              <span className="font-mono font-normal text-ink-muted">{x.version}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The usage notes, then the tokens it relies on, folded (often a long table). */
function UsagePanel({ d }: { d: MyDesignMeta }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-[14px] bg-surface p-4">
      <h2 id={headingId} className="text-sm font-medium text-ink">
        Usage
      </h2>
      <div className="text-sm text-ink-secondary">
        <Markdown>{d.usage}</Markdown>
      </div>
      {d.tokens.length > 0 && (
        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full py-1 text-xs text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 group-open:rotate-90" aria-hidden />
            Tokens it relies on ({d.tokens.length})
          </summary>
          <dl className="mt-2 grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-1.5 rounded-[10px] bg-surface-raised p-3 font-mono text-[12.5px]">
            {d.tokens.map((t) => (
              <div key={t.name} className="contents">
                <dt className="min-w-0 break-all text-ink">{t.name}</dt>
                <dd className="min-w-0 break-all text-ink-muted">{t.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

const TAB_CLASS =
  "px-4 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-text";
const PANEL_CLASS = "motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0";

/** The main column: Preview / Code / How to use (install, usage and tokens) over one stage. */
export function MyDesignMain({
  d,
  id,
  title,
  assets,
}: {
  d: MyDesignMeta;
  id: string;
  title: string;
  assets: AssetDTO[];
}) {
  const view = useDesignView(d);
  const media = assets.filter((a) => a.role === "design-shot" || a.role === "design-video");
  return (
    <div className="min-w-0">
      <Tabs value={view.tab} onValueChange={(t) => view.go({ tab: t as DesignTab })} className="gap-3">
        <TabsList aria-label="Preview, code or how to use" className="max-sm:w-full">
          <TabsTrigger value="preview" className={TAB_CLASS}>
            Preview
          </TabsTrigger>
          <TabsTrigger value="code" className={TAB_CLASS}>
            Code
          </TabsTrigger>
          <TabsTrigger value="usage" className={TAB_CLASS}>
            How to use
          </TabsTrigger>
        </TabsList>
        <TabsContent value="preview" tabIndex={-1} className={PANEL_CLASS}>
          <Stage d={d} id={id} title={title} media={media} onShowCode={() => view.go({ tab: "code" })} />
        </TabsContent>
        <TabsContent value="code" tabIndex={-1} className={cn("space-y-4 rounded-[14px] bg-surface p-4", PANEL_CLASS)}>
          <CodeView
            files={view.files}
            file={view.file}
            line={view.line}
            onFile={(file) => view.go({ tab: "code", file })}
            roleLabel={(role) => ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? role}
          />
          {d.assets.length > 0 && <OtherFiles d={d} />}
        </TabsContent>
        <TabsContent value="usage" tabIndex={-1} className={cn("space-y-3", PANEL_CLASS)}>
          <InstallPanel d={d} />
          <UsagePanel d={d} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** The design's non-code files (SVG, fonts, models), each at the path it goes to. */
function OtherFiles({ d }: { d: MyDesignMeta }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs text-ink-subtle">Other files, written to these paths on reuse</h3>
      <ul className="space-y-1">
        {d.assets.map((a) => (
          <li
            key={a.path}
            className="flex items-center gap-3 rounded-[10px] bg-surface-raised px-3 py-2 font-mono text-xs text-ink-secondary"
          >
            <a
              href={`/api/assets/${a.assetId}`}
              download={baseName(a.path)}
              className="min-w-0 flex-1 truncate text-accent-text hover:underline"
            >
              {a.path}
            </a>
            <span className="shrink-0 text-ink-subtle">{size(a.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- inspector rows ------------------------------------------------------------------------------------------------

/** The About row: its kind, the project and the sessions it came from. */
export function MyDesignAbout({ d }: { d: MyDesignMeta }) {
  const { data } = useQuery({
    queryKey: ["design-sessions"],
    queryFn: () => api<{ sessions: DesignSessionDTO[] }>("/api/design/sessions?limit=200"),
    staleTime: 60_000,
    enabled: !!d.source.sessionIds?.length,
  });
  const titles = new Map((data?.sessions ?? []).map((s) => [s.id, s.title]));
  return (
    <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-ink-subtle">Kind</dt>
      <dd className="min-w-0 text-ink-secondary">{KIND_LABEL[d.kind]}</dd>
      {d.source.project && (
        <>
          <dt className="text-ink-subtle">Project</dt>
          <dd className="min-w-0 break-words text-ink-secondary">{d.source.project}</dd>
        </>
      )}
      {!!d.source.sessionIds?.length && (
        <>
          <dt className="text-ink-subtle">Sessions</dt>
          <dd className="min-w-0 space-y-1">
            {d.source.sessionIds.map((s) => (
              <Link key={s} href={`/design/${s}`} className="block truncate text-accent-text hover:underline">
                {titles.get(s) ?? "Design session"}
              </Link>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

/** For Technical details (inside its `<dl>`): the folder it came from, its dates and files, read-only. */
export function MyDesignTechnical({ d }: { d: MyDesignMeta }) {
  return (
    <>
      {d.source.folder && (
        <>
          <dt>Folder</dt>
          <dd className="min-w-0 font-mono break-all text-ink-muted">{d.source.folder}</dd>
        </>
      )}
      <dt>Saved</dt>
      <dd className="font-mono text-ink-muted">{d.savedAt.slice(0, 10)}</dd>
      {d.codeSavedAt !== d.savedAt && (
        <>
          <dt>Code saved</dt>
          <dd className="font-mono text-ink-muted">{d.codeSavedAt.slice(0, 10)}</dd>
        </>
      )}
      <dt>Code files</dt>
      <dd className="font-mono text-ink-muted">
        {d.files.length}
        {d.assets.length > 0 && ` · ${d.assets.length} other`}
      </dd>
    </>
  );
}

/** For Technical details: PIVOT's scan of its code, each flag opening the Code tab at its line. */
export function MyDesignScan({ d }: { d: MyDesignMeta }) {
  const view = useDesignView(d);
  const flags = d.scan?.flags ?? [];
  const inFiles = new Set(d.files.map((f) => f.path));
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs text-ink-subtle">
        PIVOT’s scan · {flags.length ? `${flags.length} ${flags.length === 1 ? "flag" : "flags"}` : "found nothing"}
      </h3>
      {flags.length > 0 && (
        <ul className="space-y-1.5">
          {flags.slice(0, 20).map((f, i) => (
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
              </span>
            </li>
          ))}
        </ul>
      )}
      {flags.length > 20 && <p className="text-xs text-ink-subtle">…and {flags.length - 20} more.</p>}
    </div>
  );
}
