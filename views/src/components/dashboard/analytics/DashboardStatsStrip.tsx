"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, PiggyBank, CalendarDays, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { StatTile } from "./StatTile";
import { iconFor, type IconName } from "@/lib/categoryIcons";

interface TopCategory {
    categoryId: string;
    category: string;
    categoryColor: string;
    categoryIcon: IconName;
    total: number;
    count: number;
    percentage: number;
}

interface Stats {
    totalIncome:           number;
    totalExpense:          number;
    totalPrevious:         number;
    monthlyRecurringIncome: number;
    savingsRate:           number | null;
    dailyAverage:          number;
    monthOverMonthDelta:   number;
    monthOverMonthPct:     number | null;
    topCategories:         TopCategory[];
}

export function DashboardStatsStrip() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    const fmtMoney = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });
    const fmtPct   = (n: number) => `${(n * 100).toFixed(n > -0.1 && n < 0.1 ? 1 : 0)}%`;

    const [data, setData]       = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get("/analytics/dashboard-stats");
                setData(res.data?.data ?? null);
            } catch (err) {
                console.error("Failed to fetch dashboard stats", err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse bg-zinc-900/50 rounded-3xl" />)}
        </div>
    );

    if (!data) return null;

    // Savings rate display
    const savingsRateLabel = data.savingsRate === null ? "—" : fmtPct(data.savingsRate);
    const savingsAccent: "emerald" | "amber" | "red" =
        data.savingsRate === null ? "amber"
        : data.savingsRate >= 0.2 ? "emerald"
        : data.savingsRate >= 0 ? "amber"
        : "red";

    // Month-over-month display
    const momPct = data.monthOverMonthPct;
    const momLabel = momPct === null ? "—" : fmtPct(momPct);
    const MoMIcon = momPct === null ? Minus : momPct > 0 ? ArrowUpRight : ArrowDownRight;

    return (
        <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    icon={TrendingUp}
                    label="Income (month)"
                    value={fmtMoney.format(data.totalIncome)}
                    sub={data.monthlyRecurringIncome > 0
                        ? `${fmtMoney.format(data.monthlyRecurringIncome)} recurring`
                        : "no recurring streams"}
                    accent="emerald"
                />
                <StatTile
                    icon={TrendingDown}
                    label="Spend (month)"
                    value={fmtMoney.format(data.totalExpense)}
                    sub={`${fmtMoney.format(data.dailyAverage)}/day avg`}
                    accent="purple"
                />
                <StatTile
                    icon={PiggyBank}
                    label="Savings rate"
                    value={savingsRateLabel}
                    sub={data.savingsRate !== null && data.savingsRate >= 0
                        ? `${fmtMoney.format(data.totalIncome - data.totalExpense)} saved so far`
                        : data.savingsRate !== null
                            ? `${fmtMoney.format(data.totalExpense - data.totalIncome)} over income`
                            : "log an income to see savings"}
                    accent={savingsAccent}
                />
                <StatTile
                    icon={MoMIcon}
                    label="vs last month"
                    value={momLabel}
                    sub={momPct === null
                        ? "no prior month to compare"
                        : `${fmtMoney.format(Math.abs(data.monthOverMonthDelta))} ${data.monthOverMonthDelta > 0 ? "more" : "less"}`}
                    accent={momPct === null ? "zinc" : momPct > 0 ? "red" : "emerald"}
                />
            </div>

            {data.topCategories.length > 0 && (
                <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                    <h3 className="text-lg font-semibold text-white mb-4">Top spending categories</h3>
                    <div className="space-y-2">
                        {data.topCategories.map((c) => {
                            const Icon = iconFor(c.categoryIcon);
                            return (
                                <div key={c.categoryId} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
                                    <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${c.categoryColor}22` }}>
                                        <Icon className="w-4 h-4" style={{ color: c.categoryColor }} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-sm font-medium text-white truncate">{c.category}</div>
                                            <div className="text-sm font-medium text-white tabular-nums shrink-0">
                                                {fmtMoney.format(c.total)}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1.5">
                                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full rounded-full transition-all"
                                                    style={{ width: `${c.percentage}%`, backgroundColor: c.categoryColor }}
                                                />
                                            </div>
                                            <span className="text-xs text-zinc-500 tabular-nums w-12 text-right">{c.percentage}%</span>
                                            <span className="text-xs text-zinc-600 tabular-nums w-12 text-right">{c.count}×</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
}
