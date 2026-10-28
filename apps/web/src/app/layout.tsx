import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { GlobalLayer } from "@/components/global-layer";
import { Providers } from "./providers";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PIVOT",
  description: "Personal UI/UX resource library",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="h-full overflow-hidden">
        <Providers>
          <AppShell>{children}</AppShell>
          <Suspense>
            <GlobalLayer />
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
