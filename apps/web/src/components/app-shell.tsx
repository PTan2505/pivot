"use client";

import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { TopBar } from "@/components/top-bar";

/** Pages that fill the window on their own, with no top bar: the full-screen mockup view. */
const BARE = /^\/design\/[^/]+\/mockups\/?$/;

/** The top bar, except on a bare page. Reads the path, so it sits inside Suspense (it would block prerendering). */
function Chrome() {
  return BARE.test(usePathname()) ? null : <TopBar />;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={null}>
        <Chrome />
      </Suspense>
      {/* The page scrolls (not an inner panel) so the work passes under the fixed glass bar; the main area starts
          below it using the bar's measured height, and below 1024px it ends above the section dock. A bare page draws
          itself fixed over the whole window, so this padding doesn't show there. */}
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 pt-(--topbar-h) outline-none max-lg:pb-[calc(84px+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
    </div>
  );
}
