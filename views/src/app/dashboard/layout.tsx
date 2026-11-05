"use client";

import { Sidebar } from "@/components/dashboard/Sidebar";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { QuickAddHost } from "@/components/dashboard/QuickAddHost";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200">
            {/* First Tab stop: skip the navigation and go straight to the page. */}
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:px-4 focus:py-3 focus:rounded-xl focus:bg-graphite-raised focus:text-white focus:border focus:border-white/10 focus-ring"
            >
                Skip to content
            </a>
            <Sidebar />
            {/* On phones the page clears the status bar at the top and the tab
                bar (with its raised quick-add button) at the bottom. On wider
                screens it starts beside the 80px icon rail. */}
            <main
                id="main"
                tabIndex={-1}
                className="md:ml-20 min-h-screen outline-none pt-[env(safe-area-inset-top)] md:pt-0 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-12"
            >
                {children}
            </main>
            <MobileNav />
            <QuickAddHost />
        </div>
    );
}
