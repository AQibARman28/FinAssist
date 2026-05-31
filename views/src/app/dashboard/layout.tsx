"use client";

import { Sidebar } from "@/components/dashboard/Sidebar";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { QuickExpenseFab } from "@/components/dashboard/QuickExpenseFab";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200">
            <Sidebar />
            <MobileNav />
            <main className="md:ml-64 min-h-screen">
                {children}
            </main>
            <QuickExpenseFab />
        </div>
    );
}
