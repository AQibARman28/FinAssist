import { StatCard } from "@/components/dashboard/StatCard";
import { SpendingChart } from "@/components/dashboard/SpendingChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { Wallet, CreditCard, TrendingUp, Bell } from "lucide-react";

"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/dashboard/StatCard";
import { SpendingChart } from "@/components/dashboard/SpendingChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { Wallet, CreditCard, TrendingUp, Bell, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

export default function DashboardPage() {
    const { user } = useAuthStore();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalSaved: 0,
        monthlySpend: 0,
        recentTransactions: [],
        chartData: [] as { name: string, amount: number }[]
    });

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const now = new Date();
                const year = now.getFullYear();
                const month = now.getMonth() + 1;

                // 1. Fetch Monthly Expense Summary
                const expenseRes = await api.get(`/expenses/summary/${year}/${month}`);
                const monthlySpend = expenseRes.data.data.totalSpent || 0;

                // Process chart data (summary by category as a proxy for trend, or dummy daily data if backend doesn't provide daily breakdown yet)
                // For now, let's map categories to chart for visualization
                const chartData = expenseRes.data.data.summary.map((item: any) => ({
                    name: item.category,
                    amount: item.amount
                }));

                // 2. Fetch Recent Transactions
                const txRes = await api.get("/expenses"); // Assumes this returns list sorted by date desc
                const recentTransactions = txRes.data.data.slice(0, 5);

                // 3. Fetch Goals for "Total Saved" (Total Assets)
                const goalsRes = await api.get("/goals/dashboard");
                const totalSaved = goalsRes.data.data.totalSavedAmount || 0;

                setStats({
                    totalSaved,
                    monthlySpend,
                    recentTransactions,
                    chartData
                });
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
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Hello, {user?.name || "User"}</h1>
                    <p className="text-zinc-500 text-sm">Here is your financial overview.</p>
                </div>
                <button className="p-3 bg-zinc-900 rounded-full border border-white/5 hover:border-purple-500/50 text-zinc-400 hover:text-white transition-all">
                    <Bell className="w-5 h-5" />
                </button>
            </div>

            {/* Stats Bento Grid - Top Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Assets"
                    value={`$${stats.totalSaved.toLocaleString()}`}
                    trend="In Vaults"
                    trendUp={true}
                    icon={Wallet}
                    gradient={true}
                    className="col-span-1 md:col-span-1 bg-gradient-to-br from-yellow-900/20 to-black border-yellow-500/20"
                />
                <StatCard
                    title="Monthly Spend"
                    value={`$${stats.monthlySpend.toLocaleString()}`}
                    trend="This Month"
                    trendUp={false}
                    icon={CreditCard}
                />
                <StatCard
                    title="Recent Activity"
                    value={`${stats.recentTransactions.length} txns`}
                    trend="Last 7 Days"
                    icon={TrendingUp}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">

                {/* Chart Section - Takes 2 cols */}
                <div className="lg:col-span-2 p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Spending by Category</h2>
                    </div>
                    <SpendingChart data={stats.chartData} />
                </div>

                {/* Transactions Section - Takes 1 col */}
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
