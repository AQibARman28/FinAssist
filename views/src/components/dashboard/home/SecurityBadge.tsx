"use client";

import { useRef } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

// FinAssist's protection, visible and explained where the student looks first.
// The claims are exactly what the server does: per-account encryption of the
// written parts of a record, and an ECDSA signature checked on every read.
// When a record on screen fails that check, the badge says so instead.
export function SecurityBadge({ flagged }: { flagged: number }) {
    const ref = useRef<HTMLDetailsElement>(null);
    const close = () => {
        if (!ref.current?.open) return;
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
    };
    return (
        <details ref={ref} className="relative" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
            <summary className="inline-flex items-center gap-1.5 min-h-11 -my-2 -ml-2 px-2 rounded-lg text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-white/5 transition-colors focus-ring">
                {flagged > 0
                    ? <ShieldAlert className="w-4 h-4 text-amber-300" aria-hidden />
                    : <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden />}
                <span className={flagged > 0 ? "text-amber-200" : "text-zinc-300"}>
                    {flagged > 0 ? `${flagged} record${flagged === 1 ? "" : "s"} failed a check` : "Encrypted · signed"}
                </span>
            </summary>
            <div className="absolute left-0 top-full z-30 mt-3 w-[min(21rem,calc(100vw-2rem))] p-4 rounded-2xl bg-graphite-raised border border-white/10 shadow-2xl shadow-black/50 text-sm text-zinc-300 space-y-2.5">
                <p>
                    <span className="font-medium text-white">Encrypted with your own key.</span>{" "}
                    Your descriptions, notes and goal names are locked with a key that belongs to your account alone.
                </p>
                <p>
                    <span className="font-medium text-white">Signed and checked.</span>{" "}
                    Every record is signed when it&apos;s saved and checked each time it&apos;s read, so a changed record is flagged instead of shown as real.
                </p>
                {flagged > 0 && (
                    <p className="text-amber-200">
                        {flagged === 1 ? "One of your recent records" : `${flagged} of your recent records`} didn&apos;t pass that check. Open Expenses to review {flagged === 1 ? "it" : "them"}.
                    </p>
                )}
            </div>
        </details>
    );
}
