"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isOtherSection, TYPE_DEFS } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { useLibraryParams } from "@/hooks/use-library-params";
import { useSetShowOther, useUiSettings } from "@/lib/api";

/**
 * A link to Knowledge, Skills or one of their types while "Other resource types" is off: the page keeps its head and
 * says the types are hidden, with a way to show them, instead of an empty list. Filtered views that cover every type
 * (Inbox, a source's saves, a page's saves, a collection) open as usual.
 */
export function HiddenSectionGuard({ children }: { children: ReactNode }) {
  const params = useLibraryParams();
  const { data } = useUiSettings();
  const filtered = !!(params.via || params.review || params.url || params.collection);
  const other = !filtered && isOtherSection(params.section.id);
  const [revealed, setRevealed] = useState(false);
  // after "Show them", focus lands on the section's own heading once it has rendered
  useEffect(() => {
    if (!revealed || !data?.showOtherTypes) return;
    // the section renders a moment later: try for up to a second and a half
    let tries = 0;
    const t = setInterval(() => {
      const h1 = document.querySelector<HTMLElement>("main h1");
      h1?.focus({ preventScroll: true });
      if (document.activeElement === h1 || ++tries > 30) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [revealed, data?.showOtherTypes]);
  const heading = params.type && params.section.types.length > 1 ? TYPE_DEFS[params.type].plural : params.section.label;
  // until the setting is known, a hidden-type page shows only its head: never a list that then disappears
  if (other && data === undefined) return <HiddenSection heading={heading} skills={false} loading />;
  if (other && !data!.showOtherTypes)
    return (
      <HiddenSection heading={heading} skills={params.section.id === "skills"} onShown={() => setRevealed(true)} />
    );
  return children;
}

function HiddenSection({
  heading,
  skills,
  loading,
  onShown,
}: {
  heading: string;
  skills: boolean;
  loading?: boolean;
  onShown?: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const setShowOther = useSetShowOther();
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="flex flex-col gap-8 px-4 pt-8 pb-16 md:px-10 md:pt-10">
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="text-[clamp(44px,6vw,72px)] leading-[0.96] font-medium tracking-[-0.045em] text-balance text-ink outline-none"
      >
        {heading}
      </h1>
      {!loading && (
        <div className="max-w-xl rounded-[14px] bg-surface p-6">
          <h2 className="text-[22px] leading-7 font-medium tracking-[-0.01em] text-ink">These types are hidden</h2>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {skills
              ? "Skills are hidden in this PIVOT. Your items are still here."
              : "Prompts, snippets, coding rules, checklists and MCP configs are hidden in this PIVOT. Your items are still here."}
          </p>
          <Button
            variant="secondary"
            // on a surface card a secondary pill needs the raised surface to read as a button
            className="mt-5 bg-surface-raised text-ink"
            aria-disabled={setShowOther.isPending || undefined}
            onClick={() => {
              if (setShowOther.isPending) return;
              setShowOther.mutate(true, {
                onSuccess: () => {
                  toast.success("Knowledge and Skills added to the navigation");
                  onShown?.();
                },
                onError: (err) => toast.error(err instanceof Error ? err.message : "Could not show them"),
              });
            }}
          >
            Show them
          </Button>
        </div>
      )}
    </section>
  );
}
