"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UiProvider } from "@/components/ui-store";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 } },
      }),
  );
  // PIVOT is dark only (ember and glass); next-themes stays for the `dark` class shadcn components key off.
  return (
    <ThemeProvider attribute="class" forcedTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          <UiProvider>
            {children}
            <Toaster position="bottom-right" />
          </UiProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
