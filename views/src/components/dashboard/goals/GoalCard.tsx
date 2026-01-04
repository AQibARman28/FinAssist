"use client";

import { motion } from "framer-motion";
import { Trophy, Calendar, Target, Plus, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { api } from "@/lib/api";

interface GoalCardProps {
    _id: string;
    title: string;
    currentAmount: number;
    targetAmount: number;
    targetDate: string;
    daysRemaining: number;
    onUpdate: () => void;
}

export function GoalCard({ _id, title, currentAmount, targetAmount, targetDate, daysRemaining, onUpdate }: GoalCardProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [addAmount, setAddAmount] = useState("");
    const [loading, setLoading] = useState(false);

    const percentage = targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;
    const isCompleted = percentage >= 100;

    const handleContribute = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!addAmount) return;

        setLoading(true);
        try {
            await api.post(`/goals/${_id}/contribute`, {
                amount: parseFloat(addAmount),
                note: "Quick Add"
            });
            setAddAmount("");
            setIsAdding(false);
            onUpdate();
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-6 rounded-3xl border transition-all relative overflow-hidden group
        ${isCompleted
                    ? 'bg-yellow-500/10 border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.1)]'
                    : 'bg-zinc-900/50 border-white/5 hover:border-yellow-500/20'
                }`}
        >
            {/* Background Decor */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 blur-[60px] rounded-full pointer-events-none" />

            <div className="flex justify-between items-start mb-6 relative">
                <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${isCompleted ? 'bg-yellow-500 text-black' : 'bg-zinc-800 text-yellow-500'}`}>
                        {isCompleted ? <Trophy className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                    </div>
                    <div>
                        <h3 className="text-lg font-medium text-white">{title}</h3>
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                            <Calendar className="w-3 h-3" />
                            <span>{format(new Date(targetDate), "MMM d, yyyy")}</span>
                            {daysRemaining > 0 && <span>• {daysRemaining} days left</span>}
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <div className="flex justify-between items-end mb-2">
                    <span className="text-3xl font-bold text-white tracking-tight">
                        ${currentAmount.toLocaleString()}
                    </span>
                    <span className="text-zinc-500 text-sm mb-1">
                        of ${targetAmount.toLocaleString()}
                    </span>
                </div>

                {/* Golden Progress Bar */}
                <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 1.2, ease: "circOut" }}
                        className={`h-full rounded-full relative overflow-hidden ${isCompleted ? 'bg-yellow-400' : 'bg-gradient-to-r from-yellow-600 to-yellow-400'}`}
                    >
                        {/* Shimmer Effect */}
                        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                    </motion.div>
                </div>
            </div>

            {/* Quick Add Section */}
            {isAdding ? (
                <form onSubmit={handleContribute} className="flex gap-2 animate-in fade-in slide-in-from-bottom-2">
                    <input
                        autoFocus
                        type="number"
                        placeholder="Amount"
                        value={addAmount}
                        onChange={(e) => setAddAmount(e.target.value)}
                        className="w-full bg-black/40 border border-yellow-500/30 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
                    />
                    <button
                        type="submit"
                        disabled={loading}
                        className="bg-yellow-500 text-black px-4 rounded-xl font-medium text-sm hover:bg-yellow-400 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                    </button>
                </form>
            ) : (
                <button
                    onClick={() => setIsAdding(true)}
                    disabled={isCompleted}
                    className={`w-full py-3 rounded-xl border border-dashed flex items-center justify-center gap-2 text-sm font-medium transition-all
                ${isCompleted
                            ? 'border-transparent text-yellow-500 cursor-default'
                            : 'border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-white/20'
                        }`}
                >
                    {isCompleted ? (
                        <span>Goal Achieved! 🎉</span>
                    ) : (
                        <>
                            <Plus className="w-4 h-4" />
                            <span>Add Funds</span>
                        </>
                    )}
                </button>
            )}
        </motion.div>
    );
}
