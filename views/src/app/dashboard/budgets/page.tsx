"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Wallet, TrendingUp, AlertTriangle, ChevronLeft, ChevronRight, Copy, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BudgetForm } from "@/components/dashboard/budgets/BudgetForm";
import { BudgetCard } from "@/components/dashboard/budgets/BudgetCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { apiErrorMessage } from "@/lib/apiError";
import {
    summarizeBudgets, previousMonth, nextMonth, type BudgetRow,
} from "@/components/dashboard/budgets/budgetModel";
import { useCurrency } from "@/lib/useCurrency";

interface Loaded {
    key: string;          // "YYYY-M" the rows belong to
    budgets: BudgetRow[];
    failed: boolean;
}

const HEALTH_TONE: Record<string, string> = {
    "Critical":   "text-red-400",
    "Watch":      "text-orange-400",
    "Healthy":    "text-emerald-400",
    "No budgets": "text-zinc-400",
};

export default function BudgetsPage() {
    const { format: fmt } = useCurrency();
    const [cursor, setCursor] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() + 1 };
    });
    const [refreshKey, setRefreshKey] = useState(0);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [copying, setCopying] = useState(false);
    const [copyMsg, setCopyMsg] = useState<string | null>(null);

    const key = `${cursor.year}-${cursor.month}`;
    const loading = loaded?.key !== key;
    const budgets = useMemo(() => (loaded && loaded.key === key ? loaded.budgets : []), [loaded, key]);
    const summary = useMemo(() => summarizeBudgets(budgets), [budgets]);

    const monthLabel = format(new Date(cursor.year, cursor.month - 1, 1), "MMMM yyyy");
    const prev = previousMonth(cursor.year, cursor.month);
    const prevLabel = format(new Date(prev.year, prev.month - 1, 1), "MMMM");

    useEffect(() => {
        let cancelled = false;
        const k = `${cursor.year}-${cursor.month}`;
        api.get(`/budgets/tracking/${cursor.year}/${cursor.month}`)
            .then((res) => { if (!cancelled) setLoaded({ key: k, budgets: res.data?.data?.budgets ?? [], failed: false }); })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to fetch budgets", err);
                setLoaded({ key: k, budgets: [], failed: true });
            });
        return () => { cancelled = true; };
    }, [cursor.year, cursor.month, refreshKey]);

    const refresh = () => setRefreshKey((k) => k + 1);
    const shiftMonth = (dir: -1 | 1) => {
        setCopyMsg(null);
        setCursor((c) => (dir === -1 ? previousMonth(c.year, c.month) : nextMonth(c.year, c.month)));
    };

    // Copy last month's active budgets into the viewed month (existing
    // categories are skipped server-side, so this never overwrites).
    const copyFromPrevious = async () => {
        setCopying(true);
        setCopyMsg(null);
        try {
            const res = await api.post("/budgets/reset", {
                fromMonth: prev.month, fromYear: prev.year,
                toMonth: cursor.month, toYear: cursor.year,
            });
            const n = (res.data?.data ?? []).length;
            setCopyMsg(n > 0 ? `Copied ${n} budget${n === 1 ? "" : "s"} from ${prevLabel}.` : `No ${prevLabel} budgets to copy.`);
            refresh();
        } catch (err) {
            setCopyMsg(apiErrorMessage(err, "Couldn't copy budgets."));
        } finally {
            setCopying(false);
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-white">Budgets</h1>
                    <p className="text-zinc-500 text-sm">Set limits per category and track this month&apos;s spending against them</p>
                </div>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-900/50 border border-white/5 w-fit">
                    <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="px-2 text-sm font-medium text-white tabular-nums min-w-[8.5rem] text-center">{monthLabel}</span>
                    <button onClick={() => shiftMonth(1)} aria-label="Next month" className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <StatCard title="Total Budget" value={fmt(summary.totalLimit)} icon={Wallet} className="bg-zinc-900/50" />
                <StatCard
                    title="Total Spent"
                    value={fmt(summary.totalSpent)}
                    trend={`${summary.usedPct}% Used`}
                    trendUp={false}
                    icon={TrendingUp}
                    className="bg-zinc-900/50"
                />
                <div className="p-4 md:p-5 rounded-2xl bg-zinc-900/50 border border-white/5 flex flex-col justify-center">
                    <div className="flex items-center gap-3 text-zinc-400 mb-2">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-medium">Budget Health</span>
                    </div>
                    <div className={cn("text-2xl font-bold", HEALTH_TONE[summary.health])}>{summary.health}</div>
                    {(summary.overCount > 0 || summary.nearCount > 0) && (
                        <div className="text-xs text-zinc-500 mt-1">
                            {summary.overCount > 0 && `${summary.overCount} over limit`}
                            {summary.overCount > 0 && summary.nearCount > 0 && " · "}
                            {summary.nearCount > 0 && `${summary.nearCount} near limit`}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Budget Form */}
            <BudgetForm month={cursor.month} year={cursor.year} monthLabel={monthLabel} onSuccess={refresh} />

            {/* Budget Grid */}
            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {budgets.map((budget) => (
                        <BudgetCard key={budget._id} budget={budget} onChanged={refresh} />
                    ))}

                    {budgets.length === 0 && (
                        <div className="col-span-full py-16 text-center border border-dashed border-white/10 rounded-3xl bg-white/5 px-4">
                            {loaded?.failed ? (
                                <p className="text-zinc-500">Couldn&apos;t load budgets. Try again in a moment.</p>
                            ) : (
                                <>
                                    <p className="text-zinc-500">No budgets for {monthLabel}.</p>
                                    <p className="text-zinc-600 text-sm mt-1">Set a limit above, or reuse last month&apos;s.</p>
                                    <button
                                        onClick={copyFromPrevious}
                                        disabled={copying}
                                        className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
                                    >
                                        {copying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                                        Copy from {prevLabel}
                                    </button>
                                </>
                            )}
                            {copyMsg && <p className="text-xs text-zinc-400 mt-3">{copyMsg}</p>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
