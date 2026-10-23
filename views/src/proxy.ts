import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16 proxy (formerly middleware). Three jobs:
//
// 1. /api/* → forward to the Express backend with the shared proxy secret, so
//    the API can refuse anything that didn't come through this app (a direct
//    call to the backend URL could otherwise forge X-Forwarded-For and dodge
//    per-IP limits). A client-supplied copy of the header is always dropped.
// 2. Pages → a fresh CSP nonce per request. Next applies it to its own
//    scripts; the root layout opts into dynamic rendering so it can.
// 3. /dashboard → bounce to /login when neither session cookie is present.
//    Real authorization happens on the API; the cookies are httpOnly +
//    SameSite=Strict and this runs server-side, where it can see them.

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:5000";
const PROXY_HEADER = "x-finassist-proxy";

function contentSecurityPolicy(nonce: string): string {
    const isDev = process.env.NODE_ENV === "development";
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
        // React and Recharts render inline style attributes; styles can't run code.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        `connect-src 'self'${isDev ? " ws:" : ""}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
}

export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;

    if (pathname.startsWith("/api/")) {
        const headers = new Headers(request.headers);
        headers.delete(PROXY_HEADER);
        const secret = process.env.PROXY_SHARED_SECRET;
        if (secret) headers.set(PROXY_HEADER, secret);
        return NextResponse.rewrite(new URL(pathname + search, BACKEND_ORIGIN), { request: { headers } });
    }

    if (pathname.startsWith("/dashboard")) {
        const hasSession =
            request.cookies.get("fa_access") !== undefined ||
            request.cookies.get("fa_refresh") !== undefined;
        if (!hasSession) {
            const loginUrl = new URL("/login", request.url);
            loginUrl.searchParams.set("from", pathname);
            return NextResponse.redirect(loginUrl);
        }
    }

    const nonce = btoa(crypto.randomUUID());
    const csp = contentSecurityPolicy(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
}

export const config = {
    matcher: [
        "/api/:path*",
        {
            // Everything except static assets and the service worker files.
            source: "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|manifest.webmanifest).*)",
            missing: [
                { type: "header", key: "next-router-prefetch" },
                { type: "header", key: "purpose", value: "prefetch" },
            ],
        },
    ],
};
