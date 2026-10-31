"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DesignSessionDTO } from "@pivot/core/types";
import { api } from "@/lib/api";
import { DESIGN_STATUS_LABEL } from "@/components/design-session";

/** Design work done with the pivot-design skill: one session per piece of work, newest first. */
export default function DesignSessionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["design-sessions"],
    queryFn: () => api<{ sessions: DesignSessionDTO[] }>("/api/design/sessions?limit=200"),
  });
  const sessions = data?.sessions ?? [];
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pt-10 pb-16 md:px-10">
      <div className="space-y-3">
        <h1 className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em]">Design sessions</h1>
        <p className="text-sm text-ink-muted">
          Briefs and decisions from Claude Code’s design work, kept here instead of in the project’s repository. A
          session starts with the first complete brief; small fixes don’t make one.
        </p>
      </div>
      {isLoading ? (
        <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Loading" />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          None yet. They appear when the pivot-design skill saves its first brief.
        </p>
      ) : (
        <ol className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/design/${s.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-surface px-4 py-3 hover:bg-surface-raised"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{s.title}</span>
                <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-xs text-ink-secondary">
                  {DESIGN_STATUS_LABEL[s.status]}
                </span>
                <span className="basis-full text-xs text-ink-muted">
                  {[s.targetProject, s.surface, `updated ${new Date(s.updatedAt).toLocaleDateString()}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
