"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PieChart } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

interface RatioData {
    totalIncome: number;
    totalExpense: number;
    ratio: number | null;       // Part-7 shape: null when totalIncome is 0
}

export function ExpenseIncomeRatio() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 });

    const [data, setData] = useState<RatioData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get("/analytics/expense-income-ratio");
                setData(res.data?.data ?? null);
            } catch (err) {
                console.error("Failed to fetch ratio", err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) return <div className="h-40 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    const pct       = data?.ratio === null ? null : Math.round((data?.ratio ?? 0) * 100);
    const noIncome  = data?.ratio === null;
    const isHigh    = pct !== null && pct > 80;
    const isMedium  = pct !== null && pct > 50;
    const colorText = noIncome ? "text-zinc-400" : isHigh ? "text-red-400" : isMedium ? "text-yellow-400" : "text-green-400";
    const colorBar  = isHigh ? "bg-red-500" : isMedium ? "bg-yellow-500" : "bg-green-500";

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 h-full">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-white">Spend / Income</h3>
                    <p className="text-xs text-zinc-500">This calendar month</p>
                </div>
                <PieChart className="w-5 h-5 text-zinc-400" />
            </div>

            <div className="flex items-end gap-2 mb-2">
                <span className={`text-4xl font-bold tabular-nums ${colorText}`}>
                    {noIncome ? "—" : `${pct}%`}
                </span>
                <span className="text-sm text-zinc-400 mb-1">
                    {noIncome ? "no income on file" : "of income spent"}
                </span>
            </div>

            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: noIncome ? "0%" : `${Math.min(pct ?? 0, 100)}%` }}
                    transition={{ duration: 1, delay: 0.3 }}
                    className={`h-full ${colorBar}`}
                />
            </div>

            <div className="flex justify-between mt-4 text-xs text-zinc-500 tabular-nums">
                <span>Spent: {fmt.format(data?.totalExpense ?? 0)}</span>
                <span>Income: {fmt.format(data?.totalIncome ?? 0)}</span>
            </div>
        </div>
    );
}
