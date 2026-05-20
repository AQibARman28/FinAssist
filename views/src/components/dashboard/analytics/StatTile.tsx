"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatTileProps {
    icon:   LucideIcon;
    label:  string;
    value:  string | number;
    sub?:   string;
    accent?: "emerald" | "purple" | "amber" | "red" | "zinc";
    trend?: { value: string; up: boolean | null };
}

const ACCENT_BG: Record<NonNullable<StatTileProps["accent"]>, string> = {
    emerald: "from-emerald-900/15 to-black border-emerald-500/15",
    purple:  "from-purple-900/15  to-black border-purple-500/15",
    amber:   "from-amber-900/15   to-black border-amber-500/15",
    red:     "from-red-900/15     to-black border-red-500/15",
    zinc:    "bg-zinc-900/50 border-white/5",
};
const ACCENT_TEXT: Record<NonNullable<StatTileProps["accent"]>, string> = {
    emerald: "text-emerald-400",
    purple:  "text-purple-400",
    amber:   "text-amber-400",
    red:     "text-red-400",
    zinc:    "text-zinc-400",
};

export function StatTile({ icon: Icon, label, value, sub, accent = "zinc", trend }: StatTileProps) {
    const isGradient = accent !== "zinc";
    return (
        <div className={cn(
            "p-5 rounded-3xl border h-full flex flex-col gap-2",
            isGradient ? `bg-gradient-to-br ${ACCENT_BG[accent]}` : ACCENT_BG[accent],
        )}>
            <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
                <Icon className={cn("w-4 h-4", ACCENT_TEXT[accent])} />
            </div>
            <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
            <div className="flex items-center gap-2">
                {trend && (
                    <span className={cn(
                        "text-xs tabular-nums",
                        trend.up === null ? "text-zinc-500" : trend.up ? "text-emerald-400" : "text-red-400",
                    )}>
                        {trend.value}
                    </span>
                )}
                {sub && <span className="text-xs text-zinc-500">{sub}</span>}
            </div>
        </div>
    );
}
