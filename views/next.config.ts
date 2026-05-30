import type { NextConfig } from "next";

// The browser only ever talks to THIS origin. `/api/*` is rewritten (proxied)
// to the Express backend, so the app and API are same-origin in every
// environment. That's what makes the httpOnly + SameSite=Strict auth cookies
// work in production, and it removes CORS entirely.
//
// BACKEND_ORIGIN is a SERVER-side env var (no NEXT_PUBLIC_ prefix), set in the
// Vercel dashboard to the deployed backend URL. Locally it defaults to the dev
// backend on :5000.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:5000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` },
    ];
  },
};

export default nextConfig;
