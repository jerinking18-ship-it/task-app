import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
