"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Zap } from "lucide-react";
import { reloadOnChunkError } from "@/lib/reloadOnChunkError";

// The sheet pulls in the natural-language date parser (chrono-node). This
// bubble sits in the shared dashboard layout, so loading the sheet eagerly
// would put that parser on every page. It is fetched once the browser is
// idle (or on first touch), so the first tap still opens instantly.
const loadSheet = () => import("./QuickExpenseSheet");
// Warm-up only; a failure here just means it loads (or reloads) on first tap.
const preloadSheet = () => { loadSheet().catch(() => {}); };
const QuickExpenseSheet = dynamic(reloadOnChunkError(loadSheet), { ssr: false });

// Floating "chat-head" quick-add: tap the bubble → the quick-add sheet.
export function QuickExpenseFab() {
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

    return (
        <>
            <button
                onClick={() => { setMounted(true); setOpen(true); }}
                onPointerDown={preloadSheet}
                aria-label="Quick add expense"
                className="fixed right-4 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 text-white shadow-lg shadow-purple-900/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
                style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            >
                <Zap className="w-6 h-6" />
            </button>
            {mounted && <QuickExpenseSheet open={open} onClose={() => setOpen(false)} />}
        </>
    );
}
