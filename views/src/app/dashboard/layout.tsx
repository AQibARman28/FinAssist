"use client";

import { Sidebar } from "@/components/dashboard/Sidebar";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200">
            <Sidebar />
            <main className="md:ml-64 min-h-screen">
                {children}
            </main>
        </div>
    );
}
