"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { reloadOnChunkError } from "@/lib/reloadOnChunkError";
import { onOpenQuickAdd } from "@/lib/quickAdd";

// The sheet pulls in the natural-language date parser (chrono-node). It lives
// in the shared dashboard layout, so loading it eagerly would put that parser
// on every page. It is fetched once the browser is idle, so the first tap on
// any quick-add button (icon rail, phone tab bar, dashboard header) still
// opens it instantly.
const loadSheet = () => import("./QuickExpenseSheet");
// Warm-up only; a failure here just means it loads (or reloads) on first tap.
const preloadSheet = () => { loadSheet().catch(() => {}); };
const QuickExpenseSheet = dynamic(reloadOnChunkError(loadSheet), { ssr: false });

// Hosts the quick-add sheet for every dashboard page. Any screen opens it with
// openQuickAdd() (lib/quickAdd.ts).
export function QuickAddHost() {
    const [open, setOpen] = useState(false);
    // Mount the sheet on first open and keep it mounted, so its exit
    // animation runs and a half-typed entry survives closing.
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (typeof window.requestIdleCallback === "function") {
            const id = window.requestIdleCallback(preloadSheet, { timeout: 5000 });
            return () => window.cancelIdleCallback(id);
        }
        const id = setTimeout(preloadSheet, 2000);
        return () => clearTimeout(id);
    }, []);

    useEffect(() => onOpenQuickAdd(() => { setMounted(true); setOpen(true); }), []);

    return mounted ? <QuickExpenseSheet open={open} onClose={() => setOpen(false)} /> : null;
}
