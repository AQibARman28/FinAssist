"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useCurrency } from "@/lib/useCurrency";

interface BudgetCardProps {
    category: string;
    limit: number;
    spent: number;
    usagePercentage: number;
    isOverLimit: boolean;
    onEdit?: () => void;
}

export function BudgetCard({ category, limit, spent, usagePercentage, isOverLimit, onEdit }: BudgetCardProps) {
    const { format: fmt } = useCurrency();

    // Determine color based on usage
    let colorClass = "bg-emerald-500";
    let glowClass = "shadow-[0_0_10px_rgba(16,185,129,0.3)]";

    if (usagePercentage >= 100) {
        colorClass = "bg-red-600";
        glowClass = "shadow-[0_0_15px_rgba(220,38,38,0.5)]";
    } else if (usagePercentage >= 80) {
        colorClass = "bg-orange-500";
        glowClass = "shadow-[0_0_10px_rgba(249,115,22,0.3)]";
    } else if (usagePercentage >= 50) {
        colorClass = "bg-yellow-400";
        glowClass = "shadow-[0_0_10px_rgba(250,204,21,0.3)]";
    }

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 relative overflow-hidden group hover:bg-zinc-900/80 transition-all cursor-pointer"
            onClick={onEdit}
        >
            {/* Background Glow for Critical Budgets */}
            {isOverLimit && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 blur-[50px] rounded-full pointer-events-none" />
            )}

            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-lg font-medium text-white">{category}</h3>
                    <p className="text-xs text-zinc-500 mt-1">Monthly Limit</p>
                </div>
                <div className="text-right">
                    <span className="block text-xl font-bold text-white">{fmt(limit)}</span>
                    <span className={`text-xs ${isOverLimit ? 'text-red-400' : 'text-zinc-500'}`}>
                        {isOverLimit ? 'Over Budget!' : 'Total Budget'}
                    </span>
                </div>
            </div>

            {/* Progress Bar Container */}
            <div className="relative h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                {/* Actual Progress Bar */}
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(usagePercentage, 100)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className={`h-full rounded-full ${colorClass} ${glowClass}`}
                />
            </div>

            <div className="flex justify-between items-center mt-3 text-sm">
                <span className="text-zinc-400">
                    Spent: <span className="text-white font-medium">{fmt(spent)}</span>
                </span>
                <span className={`${isOverLimit ? 'text-red-400 font-bold' : 'text-zinc-500'}`}>
                    {usagePercentage.toFixed(0)}%
                </span>
            </div>

            {/* Alert Icon if needed */}
            {isOverLimit && (
                <div className="absolute bottom-4 right-1/2 translate-x-1/2 flex items-center gap-2 text-[10px] text-red-500 font-bold bg-red-950/30 px-2 py-1 rounded-full border border-red-900/50">
                    <AlertTriangle className="w-3 h-3" />
                    LIMIT EXCEEDED
                </div>
            )}
        </motion.div>
    );
}
