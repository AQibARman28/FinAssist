"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/CategoryIcon";
import { RowActions } from "@/components/dashboard/RowActions";
import { apiErrorMessage } from "@/lib/apiError";
import { usageTone, type BudgetRow, type UsageTone } from "./budgetModel";

const TONE_BAR: Record<UsageTone, string> = {
    ok:   "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
    half: "bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.3)]",
    near: "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]",
    over: "bg-red-600 shadow-[0_0_15px_rgba(220,38,38,0.5)]",
};

interface BudgetCardProps {
    budget: BudgetRow;
    /** Called after an edit or delete so the page can re-fetch. */
    onChanged: () => void;
}

export function BudgetCard({ budget, onChanged }: BudgetCardProps) {
    const { format: fmt } = useCurrency();
    const [editing, setEditing] = useState(false);
    const tone = usageTone(budget);
    const pct = Number.isFinite(budget.usagePercentage) ? budget.usagePercentage : 0;

    const handleDelete = async () => {
        await api.delete(`/budgets/${budget._id}`);
        onChanged();
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-5 sm:p-6 rounded-3xl bg-zinc-900/50 border border-white/5 relative overflow-hidden hover:bg-zinc-900/80 transition-all"
        >
            {/* Background glow for critical budgets */}
            {budget.isOverLimit && (
                <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/10 blur-[50px] rounded-full pointer-events-none" />
            )}

            <div className="flex justify-between items-start gap-3 mb-5 relative">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl shrink-0" style={{ backgroundColor: `${budget.categoryColor}22` }}>
                        <CategoryIcon icon={budget.categoryIcon} className="w-5 h-5" style={{ color: budget.categoryColor }} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-base sm:text-lg font-medium text-white truncate" title={budget.categoryName}>{budget.categoryName}</h3>
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                            <span>Monthly limit</span>
                            {budget.categoryArchived && (
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/5 px-1.5 py-0.5 rounded">archived</span>
                            )}
                        </div>
                    </div>
                </div>
                {!editing && (
                    <RowActions
                        itemLabel={`${budget.categoryName} budget`}
                        onEdit={() => setEditing(true)}
                        onDelete={handleDelete}
                        confirmText="Delete budget?"
                        className="-mr-2 -mt-1"
                    />
                )}
            </div>

            {editing ? (
                <BudgetEditForm
                    budget={budget}
                    onCancel={() => setEditing(false)}
                    onSaved={() => { setEditing(false); onChanged(); }}
                />
            ) : (
                <>
                    <div className="flex justify-between items-end mb-3">
                        <span className="text-2xl font-bold text-white tabular-nums">{fmt(budget.spent)}</span>
                        <span className="text-sm text-zinc-500 tabular-nums">of {fmt(budget.limit)}</span>
                    </div>

                    <div className="relative h-3 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className={cn("h-full rounded-full", TONE_BAR[tone])}
                        />
                    </div>

                    <div className="flex justify-between items-center mt-3 text-sm">
                        <span className={cn(budget.isOverLimit ? "text-red-400" : "text-zinc-400")}>
                            {budget.isOverLimit
                                ? <>Over by <span className="font-medium tabular-nums">{fmt(budget.spent - budget.limit)}</span></>
                                : <>Left: <span className="text-white font-medium tabular-nums">{fmt(budget.remaining)}</span></>}
                        </span>
                        <span className={cn("tabular-nums", budget.isOverLimit ? "text-red-400 font-bold" : tone === "near" ? "text-orange-400" : "text-zinc-500")}>
                            {pct.toFixed(0)}%
                        </span>
                    </div>

                    {(budget.isOverLimit || budget.isNearLimit) && (
                        <div className={cn(
                            "mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-full border",
                            budget.isOverLimit
                                ? "text-red-400 bg-red-950/30 border-red-900/50"
                                : "text-orange-300 bg-orange-950/30 border-orange-900/50",
                        )}>
                            <AlertTriangle className="w-3 h-3" />
                            {budget.isOverLimit ? "LIMIT EXCEEDED" : `PAST ${budget.alertThreshold}% ALERT`}
                        </div>
                    )}
                </>
            )}
        </motion.div>
    );
}

// Limit + alert threshold only — the category is fixed for an existing budget
// (delete and re-create to move it).
function BudgetEditForm({ budget, onCancel, onSaved }: { budget: BudgetRow; onCancel: () => void; onSaved: () => void }) {
    const { currency } = useCurrency();
    const [limit, setLimit] = useState(String(budget.limit));
    const [threshold, setThreshold] = useState(String(budget.alertThreshold));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        const limitVal = parseFloat(limit);
        const thresholdVal = parseInt(threshold, 10);
        if (!Number.isFinite(limitVal) || limitVal < 0) { setError("Limit must be 0 or more"); return; }
        if (!Number.isInteger(thresholdVal) || thresholdVal < 0 || thresholdVal > 100) { setError("Alert threshold must be 0–100"); return; }

        const updates: Record<string, number> = {};
        if (limitVal !== budget.limit) updates.limit = limitVal;
        if (thresholdVal !== budget.alertThreshold) updates.alertThreshold = thresholdVal;
        if (Object.keys(updates).length === 0) { onCancel(); return; }

        setSaving(true);
        try {
            await api.put(`/budgets/${budget._id}`, updates);
            onSaved();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to update budget"));
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500/50 transition-colors tabular-nums";

    return (
        <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                    <label className="text-xs text-zinc-500">Limit ({currency})</label>
                    <input type="number" min={0} step="any" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className={inputCls} autoFocus />
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs text-zinc-500">Alert at (%)</label>
                    <input type="number" min={0} max={100} step={1} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={inputCls} />
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50">
                    Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save
                </button>
            </div>
        </form>
    );
}
