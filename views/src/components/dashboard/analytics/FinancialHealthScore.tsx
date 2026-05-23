"use client";

import { useEffect, useState } from "react";
import { motion, animate, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import { Activity, ChevronDown, AlertCircle, Wallet, TrendingUp, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Factor {
    label: string;
    score: number | null;
    weight: number;
    detail: string;
}
interface HealthData {
    status: "ok" | "building";
    score: number | null;
    band: string | null;
    factors: Factor[];
    contributor: { label: string; score: number } | null;
    detractor: { label: string; score: number } | null;
    message: string;
}

const BAND_COLOR: Record<string, string> = {
    "Needs attention": "#ef4444",
    "Fair":            "#f59e0b",
    "Good":            "#a855f7",
    "Excellent":       "#10b981",
};

function scoreColor(s: number): string {
    if (s < 40) return "#ef4444";
    if (s < 60) return "#f59e0b";
    if (s < 80) return "#a855f7";
    return "#10b981";
}

// Animated count-up to the score.
function CountUp({ value }: { value: number }) {
    const mv = useMotionValue(0);
    const rounded = useTransform(mv, (v) => Math.round(v));
    useEffect(() => {
        const controls = animate(mv, value, { duration: 1.2, ease: "easeOut" });
        return () => controls.stop();
    }, [value, mv]);
    return <motion.span>{rounded}</motion.span>;
}

export function FinancialHealthScore() {
    const [data, setData]       = useState<HealthData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.get("/ai/financial-health-score")
            .then((res) => { if (!cancelled) setData(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error("Failed to fetch health score", err); setError(true); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    if (loading) return <div className="h-48 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    if (error || !data) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                <Header />
                <div className="flex items-center gap-2 text-sm text-zinc-500 py-6 justify-center">
                    <AlertCircle className="w-4 h-4" /> Couldn&apos;t load your score.
                </div>
            </div>
        );
    }

    // ── Building state: guidance + CTAs instead of a misleading number ────────
    if (data.status === "building" || data.score === null) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                <Header />
                <div className="flex flex-col items-center text-center py-4">
                    <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center mb-3">
                        <Sparkles className="w-5 h-5 text-purple-400" />
                    </div>
                    <p className="text-sm text-zinc-300 mb-4 max-w-[16rem]">{data.message}</p>
                    <div className="flex gap-2">
                        <Link href="/dashboard/budgets" className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-600/30 transition-colors">
                            <Wallet className="w-3.5 h-3.5" /> Set a budget
                        </Link>
                        <Link href="/dashboard/income" className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-medium hover:bg-white/10 transition-colors">
                            <TrendingUp className="w-3.5 h-3.5" /> Log income
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const color = data.band ? BAND_COLOR[data.band] ?? "#a855f7" : "#a855f7";
    const R = 56;
    const C = 2 * Math.PI * R; // ≈ 351.9

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
            <Header />

            <div className="flex flex-col items-center justify-center pt-2 pb-1">
                <div className="relative">
                    <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
                        <circle cx="64" cy="64" r={R} strokeWidth="12" fill="transparent" className="text-zinc-800" stroke="currentColor" />
                        <motion.circle
                            cx="64" cy="64" r={R} strokeWidth="12" fill="transparent"
                            stroke={color} strokeLinecap="round"
                            initial={{ strokeDasharray: `${C} ${C}`, strokeDashoffset: C }}
                            animate={{ strokeDashoffset: C - (C * data.score) / 100 }}
                            transition={{ duration: 1.2, ease: "easeOut" }}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold" style={{ color }}>
                            <CountUp value={data.score} />
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">/ 100</span>
                    </div>
                </div>

                {data.band && (
                    <span className="mt-3 px-3 py-1 rounded-full text-xs font-medium" style={{ color, backgroundColor: `${color}1a` }}>
                        {data.band}
                    </span>
                )}
                <p className="mt-2 text-center text-sm text-zinc-400 max-w-[18rem]">{data.message}</p>
            </div>

            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                aria-expanded={expanded}
                className="w-full mt-2 flex items-center justify-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 py-2 transition-colors"
            >
                {expanded ? "Hide breakdown" : "View breakdown"}
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
            </button>

            {expanded && (
                <div className="space-y-2.5 pt-1">
                    {data.factors.map((f) => {
                        const excluded = f.score === null;
                        return (
                            <div key={f.label} className={cn(excluded && "opacity-50")}>
                                <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-zinc-300">{f.label}</span>
                                    <span className={cn("tabular-nums", excluded ? "text-zinc-500 italic" : "text-zinc-200")}>
                                        {excluded ? "no data yet" : f.score}
                                    </span>
                                </div>
                                {!excluded && (
                                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                                        <div className="h-full rounded-full" style={{ width: `${f.score}%`, backgroundColor: scoreColor(f.score as number) }} />
                                    </div>
                                )}
                                <div className="text-[11px] text-zinc-500">{f.detail}</div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Header() {
    return (
        <div className="flex justify-between items-start mb-4">
            <div>
                <h3 className="text-lg font-semibold text-white">Financial Health</h3>
                <p className="text-xs text-zinc-500">Multi-factor wellness score · last 90 days</p>
            </div>
            <Activity className="w-5 h-5 text-purple-400" />
        </div>
    );
}
