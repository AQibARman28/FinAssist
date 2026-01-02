"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PieChart, DollarSign } from "lucide-react";
import { api } from "@/lib/api";

export function ExpenseIncomeRatio() {
    const [data, setData] = useState<{ totalExpense: number; totalIncome: number; expenseIncomeRatio: number } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await api.get("/analytics/expense-income-ratio");
                setData(res.data.data);
            } catch (err) {
                console.error("Failed to fetch ratio", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    if (loading) return <div className="h-40 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    const ratio = data ? Number(data.expenseIncomeRatio) : 0;
    const isHigh = ratio > 80;
    const isMedium = ratio > 50;

    const getColor = () => {
        if (isHigh) return "text-red-500 bg-red-500";
        if (isMedium) return "text-yellow-500 bg-yellow-500";
        return "text-green-500 bg-green-500";
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 relative overflow-hidden">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-lg font-semibold text-white">Spending Ratio</h3>
                    <p className="text-xs text-zinc-500">Expense vs. Budget Limit</p>
                </div>
                <PieChart className="w-5 h-5 text-zinc-400" />
            </div>

            <div className="flex items-end gap-2 mb-2">
                <span className={`text-4xl font-bold ${getColor().split(' ')[0]}`}>{ratio}%</span>
                <span className="text-sm text-zinc-400 mb-1">of budget spent</span>
            </div>

            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(ratio, 100)}%` }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className={`h-full ${getColor().split(' ')[1]}`}
                />
            </div>

            <div className="flex justify-between mt-4 text-xs text-zinc-500 font-mono">
                <span>Spent: ${data?.totalExpense.toLocaleString()}</span>
                <span>Limit: ${data?.totalIncome.toLocaleString()}</span>
            </div>
        </div>
    );
}
