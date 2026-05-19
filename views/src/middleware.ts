import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

// SEC-1 Phase 3: the auth cookies are httpOnly + SameSite=Strict. Next.js
// middleware runs server-side, where it CAN read httpOnly cookies. We treat
// the presence of either fa_access or fa_refresh as "the user has a session"
// and let the request through; the actual authorization happens on the API.
// If only fa_refresh exists (access expired), the first API call from the
// page will trigger an axios refresh interceptor and recover transparently.

export function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (
        PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api") ||
        pathname === "/favicon.ico"
    ) {
        return NextResponse.next();
    }

    const hasSession =
        request.cookies.get("fa_access") !== undefined ||
        request.cookies.get("fa_refresh") !== undefined;

    if (hasSession) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/dashboard/:path*"],
};
