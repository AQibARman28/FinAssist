"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { getActivity, subscribeActivity } from "@/lib/netActivity";
import { cn } from "@/lib/utils";

// After this long, a pending request is almost always the free backend waking
// up (it sleeps when idle and takes up to a minute to boot). Say so, rather
// than leave a silent spinner that looks broken. Rendered from the root
// layout so it covers sign-in too — usually the first request of the day.
const SLOW_AFTER_MS = 5000;

export function NetworkStatus() {
    const { since } = useSyncExternalStore(subscribeActivity, getActivity, getActivity);
    const [slow, setSlow] = useState(false);
    // Inside the app, phones have the tab bar (and its raised Add chip) along
    // the bottom; the toast sits above it. Sign-in screens have no bar.
    const overTabBar = usePathname()?.startsWith("/dashboard") ?? false;

    useEffect(() => {
        if (since === null) return;
        const id = setTimeout(() => setSlow(true), Math.max(0, since + SLOW_AFTER_MS - Date.now()));
        return () => { clearTimeout(id); setSlow(false); };
    }, [since]);

    const show = slow && since !== null;
    return (
        // The live region is always in the page, so the message is announced
        // when it appears; the toast inside floats over the content.
        <div role="status" aria-live="polite">
            {show && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                        "fixed z-50 flex items-start gap-3 p-4 rounded-2xl bg-graphite-raised text-[13.5px]",
                        "shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_25px_50px_-12px_rgb(0_0_0/0.5)]",
                        "left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] md:left-auto md:right-6 md:w-[22rem]",
                        overTabBar
                            ? "bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"
                            : "bottom-[calc(1.25rem+env(safe-area-inset-bottom))] md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]",
                    )}
                >
                    <Loader2 className="mt-0.5 w-4 h-4 shrink-0 animate-spin text-plat" aria-hidden />
                    <p className="min-w-0">
                        <span className="block font-semibold text-white">Waking up the server…</span>
                        <span className="block mt-0.5 text-[12.5px] text-zinc-400">The first load after a quiet spell can take up to a minute.</span>
                    </p>
                </motion.div>
            )}
        </div>
    );
}
