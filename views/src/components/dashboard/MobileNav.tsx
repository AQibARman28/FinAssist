"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { CreditCard, LayoutDashboard, LogOut, Menu, Plus, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { openQuickAdd } from "@/lib/quickAdd";
import { menuItems } from "./navItems";

const TABS = [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/dashboard/expenses", label: "Expenses", icon: CreditCard },
] as const;
const TABS_AFTER = [{ href: "/dashboard/budgets", label: "Budgets", icon: Wallet }] as const;

const tab = "grid justify-items-center content-center gap-1 min-h-12 rounded-xl text-[10.5px] font-medium focus-ring";

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Menu; active: boolean }) {
    return (
        <Link href={href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "text-white" : "text-zinc-400")}>
            <Icon className="w-[21px] h-[21px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
            {label}
        </Link>
    );
}

// Phone navigation (hidden on md+, where the icon rail takes over): a bottom
// tab bar within thumb reach, with quick add raised in the middle. "More"
// opens every section as a drawer. It clears the home indicator.
export function MobileNav() {
    const pathname = usePathname();
    const router = useRouter();
    const logout = useAuthStore((s) => s.logout);
    const [open, setOpen] = useState(false);
    const drawerRef = useRef<HTMLElement>(null);
    // A real dialog for keyboard and screen-reader users: focus moves in, Tab
    // stays inside, Esc closes, focus returns to the More button.
    useDialogFocus(open, drawerRef, () => setOpen(false));

    const handleLogout = async () => {
        setOpen(false);
        await logout();
        router.push("/login");
    };

    const isActive = (href: string) =>
        pathname === href || (href !== "/dashboard" && pathname?.startsWith(href + "/"));
    const inMore = !([...TABS, ...TABS_AFTER] as readonly { href: string }[]).some((t) => isActive(t.href));

    return (
        <>
            <nav
                aria-label="Main"
                className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-end gap-1 px-2 pt-2 bg-zinc-950/90 backdrop-blur-xl border-t border-white/[0.08]"
                style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))", paddingLeft: "max(0.5rem, env(safe-area-inset-left))", paddingRight: "max(0.5rem, env(safe-area-inset-right))" }}
            >
                {TABS.map((t) => <TabLink key={t.href} {...t} active={isActive(t.href)} />)}
                <button type="button" onClick={openQuickAdd} className={cn(tab, "text-zinc-300")}>
                    <span aria-hidden className="metal-chip -mt-6 grid place-items-center w-[52px] h-[52px] rounded-full">
                        <Plus className="w-6 h-6" />
                    </span>
                    Add
                </button>
                {TABS_AFTER.map((t) => <TabLink key={t.href} {...t} active={isActive(t.href)} />)}
                <button type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-current={inMore ? "page" : undefined} className={cn(tab, inMore ? "text-white" : "text-zinc-400")}>
                    <Menu className="w-[21px] h-[21px]" aria-hidden />
                    More
                </button>
            </nav>

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
                            ref={drawerRef}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Menu"
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "tween", duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                            className="md:hidden fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] flex flex-col rounded-t-[28px] bg-graphite border-t border-white/10"
                            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                        >
                            <div className="flex items-center justify-between px-6 pt-5 pb-2">
                                <span className="label-caps text-zinc-400">Menu</span>
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    aria-label="Close menu"
                                    className="-mr-2 grid place-items-center w-11 h-11 rounded-xl text-zinc-400 hover:text-white focus-ring"
                                >
                                    <X className="w-5 h-5" aria-hidden />
                                </button>
                            </div>

                            <nav aria-label="All sections" className="grid grid-cols-2 gap-2 px-4 pb-3 overflow-y-auto">
                                {menuItems.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setOpen(false)}
                                        aria-current={isActive(item.href) ? "page" : undefined}
                                        className={cn(
                                            "flex items-center gap-3 min-h-14 px-4 rounded-2xl transition-colors focus-ring",
                                            isActive(item.href) ? "bg-plat text-plat-ink" : "bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]",
                                        )}
                                    >
                                        <item.icon className="w-5 h-5" aria-hidden />
                                        <span className="text-sm font-medium">{item.label}</span>
                                    </Link>
                                ))}
                            </nav>

                            <div className="px-4 pt-1 pb-4 border-t border-white/[0.06]">
                                <button type="button" onClick={handleLogout} className="mt-3 flex items-center gap-3 min-h-12 px-4 w-full rounded-2xl text-zinc-400 hover:text-red-300 hover:bg-red-500/10 transition-colors focus-ring">
                                    <LogOut className="w-5 h-5" aria-hidden />
                                    <span className="text-sm font-medium">Sign out</span>
                                </button>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
