"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { menuItems } from "./navItems";

// Mobile navigation (hidden on md+, where the Sidebar takes over). A sticky top
// bar with a hamburger that opens the full menu as a slide-out drawer. Honors
// the iOS safe-area insets so it sits below the status bar in standalone/PWA.
export function MobileNav() {
    const pathname = usePathname();
    const router = useRouter();
    const logout = useAuthStore((s) => s.logout);
    const [open, setOpen] = useState(false);

    const handleLogout = async () => {
        setOpen(false);
        await logout();
        router.push("/login");
    };

    const isActive = (href: string) =>
        pathname === href || (href !== "/dashboard" && pathname?.startsWith(href + "/"));

    return (
        <>
            {/* Top bar — mobile only */}
            <header
                className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 bg-black/70 backdrop-blur-xl border-b border-white/5"
                style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
            >
                <Link href="/dashboard" className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7]" />
                    <span className="text-lg font-light tracking-wide text-white">FinAssist</span>
                </Link>
                <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 -mr-2 text-zinc-300 hover:text-white">
                    <Menu className="w-6 h-6" />
                </button>
            </header>

            {/* Slide-out drawer */}
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setOpen(false)}
                            className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.aside
                            initial={{ x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={{ x: "-100%" }}
                            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
                            className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-72 max-w-[82%] bg-zinc-950 border-r border-white/10 flex flex-col"
                            style={{ paddingTop: "env(safe-area-inset-top)" }}
                        >
                            <div className="flex items-center justify-between p-6">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7]" />
                                    <span className="text-xl font-light tracking-wide text-white">FinAssist</span>
                                </div>
                                <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 text-zinc-400 hover:text-white">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto">
                                {menuItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setOpen(false)}
                                        className={cn(
                                            "flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
                                            isActive(item.href)
                                                ? "bg-purple-500/10 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.15)]"
                                                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5",
                                        )}
                                    >
                                        <item.icon className={cn("w-5 h-5", isActive(item.href) ? "stroke-[2.5px]" : "stroke-2")} />
                                        <span className="font-medium">{item.label}</span>
                                    </Link>
                                ))}
                            </nav>

                            <div className="p-4 border-t border-white/5" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
                                <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                    <LogOut className="w-5 h-5" />
                                    <span className="font-medium">Sign Out</span>
                                </button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
