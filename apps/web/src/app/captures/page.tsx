"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CaptureAttemptDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { api, useInvalidate } from "@/lib/api";
import { cn } from "@/lib/utils";

type Attempt = CaptureAttemptDTO & { title: string; type: string };

const STATUS: Record<CaptureAttemptDTO["status"], string> = {
  deferred: "Requested for later",
  queued: "Queued",
  capturing: "Capturing",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  cancelled: "Cancelled",
};

const FILTERS = [
  { id: "all", label: "All", statuses: "" },
  { id: "requested", label: "Requested for later", statuses: "deferred" },
  { id: "active", label: "Queued & capturing", statuses: "queued,capturing" },
  { id: "problems", label: "Failed & partial", statuses: "failed,partial" },
] as const;

/** Every server capture, newest first: what is waiting, what is running, what failed and why. */
export default function CapturesPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const statuses = FILTERS.find((f) => f.id === filter)!.statuses;
  const invalidate = useInvalidate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["captures", statuses],
    queryFn: () => api<{ attempts: Attempt[] }>(`/api/captures?limit=100${statuses ? `&status=${statuses}` : ""}`),
    // keep it live while something is still running
    refetchInterval: (q) =>
      q.state.data?.attempts.some((a) => a.status === "queued" || a.status === "capturing") ? 2000 : false,
  });

  const act = async (a: Attempt, method: "POST" | "DELETE") => {
    try {
      await api(`/api/resources/${a.resourceId}/capture`, { method });
      toast.success(method === "POST" ? "Capture queued" : "Capture cancelled; saved screenshots are kept");
      invalidate(a.resourceId);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const runLater = async (a: Attempt, what: "run" | "drop") => {
    try {
      await api(what === "run" ? `/api/captures/${a.id}/run` : `/api/captures/${a.id}`, {
        method: what === "run" ? "POST" : "DELETE",
      });
      toast.success(what === "run" ? "Capturing now" : "Request dropped");
      invalidate(a.resourceId);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };
  const { data: health } = useQuery({
    queryKey: ["capture-health"],
    queryFn: () =>
      api<{
        failingSites: { host: string; failures: number; lastError: string | null }[];
        regressions: { resourceId: string; title: string; reasons: string[] }[];
      }>("/api/captures/health"),
  });

  const attempts = data?.attempts ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pt-10 pb-16 md:px-10">
      <div className="space-y-3">
        <h1 className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em]">Capture queue</h1>
        <p className="text-sm text-ink-muted">
          Screenshots PIVOT takes in the background. They keep going when the extension popup closes; progress is shown
          as a status, not a percentage.
        </p>
      </div>
      {health && (health.failingSites.length > 0 || health.regressions.length > 0) && (
        <section role="status" aria-label="Worth a look" className="space-y-1.5 rounded-[14px] bg-surface p-4 text-sm">
          <h2 className="text-ink">Worth a look</h2>
          {health.failingSites.map((h) => (
            <p key={h.host} className="text-ink-muted">
              <span className="text-warning">{h.host}</span> failed {h.failures} times this week with no success since
              {h.lastError ? `: ${h.lastError}` : "."} Retrying won’t help until that changes; upload a screenshot or
              use the extension.
            </p>
          ))}
          {health.regressions.map((r) => (
            <p key={r.resourceId} className="text-ink-muted">
              <Link href={`/r/${r.resourceId}`} className="text-ink hover:underline">
                {r.title}
              </Link>
              : the newest capture looks worse than an earlier one ({r.reasons.join(", ")}).
            </p>
          ))}
        </section>
      )}
      <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            role="radio"
            aria-checked={filter === f.id}
            variant={filter === f.id ? "default" : "secondary"}
            size="sm"
            className={cn(filter === f.id && "bg-inverse text-on-inverse hover:bg-inverse")}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Loading" />
      ) : attempts.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing here.</p>
      ) : (
        <ol className="space-y-2">
          {attempts.map((a) => {
            const ctx = a.context as {
              colorScheme?: string;
              theme?: string;
              retries?: number;
              expandContent?: boolean;
            };
            const running = a.status === "queued" || a.status === "capturing";
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-surface px-4 py-3"
              >
                <span
                  className={cn(
                    "rounded-full bg-surface-raised px-2.5 py-0.5 text-xs",
                    a.status === "failed"
                      ? "text-danger"
                      : a.status === "partial"
                        ? "text-warning"
                        : "text-ink-secondary",
                  )}
                >
                  {running && <Loader2 className="mr-1 inline size-3 animate-spin" aria-hidden />}
                  {STATUS[a.status]}
                </span>
                <Link href={`/r/${a.resourceId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                  {a.title}
                </Link>
                <time className="font-mono text-xs text-ink-subtle tabular-nums" dateTime={a.requestedAt}>
                  {new Date(a.requestedAt).toLocaleString()}
                </time>
                {a.status === "deferred" ? (
                  <span className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="secondary"
                      className="bg-surface-raised"
                      onClick={() => runLater(a, "run")}
                    >
                      Capture now
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => runLater(a, "drop")}>
                      Drop
                    </Button>
                  </span>
                ) : running ? (
                  <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={() => act(a, "DELETE")}>
                    Cancel
                  </Button>
                ) : (
                  (a.status === "failed" || a.status === "partial" || a.status === "cancelled") && (
                    <Button size="xs" variant="secondary" className="bg-surface-raised" onClick={() => act(a, "POST")}>
                      Retry
                    </Button>
                  )
                )}
                <p className="basis-full text-xs text-ink-muted">
                  {[
                    ctx.colorScheme ?? ctx.theme,
                    ctx.expandContent ? "expanded content" : null,
                    ctx.retries ? `${ctx.retries} automatic retr${ctx.retries > 1 ? "ies" : "y"}` : null,
                    a.quality === "needs_review" ? `needs review (${a.qualityReasons.join(", ")})` : null,
                    a.error,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
