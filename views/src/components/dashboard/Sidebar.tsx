"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Wallet, CreditCard, Target, Settings, LogOut, PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";

const menuItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: PieChart, label: "Analytics", href: "/dashboard/analytics" },
    { icon: Wallet, label: "Budgets", href: "/dashboard/budgets" },
    { icon: CreditCard, label: "Expenses", href: "/dashboard/expenses" },
    { icon: Target, label: "Goals", href: "/dashboard/goals" },
    { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const logout = useAuthStore((state) => state.logout);

    const handleLogout = () => {
        logout();
        router.push("/login");
    };

    return (
        <aside className="hidden md:flex flex-col w-64 h-screen bg-black/60 backdrop-blur-xl border-r border-white/5 fixed left-0 top-0">
            <div className="p-8">
                <h1 className="text-2xl font-light tracking-wide text-white flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7]" />
                    FinAssist
                </h1>
            </div>

            <nav className="flex-1 px-4 space-y-2">
                {menuItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group",
                                isActive
                                    ? "bg-purple-500/10 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.15)]"
                                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                            )}
                        >
                            <item.icon className={cn("w-5 h-5", isActive ? "stroke-[2.5px]" : "stroke-2")} />
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-white/5">
                <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <LogOut className="w-5 h-5" />
                    <span className="font-medium">Sign Out</span>
                </button>
            </div>
        </aside>
    );
}
