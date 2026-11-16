"use client";

import { Suspense, type ReactNode } from "react";
import { TopBar } from "@/components/top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <Suspense fallback={null}>
        <TopBar />
      </Suspense>
      {/* The page scrolls (not an inner panel) so the work passes under the fixed glass bar; the main area starts
          below it using the bar's measured height, and below 1024px it ends above the section dock. */}
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
