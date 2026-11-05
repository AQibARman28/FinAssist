"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentTransactions, type Transaction } from "@/components/dashboard/RecentTransactions";
import { MonthRolloverModal } from "@/components/dashboard/MonthRolloverModal";
import { SkeletonBlock } from "@/components/dashboard/PageSkeleton";
import { Wallet, CreditCard, TrendingUp, PiggyBank, Target, Bell } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { reloadOnChunkError } from "@/lib/reloadOnChunkError";
import { useAuthStore } from "@/lib/store";

// The chart panel brings recharts (the app's biggest library after this page's
// own code). Loaded separately so the numbers above it never wait on it.
const DashboardChartPanel = dynamic(
    reloadOnChunkError(() => import("@/components/dashboard/DashboardChartPanel").then((m) => m.DashboardChartPanel)),
    { loading: () => <SkeletonBlock className="h-[26rem] rounded-3xl" /> },
);

// One row of GET /expenses/summary/:year/:month (only the fields used here).
interface SummaryRow {
    category:       string;
    amount:         number;
    categoryColor?: string;
}

function currencyFormatter(code = "USD"): Intl.NumberFormat {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

// The current UTC month as request params. ISO strings, not Dates, so the
// cache key stays the same for the whole month.
function currentMonthUTC() {
    const now = new Date();
    const year  = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
        year,
        month,
        start: new Date(Date.UTC(year, month,     1, 0, 0, 0, 0)).toISOString(),
        end:   new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString(),
    };
}

export default function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const fmt = useMemo(() => currencyFormatter(user?.currency || "USD"), [user?.currency]);
    const [{ year, month, start, end }] = useState(currentMonthUTC);

    // Each read is independent and cached (lib/useApi.ts): a revisit renders
    // at once, one slow endpoint doesn't hold up the rest, and a failed one
    // just shows zero. The rollover modal's write refreshes them itself.
    const summary = useApi<{ totalSpent?: number; summary?: SummaryRow[] }>(`/expenses/summary/${year}/${month + 1}`);
    const recent  = useApi<Transaction[]>("/expenses", { limit: 5 });
    const goals   = useApi<{ totalSavedAmount?: number }>("/goals/dashboard");
    const incomes = useApi<{ amount: number }[]>("/incomes", { startDate: start, endDate: end, limit: 100 });
    const balance = useApi<{ wallet?: number; available?: number; savingsBalance?: number }>("/analytics/balance");

    const chartData = useMemo(
        () => (summary.data?.summary ?? []).map((it) => ({ name: it.category, amount: it.amount, color: it.categoryColor })),
        [summary.data],
    );
    const monthlyIncome = useMemo(
        () => (incomes.data ?? []).reduce((sum, inc) => sum + (inc.amount || 0), 0),
        [incomes.data],
    );
    const stats = {
        wallet:             balance.data?.wallet ?? balance.data?.available ?? 0,
        savings:            balance.data?.savingsBalance ?? 0,
        totalSaved:         goals.data?.totalSavedAmount ?? 0,
        monthlyIncome,
        monthlySpend:       summary.data?.totalSpent ?? 0,
        recentTransactions: (recent.data ?? []).slice(0, 5),
        chartData,
    };

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            <MonthRolloverModal />

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
                {balance.isLoading
                    ? <div aria-hidden className="h-9 md:h-10 w-40 mt-2 rounded-lg bg-white/5 animate-pulse" />
                    : <div className="text-3xl md:text-4xl font-bold tabular-nums text-white mt-2">{fmt.format(stats.wallet)}</div>}
                <p className="text-xs text-zinc-500 mt-1">Carries forward each month · income − expenses − savings</p>
            </div>

            {/* Secondary stats — calmer than the hero */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <StatCard
                    title="Savings"
                    value={fmt.format(stats.savings)}
                    loading={balance.isLoading}
                    trend="Set aside"
                    trendUp={true}
                    icon={PiggyBank}
                    className="bg-gradient-to-br from-emerald-900/15 to-black border-emerald-500/15"
                />
                <StatCard
                    title="In Goals"
                    value={fmt.format(stats.totalSaved)}
                    loading={goals.isLoading}
                    icon={Target}
                    className="bg-gradient-to-br from-yellow-900/15 to-black border-yellow-500/15"
                />
                <StatCard
                    title="Income (mo)"
                    value={fmt.format(stats.monthlyIncome)}
                    loading={incomes.isLoading}
                    trend="This Month"
                    trendUp={true}
                    icon={TrendingUp}
                />
                <StatCard
                    title="Spend (mo)"
                    value={fmt.format(stats.monthlySpend)}
                    loading={summary.isLoading}
                    trend="This Month"
                    trendUp={false}
                    icon={CreditCard}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 h-full">
                <div className="lg:col-span-2">
                    {summary.isLoading
                        ? <SkeletonBlock className="h-[26rem] rounded-3xl" />
                        : <DashboardChartPanel data={stats.chartData} />}
                </div>

                <div className="lg:col-span-1 p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
                    </div>
                    {recent.isLoading ? (
                        <div className="space-y-3" aria-hidden>
                            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />)}
                        </div>
                    ) : (
                        <RecentTransactions transactions={stats.recentTransactions} />
                    )}
                </div>
            </div>
        </div>
    );
}
