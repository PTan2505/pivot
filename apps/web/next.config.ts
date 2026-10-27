import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@stan-bag/core"],
  // Native / wasm packages must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite", "playwright", "playwright-core", "sharp", "postgres", "@aws-sdk/client-s3"],
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
