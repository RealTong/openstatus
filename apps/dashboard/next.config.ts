import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.SELF_HOST === "true" ? "standalone" : undefined,
  images: {
    remotePatterns: [
      new URL("https://openstatus.dev/**"),
      new URL("https://www.openstatus.dev/**"),
    ],
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
