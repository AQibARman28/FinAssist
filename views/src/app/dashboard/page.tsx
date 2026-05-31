"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/dashboard/StatCard";
import { DashboardChartPanel } from "@/components/dashboard/DashboardChartPanel";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { MonthRolloverModal } from "@/components/dashboard/MonthRolloverModal";
import { Wallet, CreditCard, TrendingUp, PiggyBank, Target, Bell, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

interface DashboardStats {
    wallet:             number;
    savings:            number;
    totalSaved:         number;
    monthlyIncome:      number;
    monthlySpend:       number;
    recentTransactions: any[];
    recentActivityCount: number;
    chartData:          { name: string; amount: number; color?: string }[];
}

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

    const [loading, setLoading] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [stats, setStats] = useState<DashboardStats>({
        wallet:             0,
        savings:            0,
        totalSaved:         0,
        monthlyIncome:      0,
        monthlySpend:       0,
        recentTransactions: [],
        recentActivityCount: 0,
        chartData:          [],
    });

    const fetchDashboardData = useCallback(async () => {
            try {
                const now = new Date();
                const year  = now.getUTCFullYear();
                const month = now.getUTCMonth();
                const monthStart = new Date(Date.UTC(year, month,     1, 0, 0, 0, 0));
                const monthEnd   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

                // Run in parallel; one failure doesn't break the others.
                const [expenseSummaryRes, recentTxRes, last7Res, goalsRes, incomeListRes, balanceRes] = await Promise.allSettled([
                    api.get(`/expenses/summary/${year}/${month + 1}`),
                    api.get("/expenses", { params: { limit: 5 } }),
                    api.get("/expenses", {
                        params: { startDate: sevenDaysAgo.toISOString(), endDate: now.toISOString(), limit: 1 },
                    }),
                    api.get("/goals/dashboard"),
                    api.get("/incomes", {
                        params: { startDate: monthStart.toISOString(), endDate: monthEnd.toISOString(), limit: 100 },
                    }),
                    api.get("/analytics/balance"),
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

                const wallet = balanceRes.status === "fulfilled"
                    ? (balanceRes.value.data?.data?.wallet ?? balanceRes.value.data?.data?.available ?? 0)
                    : 0;
                const savings = balanceRes.status === "fulfilled"
                    ? (balanceRes.value.data?.data?.savingsBalance ?? 0)
                    : 0;

                setStats({ wallet, savings, totalSaved, monthlyIncome, monthlySpend, recentTransactions, recentActivityCount, chartData });
            } catch (err) {
                console.error("Failed to load dashboard data", err);
            } finally {
                setLoading(false);
            }
    }, []);

    useEffect(() => { fetchDashboardData(); }, [fetchDashboardData, refreshTrigger]);

    if (loading) {
        return <div className="flex h-full items-center justify-center p-20"><Loader2 className="w-8 h-8 animate-spin text-purple-500" /></div>;
    }

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            <MonthRolloverModal onDone={() => setRefreshTrigger((t) => t + 1)} />

            <div className="flex justify-between items-center mb-2 md:mb-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-white">Hello, {user?.name || "User"}</h1>
                    <p className="text-zinc-500 text-sm">Here is your financial overview.</p>
                </div>
                <button className="p-3 bg-zinc-900 rounded-full border border-white/5 hover:border-purple-500/50 text-zinc-400 hover:text-white transition-all">
                    <Bell className="w-5 h-5" />
                </button>
            </div>

            {/* Hero: the Wallet — the one spendable number, carried forward each month */}
            <div className="p-5 md:p-6 rounded-2xl bg-gradient-to-br from-purple-900/30 to-black border border-purple-500/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-purple-600/10 blur-[70px] rounded-full pointer-events-none" />
                <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-zinc-400">Wallet · spendable now</span>
                    <Wallet className="w-5 h-5 text-purple-400" />
                </div>
                <div className="text-3xl md:text-4xl font-bold tabular-nums text-white mt-2">{fmt.format(stats.wallet)}</div>
                <p className="text-xs text-zinc-500 mt-1">Carries forward each month · income − expenses − savings</p>
            </div>

            {/* Secondary stats — calmer than the hero */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <StatCard
                    title="Savings"
                    value={fmt.format(stats.savings)}
                    trend="Set aside"
                    trendUp={true}
                    icon={PiggyBank}
                    className="bg-gradient-to-br from-emerald-900/15 to-black border-emerald-500/15"
                />
                <StatCard
                    title="In Goals"
                    value={fmt.format(stats.totalSaved)}
                    icon={Target}
                    className="bg-gradient-to-br from-yellow-900/15 to-black border-yellow-500/15"
                />
                <StatCard
                    title="Income (mo)"
                    value={fmt.format(stats.monthlyIncome)}
                    trend="This Month"
                    trendUp={true}
                    icon={TrendingUp}
                />
                <StatCard
                    title="Spend (mo)"
                    value={fmt.format(stats.monthlySpend)}
                    trend="This Month"
                    trendUp={false}
                    icon={CreditCard}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 h-full">
                <div className="lg:col-span-2">
                    <DashboardChartPanel data={stats.chartData} />
                </div>

                <div className="lg:col-span-1 p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
                    </div>
                    <RecentTransactions transactions={stats.recentTransactions} />
                </div>
            </div>
        </div>
    );
}
