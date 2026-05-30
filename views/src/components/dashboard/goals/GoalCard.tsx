"use client";

import { motion } from "framer-motion";
import { Trophy, Target, Plus, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";

export interface Goal {
    _id: string;
    title: string;
    period: "monthly" | "yearly";
    targetAmount: number;
    currentAmount: number;
    status: "Active" | "Completed" | "Paused";
}

export function GoalCard({ goal, onUpdate }: { goal: Goal; onUpdate: () => void }) {
    const { format: fmt } = useCurrency();
    const [isAdding, setIsAdding] = useState(false);
    const [addAmount, setAddAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const percentage = goal.targetAmount > 0 ? Math.min((goal.currentAmount / goal.targetAmount) * 100, 100) : 0;
    const isCompleted = goal.status === "Completed" || percentage >= 100;

    const handleContribute = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(addAmount);
        if (!amount || amount <= 0) return;
        setLoading(true);
        setError(null);
        try {
            await api.post(`/goals/${goal._id}/contribute`, { amount, note: "Add funds" });
            setAddAmount("");
            setIsAdding(false);
            onUpdate();
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to add funds");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(`Delete goal "${goal.title}"? This can't be undone.`)) return;
        setDeleting(true);
        try {
            await api.delete(`/goals/${goal._id}`);
            onUpdate();
        } catch (err) {
            console.error(err);
            setDeleting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "p-6 rounded-3xl border transition-all relative overflow-hidden group",
                isCompleted ? "bg-yellow-500/10 border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.1)]" : "bg-zinc-900/50 border-white/5 hover:border-yellow-500/20",
            )}
        >
            <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 blur-[60px] rounded-full pointer-events-none" />

            <div className="flex justify-between items-start mb-5 relative gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={cn("p-3 rounded-xl shrink-0", isCompleted ? "bg-yellow-500 text-black" : "bg-zinc-800 text-yellow-500")}>
                        {isCompleted ? <Trophy className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-lg font-medium text-white truncate">{goal.title}</h3>
                        <span className="text-[11px] uppercase tracking-wider text-zinc-500">{goal.period}</span>
                    </div>
                </div>
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    aria-label="Delete goal"
                    className="shrink-0 p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
            </div>

            <div className="mb-4">
                <div className="flex justify-between items-end mb-2">
                    <span className="text-3xl font-bold text-white tracking-tight">{fmt(goal.currentAmount)}</span>
                    <span className="text-zinc-500 text-sm mb-1">of {fmt(goal.targetAmount)}</span>
                </div>
                <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${percentage}%` }}
                        transition={{ duration: 1.2, ease: "circOut" }}
                        className={cn("h-full rounded-full relative overflow-hidden", isCompleted ? "bg-yellow-400" : "bg-gradient-to-r from-yellow-600 to-yellow-400")}
                    >
                        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />
                    </motion.div>
                </div>
            </div>

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            {isAdding ? (
                <form onSubmit={handleContribute} className="flex gap-2">
                    <input
                        autoFocus
                        type="number"
                        min={1}
                        step="any"
                        placeholder="Amount"
                        value={addAmount}
                        onChange={(e) => setAddAmount(e.target.value)}
                        className="w-full bg-black/40 border border-yellow-500/30 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
                    />
                    <button type="submit" disabled={loading} className="bg-yellow-500 text-black px-4 rounded-xl font-medium text-sm hover:bg-yellow-400 disabled:opacity-50">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
                    </button>
                </form>
            ) : (
                <button
                    onClick={() => { setError(null); setIsAdding(true); }}
                    disabled={isCompleted}
                    className={cn(
                        "w-full py-3 rounded-xl border border-dashed flex items-center justify-center gap-2 text-sm font-medium transition-all",
                        isCompleted ? "border-transparent text-yellow-500 cursor-default" : "border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-white/20",
                    )}
                >
                    {isCompleted ? <span>Goal Achieved! 🎉</span> : <><Plus className="w-4 h-4" /><span>Add Funds</span></>}
                </button>
            )}
        </motion.div>
    );
}
