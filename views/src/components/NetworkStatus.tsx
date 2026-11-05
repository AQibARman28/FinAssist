"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { getActivity, subscribeActivity } from "@/lib/netActivity";

// After this long, a pending request is almost always the free backend waking
// up (it sleeps when idle and takes up to a minute to boot). Say so, rather
// than leave a silent spinner that looks broken. Rendered from the root
// layout so it covers sign-in too — usually the first request of the day.
const SLOW_AFTER_MS = 5000;

export function NetworkStatus() {
    const { since } = useSyncExternalStore(subscribeActivity, getActivity, getActivity);
    const [slow, setSlow] = useState(false);

    useEffect(() => {
        if (since === null) return;
        const id = setTimeout(() => setSlow(true), Math.max(0, since + SLOW_AFTER_MS - Date.now()));
        return () => { clearTimeout(id); setSlow(false); };
    }, [since]);

    if (!slow || since === null) return null;
    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed left-4 right-20 md:left-auto md:right-24 md:max-w-sm z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-zinc-900/95 border border-white/10 shadow-lg shadow-black/40 backdrop-blur-xl text-sm"
            style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
        >
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-purple-400" />
            <span className="text-zinc-300">
                Waking up the server…
                <span className="block text-xs text-zinc-500">The first load after a quiet spell can take up to a minute.</span>
            </span>
        </div>
    );
}
