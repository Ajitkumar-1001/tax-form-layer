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
  // The queue lived at / until the overview took it. Its old links (/?c=D01, /?area=…&mine=0) land on /queue with their
  // query string. One rule per key, because every `has` item must match; the destination is fixed, so nothing can
  // redirect off site.
  async redirects() {
    return ["c", "area", "mine", "q"].map((key) => ({
      source: "/",
      has: [{ type: "query" as const, key }],
      destination: "/queue",
      permanent: false,
    }));
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
