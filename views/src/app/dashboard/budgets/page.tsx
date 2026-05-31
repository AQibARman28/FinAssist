"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Wallet, TrendingUp, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { BudgetForm } from "@/components/dashboard/budgets/BudgetForm";
import { BudgetCard } from "@/components/dashboard/budgets/BudgetCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { useCurrency } from "@/lib/useCurrency";

interface BudgetData {
    _id: string;
    category: string;
    limit: number;
    spent: number;
    usagePercentage: number;
    isOverLimit: boolean;
}

export default function BudgetsPage() {
    const { format: fmt } = useCurrency();
    const [budgets, setBudgets] = useState<BudgetData[]>([]);
    const [summary, setSummary] = useState({ totalLimit: 0, totalSpent: 0 });
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const fetchBudgets = async () => {
        try {
            const now = new Date();
            const res = await api.get(`/budgets/tracking/${now.getFullYear()}/${now.getMonth() + 1}`);
            const budgetList: BudgetData[] = res.data.data.budgets;

            setBudgets(budgetList);

            // Calculate totals
            const totalLimit = budgetList.reduce((acc, curr) => acc + curr.limit, 0);
            const totalSpent = budgetList.reduce((acc, curr) => acc + curr.spent, 0);
            setSummary({ totalLimit, totalSpent });

        } catch (err) {
            console.error("Failed to fetch budgets", err);
        }
    };

    useEffect(() => {
        fetchBudgets();
    }, [refreshTrigger]);

    const handleRefresh = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-xl md:text-2xl font-bold text-white">Budgets</h1>
                <p className="text-zinc-500 text-sm">Set limits and track your monthly spending goals</p>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Budget"
                    value={fmt(summary.totalLimit)}
                    icon={Wallet}
                    className="bg-zinc-900/50"
                />
                <StatCard
                    title="Total Spent"
                    value={fmt(summary.totalSpent)}
                    trend={`${((summary.totalSpent / (summary.totalLimit || 1)) * 100).toFixed(0)}% Used`}
                    trendUp={false}
                    icon={TrendingUp}
                    className="bg-zinc-900/50"
                />
                <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 flex flex-col justify-center">
                    <div className="flex items-center gap-3 text-zinc-400 mb-2">
                        <AlertTriangle className="w-5 h-5" />
                        <span className="text-sm font-medium">Budget Health</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary.totalSpent > summary.totalLimit && summary.totalLimit > 0 ? "Critical" : "Healthy"}
                    </div>
                </div>
            </div>

            {/* Create Budget Form */}
            <BudgetForm onSuccess={handleRefresh} />

            {/* Budget Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {budgets.map((budget) => (
                    <BudgetCard
                        key={budget._id}
                        {...budget}
                    />
                ))}

                {budgets.length === 0 && (
                    <div className="col-span-full py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                        <p className="text-zinc-500">No active budgets for this month.</p>
                        <p className="text-zinc-600 text-sm mt-1">Set a limit above to get started.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
