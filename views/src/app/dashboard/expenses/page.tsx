"use client";

import { useState } from "react";
import { QuickAddBar } from "@/components/dashboard/expenses/QuickAddBar";
import { ExpenseForm } from "@/components/dashboard/expenses/ExpenseForm";
import { ExpenseList } from "@/components/dashboard/expenses/ExpenseList";
import Link from "next/link";
import { StatCard } from "@/components/dashboard/StatCard";
import { TrendingDown, Calendar, Wallet, PiggyBank, History } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { format } from "date-fns";

export default function ExpensesPage() {
    const { format: fmtMoney } = useCurrency();
    const [now] = useState(() => new Date());
    // Every add, edit or delete on this page is a write through lib/api.ts,
    // which refreshes these tiles (and the list) on its own.
    const summary = useApi<{ totalSpent?: number }>(`/expenses/summary/${now.getFullYear()}/${now.getMonth() + 1}`);
    const balance = useApi<{ monthly?: { saved?: number } }>("/analytics/balance");
    const totalSpent = summary.data?.totalSpent || 0;
    const stats = {
        totalSpent,
        dailyAverage: totalSpent / new Date().getDate(), // Average so far today
        month: format(now, "MMMM"),
        saved: balance.data?.monthly?.saved || 0,   // saved into goals this month — set aside, not spent
    };

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8 flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-white">Expenses</h1>
                    <p className="text-zinc-500 text-sm">Manage and track your spending</p>
                </div>
                <Link
                    href="/dashboard/expenses/history"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-sm font-medium hover:bg-white/10 hover:text-white transition-colors shrink-0"
                >
                    <History className="w-4 h-4" /> Transaction history
                </Link>
            </div>

            {/* Natural-language quick-add */}
            <QuickAddBar
                onUseForm={() =>
                    document.getElementById("expense-detail-form")?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
            />

            {/* Stats - Horizontal */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Spent"
                    value={fmtMoney(stats.totalSpent)}
                    loading={summary.isLoading}
                    trend="This Month"
                    trendUp={false}
                    icon={TrendingDown}
                    className="bg-zinc-900/50"
                />
                {/* Savings is an outflow (leaves the pocket) but NOT spending —
                    highlighted green so it reads as "set aside, not spent". */}
                <div className="p-6 rounded-3xl bg-gradient-to-br from-emerald-900/15 to-black border border-emerald-500/20 relative overflow-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400">
                            <PiggyBank className="w-6 h-6" />
                        </div>
                        <span className="text-sm font-medium px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400">Not spent</span>
                    </div>
                    <h3 className="text-zinc-500 text-sm font-medium mb-1">Saved this month</h3>
                    <p className="text-3xl font-bold tracking-tight text-emerald-400">{fmtMoney(stats.saved)}</p>
                    <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">Total outflow {fmtMoney(stats.totalSpent + stats.saved)} (spent + saved)</p>
                </div>
                <StatCard
                    title="Current Month"
                    value={stats.month}
                    trend={new Date().getFullYear().toString()}
                    icon={Calendar}
                    className="bg-zinc-900/50"
                />
                <StatCard
                    title="Daily Average"
                    value={fmtMoney(stats.dailyAverage)}
                    loading={summary.isLoading}
                    icon={Wallet}
                    className="bg-zinc-900/50"
                />
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 gap-6">
                <div id="expense-detail-form">
                    <ExpenseForm />
                </div>
                <ExpenseList />
            </div>
        </div>
    );
}
