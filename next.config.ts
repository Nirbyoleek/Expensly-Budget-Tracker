import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // The repo lives in iCloud-synced ~/Documents; iCloud skips names ending in .nosync, so local builds
  // don't get "* 2" duplicate chunks. Vercel and CI keep the standard .next.
  distDir: process.env.VERCEL || process.env.CI ? ".next" : ".next.nosync",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
