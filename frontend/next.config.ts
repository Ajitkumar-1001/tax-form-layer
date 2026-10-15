import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  // Ship the sealed packet copy (src/lib/packet.ts) and the schema (src/lib/server/db.ts) with every server function.
  outputFileTracingIncludes: { "/**": ["./data/**", "./src/db/schema.sql"] },
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
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
