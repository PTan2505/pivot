"use client";

import { ClipboardCopy, PackageOpen, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { LibraryView } from "@/components/library-view";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/ui-store";
import { copyContext } from "@/hooks/use-copy-resource";
import { api, useInvalidate } from "@/lib/api";
import type { CollectionDTO } from "@stan-bag/core/types";

function NameInput({ id, initial }: { id: string; initial: string }) {
  const [name, setName] = useState(initial);
  const invalidate = useInvalidate();
  const rename = async () => {
    if (!name.trim() || name === initial) return setName(initial);
    await api(`/api/collections/${id}`, { method: "PATCH", json: { name } });
    invalidate();
  };
  return (
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={rename}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      aria-label="Collection name"
      className="min-w-0 bg-transparent text-sm font-semibold outline-none"
      size={Math.max(8, name.length)}
    />
  );
}

function CollectionHeader({ id }: { id: string }) {
  const router = useRouter();
  const invalidate = useInvalidate();
  const { openExport } = useUi();
  const { data } = useQuery({ queryKey: ["collection", id], queryFn: () => api<CollectionDTO>(`/api/collections/${id}`) });
  const ids = useQuery({
    queryKey: ["resources", { collection: id, ids: true }],
    queryFn: () => api<{ id: string }[]>(`/api/resources?collection=${id}`),
  });
  const all = ids.data?.map((r) => r.id) ?? [];

  return (
    <>
      {data && <NameInput key={data.name} id={id} initial={data.name} />}
      <Button variant="ghost" size="sm" disabled={!all.length} onClick={() => copyContext(all)}>
        <ClipboardCopy /> Copy context
      </Button>
      <Button variant="ghost" size="sm" disabled={!all.length} onClick={() => openExport({ ids: all, name: data?.name ?? "collection" })}>
        <PackageOpen /> Export
      </Button>
      <ConfirmButton
        title={`Delete “${data?.name}”?`}
        description="Only the collection is deleted. Its resources stay in your library."
        confirmLabel="Delete collection"
        onConfirm={async () => {
          await api(`/api/collections/${id}`, { method: "DELETE" });
          invalidate();
          router.push("/");
          toast.success("Collection deleted");
        }}
      >
        <Button variant="ghost" size="icon-sm" aria-label="Delete collection" className="hover:text-destructive">
          <Trash2 />
        </Button>
      </ConfirmButton>
    </>
  );
}

function CollectionFromParams() {
  const { id } = useParams<{ id: string }>();
  return (
    <LibraryView
      key={id}
      collectionId={id}
      title={<span className="sr-only">Collection</span>}
      headerExtra={<CollectionHeader id={id} />}
      emptyState={
        <div className="max-w-sm space-y-2">
          <p className="text-sm font-medium">This collection is empty</p>
          <p className="text-sm text-muted-foreground">Select resources in the library and choose “Collection”, or add from a resource’s detail page.</p>
        </div>
      }
    />
  );
}

export default function CollectionPage() {
  return (
    <Suspense>
      <CollectionFromParams />
    </Suspense>
  );
}
