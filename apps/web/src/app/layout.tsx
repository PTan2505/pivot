import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { GlobalLayer } from "@/components/global-layer";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin", "vietnamese"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Stan Bag",
  description: "Personal UI/UX resource library",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
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
