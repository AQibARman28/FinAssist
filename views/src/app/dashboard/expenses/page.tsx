"use client";

import { useState, useEffect } from "react";
import { ExpenseForm } from "@/components/dashboard/expenses/ExpenseForm";
import { ExpenseList } from "@/components/dashboard/expenses/ExpenseList";
import { StatCard } from "@/components/dashboard/StatCard";
import { TrendingDown, Calendar, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { format } from "date-fns";

export default function ExpensesPage() {
    const { format: fmtMoney } = useCurrency();
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [stats, setStats] = useState({
        totalSpent: 0,
        dailyAverage: 0,
        month: ""
    });

    const fetchStats = async () => {
        try {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const daysInMonth = new Date(year, month, 0).getDate();

            const res = await api.get(`/expenses/summary/${year}/${month}`);
            const total = res.data.data.totalSpent || 0;

            setStats({
                totalSpent: total,
                dailyAverage: total / new Date().getDate(), // Average so far today
                month: format(now, "MMMM")
            });
        } catch (err) {
            console.error("Failed to fetch stats", err);
        }
    };

    useEffect(() => {
        fetchStats();
    }, [refreshTrigger]);

    const handleRefresh = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">Expenses</h1>
                <p className="text-zinc-500 text-sm">Manage and track your spending</p>
            </div>

            {/* Stats - Horizontal */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Spent"
                    value={fmtMoney(stats.totalSpent)}
                    trend="This Month"
                    trendUp={false}
                    icon={TrendingDown}
                    className="bg-zinc-900/50"
                />
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
                    icon={Wallet}
                    className="bg-zinc-900/50"
                />
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 gap-6">
                <ExpenseForm onAdd={handleRefresh} />
                <ExpenseList refreshTrigger={refreshTrigger} />
            </div>
        </div>
    );
}
