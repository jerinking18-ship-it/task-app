import type { NextConfig } from "next";
import { securityHeaders } from "./security/headers.mjs";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: securityHeaders({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        development: process.env.NODE_ENV === "development",
      }),
    }];
  },
  // Callback URLs carry one-time codes. Keep them out of development logs.
  logging: { incomingRequests: { ignore: [/^\/auth\/callback(?:\?|$)/] } },
  turbopack: {
    root: process.cwd(),
    rules: {
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
