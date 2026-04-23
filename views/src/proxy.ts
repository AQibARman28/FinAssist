import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public routes and Next.js internals
    if (
        PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
        pathname.startsWith("/_next") ||
        pathname.startsWith("/api") ||
        pathname === "/favicon.ico"
    ) {
        return NextResponse.next();
    }

    // Check for auth token in cookies (set by the client-side Zustand persist)
    const authCookie = request.cookies.get("finassist-auth");

    if (authCookie) {
        try {
            const parsed = JSON.parse(authCookie.value);
            if (parsed?.state?.token) return NextResponse.next();
        } catch {
            // malformed cookie — fall through to redirect
        }
    }

    // No valid session — redirect to login
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/dashboard/:path*"],
};
