import type { NextConfig } from "next";

// The browser only ever talks to THIS origin. `/api/*` is forwarded to the
// Express backend by src/proxy.ts (which adds the shared proxy secret); the
// rewrite below is a fallback with the same destination. Same-origin is what
// makes the httpOnly + SameSite=Strict auth cookies work, and it removes CORS.
//
// BACKEND_ORIGIN is a SERVER-side env var (no NEXT_PUBLIC_ prefix), set in the
// Vercel dashboard to the deployed backend URL. Locally it defaults to the dev
// backend on :5000.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:5000";

// Static security headers for every page. The Content-Security-Policy is set
// per request in src/proxy.ts because it carries a fresh nonce.
const SECURITY_HEADERS = [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
        : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` },
    ];
  },
};

export default nextConfig;
