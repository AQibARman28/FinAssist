"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { openQuickAdd } from "@/lib/quickAdd";
import { menuItems } from "./navItems";

// Each rail icon's name, shown beside it on hover and on keyboard focus. It is
// real text in the control, so screen readers read it as the control's name.
function RailLabel({ children }: { children: React.ReactNode }) {
    return (
        <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 -translate-y-1/2 -translate-x-1 whitespace-nowrap rounded-lg bg-graphite-raised px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-100 opacity-0 shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_12px_24px_-12px_rgb(0_0_0/0.8)] transition-[opacity,translate] duration-150 ease-out-expo group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
            {children}
        </span>
    );
}

const railItem = "group relative grid place-items-center w-12 h-12 rounded-2xl transition-colors focus-ring";

// The desktop navigation: a slim icon rail, so the page gets the width.
// Quick add sits right under the monogram, the app's most frequent action.
export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const logout = useAuthStore((state) => state.logout);

    const handleLogout = async () => {
        await logout();
        router.push("/login");
    };

    return (
        <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-20 flex-col items-center gap-1.5 py-5 bg-zinc-950 border-r border-white/[0.06]">
            <Link href="/dashboard" className={cn(railItem, "metal-chip mb-1 w-11 h-11 rounded-[14px]")}>
                <span aria-hidden className="text-[11px] font-semibold tracking-[0.12em] pl-[0.12em] [font-stretch:125%]">FA</span>
                <RailLabel>FinAssist home</RailLabel>
            </Link>

            <button type="button" onClick={openQuickAdd} className={cn(railItem, "mb-4 bg-plat text-plat-ink hover:bg-white")}>
                <Plus className="w-5 h-5" aria-hidden />
                <RailLabel>Quick add expense</RailLabel>
            </button>

            <nav aria-label="Main" className="flex flex-col items-center gap-1.5">
                {menuItems.map((item) => {
                    const isActive = pathname === item.href
                        || (item.href !== "/dashboard" && pathname?.startsWith(item.href + "/"));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(railItem, isActive ? "bg-white/[0.09] text-white" : "text-zinc-400 hover:text-white hover:bg-white/[0.05]")}
                        >
                            <item.icon className="w-5 h-5" strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
                            {isActive && <span aria-hidden className="absolute -left-4 top-3 bottom-3 w-px bg-plat" />}
                            <RailLabel>{item.label}</RailLabel>
                        </Link>
                    );
                })}
            </nav>

            <button type="button" onClick={handleLogout} className={cn(railItem, "mt-auto text-zinc-400 hover:text-red-300 hover:bg-red-500/10")}>
                <LogOut className="w-5 h-5" aria-hidden />
                <RailLabel>Sign out</RailLabel>
            </button>
        </aside>
    );
}
