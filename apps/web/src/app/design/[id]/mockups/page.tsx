"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DesignSessionDetailDTO } from "@pivot/core/types";
import { MockupStage } from "@/components/mockup-stage";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** The session's mockups full screen, like the real site, with the controls in a drawer (`?round=&v=` pick one). */
function FullScreenMockups() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const {
    data: s,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["design-session", id],
    queryFn: () => api<DesignSessionDetailDTO>(`/api/design/sessions/${id}`),
    // a new round or an approval made elsewhere shows up without a reload
    refetchInterval: (q) =>
      q.state.data && ["exploring", "approved", "building"].includes(q.state.data.status) ? 5000 : false,
  });
  useEffect(() => {
    if (s) document.title = `${s.title} · Mockups · PIVOT`;
  }, [s]);

  if (isLoading)
    return (
      <div className="fixed inset-0 grid place-items-center bg-canvas text-ink-muted" role="status">
        <Loader2 className="size-5 animate-spin" aria-label="Loading the mockups" />
      </div>
    );
  if (error || !s || s.mockups.length === 0)
    return (
      <div className="fixed inset-0 grid place-items-center bg-canvas px-4 text-center">
        <div className="space-y-4">
          <p className="text-ink-muted">
            {error ? error.message : !s ? "No such design session." : "This session has no mockups yet."}
          </p>
          <Button variant="secondary" asChild>
            <Link href={s ? `/design/${id}` : "/design"}>
              <ArrowLeft /> {s ? "Back to the session" : "Design sessions"}
            </Link>
          </Button>
        </div>
      </div>
    );
  const round = Number(params.get("round")) || undefined;
  const n = Number(params.get("v")) || undefined;
  return <MockupStage session={s} asked={{ round, n }} />;
}

export default function MockupsPage() {
  return (
    <Suspense>
      <FullScreenMockups />
    </Suspense>
  );
}
