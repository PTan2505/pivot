import { Suspense } from "react";
import { HiddenSectionGuard } from "@/components/hidden-section";
import { LibraryView } from "@/components/library-view";

export default function LibraryPage() {
  return (
    <Suspense>
      <HiddenSectionGuard>
        <LibraryView />
      </HiddenSectionGuard>
    </Suspense>
  );
}
