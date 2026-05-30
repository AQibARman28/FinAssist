"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, PiggyBank, ArrowUpRight, ArrowDownRight, Minus, ChevronDown, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { StatTile } from "./StatTile";
import { iconFor, type IconName } from "@/lib/categoryIcons";

interface CategoryTx {
    _id: string;
    amount: number;
    description: string;
    date: string;
}

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

    // Click-to-expand: which category is open, plus a per-category cache of its
    // transactions for the current month (same window dashboard-stats uses).
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [txCache, setTxCache] = useState<Record<string, { loading: boolean; items: CategoryTx[] }>>({});

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

    const toggleCategory = async (categoryId: string) => {
        if (expandedId === categoryId) { setExpandedId(null); return; }
        setExpandedId(categoryId);
        if (txCache[categoryId]) return; // already loaded

        setTxCache((c) => ({ ...c, [categoryId]: { loading: true, items: [] } }));
        try {
            const now = new Date();
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth();
            const startDate = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
            const endDate   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
            const res = await api.get("/expenses", { params: { category: categoryId, startDate, endDate, limit: 100 } });
            const items: CategoryTx[] = (res.data?.data ?? [])
                .slice()
                .sort((a: CategoryTx, b: CategoryTx) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setTxCache((c) => ({ ...c, [categoryId]: { loading: false, items } }));
        } catch (err) {
            console.error("Failed to fetch category transactions", err);
            setTxCache((c) => ({ ...c, [categoryId]: { loading: false, items: [] } }));
        }
    };

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
                    <h3 className="text-lg font-semibold text-white mb-1">Top spending categories</h3>
                    <p className="text-xs text-zinc-500 mb-4">Tap a category to see its transactions this month.</p>
                    <div className="space-y-2">
                        {data.topCategories.map((c) => {
                            const Icon = iconFor(c.categoryIcon);
                            const isOpen = expandedId === c.categoryId;
                            const tx = txCache[c.categoryId];
                            return (
                                <div key={c.categoryId} className="rounded-xl overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => toggleCategory(c.categoryId)}
                                        aria-expanded={isOpen}
                                        className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left"
                                    >
                                        <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${c.categoryColor}22` }}>
                                            <Icon className="w-4 h-4" style={{ color: c.categoryColor }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-sm font-medium text-white truncate">{c.category}</span>
                                                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                                </div>
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
                                    </button>

                                    {isOpen && (
                                        <div className="ml-12 mr-2 mb-1 pl-3 border-l border-white/10">
                                            {!tx || tx.loading ? (
                                                <div className="py-4 flex items-center gap-2 text-xs text-zinc-500">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading transactions…
                                                </div>
                                            ) : tx.items.length === 0 ? (
                                                <div className="py-4 text-xs text-zinc-600">No transactions this month.</div>
                                            ) : (
                                                <div className="py-2 space-y-1">
                                                    {tx.items.map((t) => (
                                                        <div key={t._id} className="flex items-center justify-between gap-3 py-1.5">
                                                            <span className="text-xs text-zinc-500 tabular-nums w-16 shrink-0">{format(new Date(t.date), "MMM d")}</span>
                                                            <span className="text-sm text-zinc-300 truncate flex-1" title={t.description}>{t.description}</span>
                                                            <span className="text-sm text-white tabular-nums shrink-0">{fmtMoney.format(t.amount)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
}
