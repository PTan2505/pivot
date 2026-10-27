"use client";

import { Suspense } from "react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { LibraryView } from "@/components/library-view";
import { Button } from "@/components/ui/button";
import { api, useCounts, useInvalidate } from "@/lib/api";

function EmptyTrash() {
  const { data: counts } = useCounts();
  const invalidate = useInvalidate();
  if (!counts?.trash) return null;
  return (
    <ConfirmButton
      title="Empty trash?"
      description={`${counts.trash} resource${counts.trash > 1 ? "s" : ""} and any files only they use will be deleted permanently.`}
      confirmLabel="Empty trash"
      onConfirm={async () => {
        const r = await api<{ deleted: number }>("/api/trash/empty", { method: "POST" });
        invalidate();
        toast.success(`Deleted ${r.deleted} permanently`);
      }}
    >
      <Button variant="destructive">Empty trash</Button>
    </ConfirmButton>
  );
}

export default function TrashPage() {
  return (
    <Suspense>
      <LibraryView
        mode="trash"
        title="Trash"
        subtitle="Deleted for good after 30 days."
        actions={<EmptyTrash />}
        emptyState={<p className="text-sm text-ink-muted">Trash is empty.</p>}
      />
    </Suspense>
  );
}
