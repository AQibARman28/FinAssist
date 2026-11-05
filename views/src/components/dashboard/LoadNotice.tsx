"use client";

import { AlertCircle, CloudOff, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LoadState } from "@/lib/loadState";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const retryButton =
    "shrink-0 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-sm font-medium transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2";

// One notice for the whole screen. A money screen must never pass off a
// failed read as a real zero, nor show old figures as if they were current.
export function LoadNotice({ state, onRetry }: { state: LoadState; onRetry: () => void }) {
    if (state.kind === "ok") return null;

    const failed = state.kind === "failed";
    return (
        <div
            role="status"
            className={cn(
                "flex items-center gap-3 pl-4 pr-1.5 py-1.5 rounded-xl border text-sm",
                failed ? "bg-red-500/10 border-red-500/20 text-red-200" : "bg-amber-500/10 border-amber-500/20 text-amber-200",
            )}
        >
            {failed
                ? <AlertCircle className="w-4 h-4 shrink-0 text-red-400" aria-hidden />
                : <CloudOff className="w-4 h-4 shrink-0 text-amber-300" aria-hidden />}
            <p className="flex-1 min-w-0">
                {failed
                    ? "Some of your figures couldn't load. Nothing is lost; they're just not here yet."
                    : state.asOf !== undefined
                        ? `Couldn't refresh. Showing your figures from ${timeFormat.format(state.asOf)}.`
                        : "Couldn't refresh. These figures may be out of date."}
            </p>
            <button
                type="button"
                onClick={onRetry}
                className={cn(retryButton, failed
                    ? "hover:bg-red-500/10 focus-visible:outline-red-400"
                    : "hover:bg-amber-500/10 focus-visible:outline-amber-300")}
            >
                <RotateCw className="w-4 h-4" aria-hidden /> Try again
            </button>
        </div>
    );
}

// In-card version, for cards far from the top of the screen.
export function LoadError({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
    return (
        <div className={cn("flex flex-col items-center justify-center gap-3 text-center py-10", className)}>
            <p className="text-sm text-zinc-300">Couldn&apos;t load {what}.</p>
            <button
                type="button"
                onClick={onRetry}
                className={cn(retryButton, "bg-white/5 border border-white/10 text-white hover:bg-white/10 focus-visible:outline-plat")}
            >
                <RotateCw className="w-4 h-4" aria-hidden /> Try again
            </button>
        </div>
    );
}
