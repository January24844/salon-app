import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Panel salonu zawsze pokazuje świeże dane zalogowanej osoby,
  // więc nie używamy prerenderingu stron (Cache Components).
  cacheComponents: false,
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
