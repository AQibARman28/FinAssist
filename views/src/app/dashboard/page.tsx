"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { StatCard } from "@/components/dashboard/StatCard";
import { SpendingChart, type ChartType } from "@/components/dashboard/SpendingChart";
import { SpendingTimelineChart } from "@/components/dashboard/SpendingTimelineChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { Wallet, CreditCard, TrendingUp, Bell, Loader2, LineChart, BarChart3, PieChart } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/store";

interface DashboardStats {
    totalSaved:         number;
    monthlyIncome:      number;
    monthlySpend:       number;
    recentTransactions: any[];
    recentActivityCount: number;
    chartData:          { name: string; amount: number; color?: string }[];
}

const CHART_TYPES: { key: ChartType; label: string; Icon: typeof LineChart }[] = [
    { key: "line", label: "Line", Icon: LineChart },
    { key: "bar",  label: "Bar",  Icon: BarChart3 },
    { key: "pie",  label: "Pie",  Icon: PieChart },
];

function currencyFormatter(code = "USD"): Intl.NumberFormat {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

export default function DashboardPage() {
    const { user } = useAuthStore();
    const fmt = currencyFormatter(user?.currency || "USD");

    const [chartType, setChartType] = useState<ChartType>("line");
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStats>({
        totalSaved:         0,
        monthlyIncome:      0,
        monthlySpend:       0,
        recentTransactions: [],
        recentActivityCount: 0,
        chartData:          [],
    });

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const now = new Date();
                const year  = now.getUTCFullYear();
                const month = now.getUTCMonth();
                const monthStart = new Date(Date.UTC(year, month,     1, 0, 0, 0, 0));
                const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

                // Run in parallel; one failure doesn't break the others.
                const [expenseSummaryRes, recentTxRes, last7Res, goalsRes, incomeListRes] = await Promise.allSettled([
                    api.get(`/expenses/summary/${year}/${month + 1}`),
                    api.get("/expenses", { params: { limit: 5 } }),
                    api.get("/expenses", {
                        params: { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), limit: 1 },
                    }),
                    api.get("/goals/dashboard"),
                    api.get("/incomes", {
                        params: { startDate: monthStart.toISOString(), endDate: monthEnd.toISOString(), limit: 100 },
                    }),
                ]);

                const monthlySpend = expenseSummaryRes.status === "fulfilled"
                    ? (expenseSummaryRes.value.data?.data?.totalSpent ?? 0)
                    : 0;
                const chartData = expenseSummaryRes.status === "fulfilled"
                    ? (expenseSummaryRes.value.data?.data?.summary ?? []).map((it: any) => ({
                        name: it.category, amount: it.amount, color: it.categoryColor,
                    }))
                    : [];

                const recentTransactions = recentTxRes.status === "fulfilled"
                    ? (recentTxRes.value.data?.data ?? []).slice(0, 5)
                    : [];

                // pagination.total is the real count in the date window —
                // far more useful than "5 txns" no matter what.
                const recentActivityCount = last7Res.status === "fulfilled"
                    ? (last7Res.value.data?.pagination?.total ?? 0)
                    : 0;

                const totalSaved = goalsRes.status === "fulfilled"
                    ? (goalsRes.value.data?.data?.totalSavedAmount ?? 0)
                    : 0;

                const monthlyIncome = incomeListRes.status === "fulfilled"
                    ? (incomeListRes.value.data?.data ?? []).reduce(
                        (sum: number, inc: { amount: number }) => sum + (inc.amount || 0), 0,
                    )
                    : 0;

                setStats({ totalSaved, monthlyIncome, monthlySpend, recentTransactions, recentActivityCount, chartData });
            } catch (err) {
                console.error("Failed to load dashboard data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, []);

    if (loading) {
        return <div className="flex h-full items-center justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>;
    }

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Hello, {user?.name || "User"}</h1>
                    <p className="text-zinc-500 text-sm">Here is your financial overview.</p>
                </div>
                <button className="p-3 bg-zinc-900 rounded-full border border-white/5 hover:border-purple-500/50 text-zinc-400 hover:text-white transition-all">
                    <Bell className="w-5 h-5" />
                </button>
            </div>

            {/* Top row reads left-to-right: assets → income → spend → activity */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <StatCard
                    title="Total Assets"
                    value={fmt.format(stats.totalSaved)}
                    trend="In Vaults"
                    trendUp={true}
                    icon={Wallet}
                    gradient={true}
                    className="bg-gradient-to-br from-yellow-900/20 to-black border-yellow-500/20"
                />
                <StatCard
                    title="Income this Month"
                    value={fmt.format(stats.monthlyIncome)}
                    trend="This Month"
                    trendUp={true}
                    icon={TrendingUp}
                    className="bg-gradient-to-br from-emerald-900/15 to-black border-emerald-500/15"
                />
                <StatCard
                    title="Monthly Spend"
                    value={fmt.format(stats.monthlySpend)}
                    trend="This Month"
                    trendUp={false}
                    icon={CreditCard}
                />
                <StatCard
                    title="Recent Activity"
                    value={`${stats.recentActivityCount} txns`}
                    trend="Last 7 Days"
                    icon={TrendingUp}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                <div className="lg:col-span-2 p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
                    <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                        <h2 className="text-lg font-semibold text-white">Spending by Category</h2>
                        <div className="flex gap-1 p-1 bg-black/40 rounded-xl border border-white/5" role="group" aria-label="Chart type">
                            {CHART_TYPES.map(({ key, label, Icon }) => {
                                const active = key === chartType;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => setChartType(key)}
                                        className={cn(
                                            "relative px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500/50",
                                            active ? "text-white" : "text-zinc-500 hover:text-zinc-300",
                                        )}
                                    >
                                        {active && (
                                            <motion.div
                                                layoutId="breakdown-type-indicator"
                                                className="absolute inset-0 bg-purple-600/30 border border-purple-500/30 rounded-lg"
                                                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                                            />
                                        )}
                                        <span className="relative flex items-center gap-1.5">
                                            <Icon className="w-3.5 h-3.5" />
                                            <span className="hidden sm:inline">{label}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <SpendingChart data={stats.chartData} chartType={chartType} />
                </div>

                <div className="lg:col-span-1 p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
                    </div>
                    <RecentTransactions transactions={stats.recentTransactions} />
                </div>
            </div>

            {/* DASH-1 Phase 2: standalone mount for testing. Phase 4 folds this
                and SpendingChart into a single DashboardChartPanel switcher. */}
            <SpendingTimelineChart />
        </div>
    );
}
