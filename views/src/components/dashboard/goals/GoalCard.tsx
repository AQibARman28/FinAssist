"use client";

import { motion } from "framer-motion";
import { Trophy, Target, Plus, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { apiErrorMessage } from "@/lib/apiError";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { PRIORITY_OPTIONS, priorityLevel, type GoalPlanRow } from "./goalPlanModel";

export interface Goal {
    _id: string;
    title: string;
    period: "monthly" | "yearly";
    targetAmount: number;
    currentAmount: number;
    status: "Active" | "Completed" | "Paused";
    priority?: number;
    targetDate?: string;
}

interface GoalCardProps {
    goal: Goal;
    onUpdate: () => void;
    /** This goal's row from GET /goals/plan (active goals only). */
    plan?: GoalPlanRow;
}

export function GoalCard({ goal, onUpdate, plan }: GoalCardProps) {
    const { format: fmt } = useCurrency();
    const [isAdding, setIsAdding] = useState(false);
    const [addAmount, setAddAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [savingPriority, setSavingPriority] = useState(false);
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
            setError(apiErrorMessage(err, "Failed to add funds"));
        } finally {
            setLoading(false);
        }
    };

    // Deleting archives the goal server-side: its saved money returns to the
    // wallet as of today; earlier months' balances are not rewritten.
    const handleDelete = async () => {
        setDeleting(true);
        setError(null);
        try {
            await api.delete(`/goals/${goal._id}`);
            onUpdate();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to delete goal"));
            setDeleting(false);
            setConfirmingDelete(false);
        }
    };

    const handlePriority = async (value: number) => {
        setSavingPriority(true);
        setError(null);
        try {
            await api.put(`/goals/${goal._id}`, { priority: value });
            onUpdate();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to update priority"));
        } finally {
            setSavingPriority(false);
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
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            <span className="text-[11px] uppercase tracking-wider text-zinc-500">{goal.period}</span>
                            {!isCompleted && plan && <GoalStatusBadge status={plan.status} />}
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => { setError(null); setConfirmingDelete(true); }}
                    disabled={deleting || confirmingDelete}
                    aria-label={`Delete goal ${goal.title}`}
                    className="shrink-0 p-2.5 -mr-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {confirmingDelete && (
                <div className="relative mb-4 p-3 rounded-xl bg-red-500/5 border border-red-500/20 space-y-2.5">
                    <p className="text-xs text-zinc-300">
                        Delete &ldquo;{goal.title}&rdquo;?{" "}
                        {goal.currentAmount > 0
                            ? <>The <span className="text-white font-medium tabular-nums">{fmt(goal.currentAmount)}</span> saved in it goes back to your wallet as of today. </>
                            : null}
                        Past months&apos; balances stay as they were.
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={handleDelete}
                            disabled={deleting}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50 transition-colors"
                        >
                            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Delete goal
                        </button>
                        <button
                            onClick={() => setConfirmingDelete(false)}
                            disabled={deleting}
                            className="px-3 py-2 text-xs rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 disabled:opacity-50 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="mb-4 relative">
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
                {!isCompleted && plan && plan.requiredMonthly !== null && (
                    <p className="text-[11px] text-zinc-500 mt-2 tabular-nums">
                        Needs {fmt(plan.requiredMonthly)}/mo
                        {plan.actualMonthlyRate !== null ? ` · saving ${fmt(plan.actualMonthlyRate)}/mo` : " · no recent contributions"}
                    </p>
                )}
            </div>

            {!isCompleted && (
                <div className="relative flex items-center justify-between gap-2 mb-4">
                    <label htmlFor={`prio-${goal._id}`} className="text-xs text-zinc-500">Priority</label>
                    <div className="flex items-center gap-2">
                        {savingPriority && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
                        <select
                            id={`prio-${goal._id}`}
                            value={priorityLevel(goal.priority)}
                            disabled={savingPriority}
                            onChange={(e) => handlePriority(parseInt(e.target.value, 10))}
                            className="bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-yellow-500/50 cursor-pointer disabled:opacity-50"
                        >
                            {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                </div>
            )}

            {error && <p className="text-xs text-red-400 mb-3 relative">{error}</p>}

            {isAdding ? (
                <form onSubmit={handleContribute} className="flex gap-2 relative">
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
                        "w-full py-3 rounded-xl border border-dashed flex items-center justify-center gap-2 text-sm font-medium transition-all relative",
                        isCompleted ? "border-transparent text-yellow-500 cursor-default" : "border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 hover:border-white/20",
                    )}
                >
                    {isCompleted ? <span>Goal Achieved! 🎉</span> : <><Plus className="w-4 h-4" /><span>Add Funds</span></>}
                </button>
            )}
        </motion.div>
    );
}
