import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The npm package (apps/cli, `pnpm cli:build`) ships a self-contained server; a checkout keeps `next start`.
  output: process.env.PIVOT_STANDALONE === "1" ? "standalone" : undefined,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@pivot/core"],
  // Native / wasm packages must be loaded by Node at runtime, not bundled.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "playwright",
    "playwright-core",
    "sharp",
    "postgres",
    "@aws-sdk/client-s3",
  ],
  experimental: {
    // The proxy buffers request bodies; uploads can be up to 200 MB.
    proxyClientMaxBodySize: "210mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
