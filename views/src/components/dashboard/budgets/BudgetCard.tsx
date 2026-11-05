"use client";

import { useId, useState } from "react";
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { RowActions } from "@/components/dashboard/RowActions";
import { FieldError, FieldLabel, Meter, StateNote } from "@/components/dashboard/ui";
import { apiErrorMessage } from "@/lib/apiError";
import { budgetState, type BudgetRow } from "./budgetModel";

interface BudgetCardProps {
    budget: BudgetRow;
    // How far through the viewed month we are (0–1): where an even pace is.
    pace: number;
    // Whether the viewed month is the current one (pace is only a nudge then).
    current: boolean;
    index: number;
    /** Called after an edit or delete so the page can re-fetch. */
    onChanged: () => void;
}

// One budget: what's been spent against its limit, a tick where an even pace
// would be, and the state in words with an icon (DESIGN.md › Bars, Meters).
export function BudgetCard({ budget, pace, current, index, onChanged }: BudgetCardProps) {
    const { format: fmt } = useCurrency();
    const [editing, setEditing] = useState(false);
    const state = budgetState(budget, pace);
    const pct = budget.limit > 0 ? Math.round((budget.spent / budget.limit) * 100) : 0;
    const titleId = useId();

    const handleDelete = async () => {
        await api.delete(`/budgets/${budget._id}`);
        onChanged();
    };

    return (
        <section aria-labelledby={titleId} className="min-w-0 flex flex-col p-5 md:p-7 rounded-3xl bg-graphite shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
            <div className="flex items-start justify-between gap-3 min-h-11">
                <div className="min-w-0 pt-2.5">
                    <h2 id={titleId} className="flex items-center gap-2.5 min-w-0">
                        <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: budget.categoryColor }} />
                        <span className="truncate font-semibold text-white" title={budget.categoryName}>{budget.categoryName}</span>
                    </h2>
                    {budget.categoryArchived && <p className="mt-1.5 label-caps text-zinc-400">Archived category</p>}
                </div>
                {!editing && (
                    <RowActions
                        itemLabel={`${budget.categoryName} budget`}
                        onEdit={() => setEditing(true)}
                        onDelete={handleDelete}
                        confirmText="Delete budget?"
                        className="-mr-2"
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
                    <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-white">
                        <span className="text-[26px] leading-none font-light [font-stretch:112%] tabular-nums">{fmt(budget.spent)}</span>
                        <span className="text-[13.5px] text-zinc-400 tabular-nums">of {fmt(budget.limit)}</span>
                    </p>
                    <Meter
                        fraction={budget.limit > 0 ? budget.spent / budget.limit : 0}
                        tone={state === "over" ? "bad" : "plat"}
                        tick={current ? pace : undefined}
                        delay={index * 0.09}
                        className="mt-4 mb-3"
                    />
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        {state === "over"
                            ? <StateNote tone="bad" icon={CircleAlert}>Over by {fmt(budget.spent - budget.limit)}</StateNote>
                            : state === "alert"
                                ? <StateNote tone="warn" icon={TriangleAlert}>Past your {budget.alertThreshold}% alert</StateNote>
                                : state === "ahead" && current
                                    ? <StateNote tone="warn" icon={TriangleAlert}>Ahead of pace</StateNote>
                                    : <StateNote tone="good" icon={CircleCheck}>{current ? "On pace" : "Within limit"}</StateNote>}
                        <span className="text-[12.5px] text-zinc-400 tabular-nums">
                            {state === "over" ? `${pct}% used` : `${fmt(budget.remaining)} left · ${pct}%`}
                        </span>
                    </div>
                </>
            )}
        </section>
    );
}

// Limit + alert threshold only: the category is fixed for an existing budget
// (delete and re-create to move it).
function BudgetEditForm({ budget, onCancel, onSaved }: { budget: BudgetRow; onCancel: () => void; onSaved: () => void }) {
    const { currency } = useCurrency();
    const [limit, setLimit] = useState(String(budget.limit));
    const [threshold, setThreshold] = useState(String(budget.alertThreshold));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ids = { limit: useId(), threshold: useId(), error: useId() };

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

    return (
        <form onSubmit={handleSave} className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <FieldLabel htmlFor={ids.limit}>Limit ({currency})</FieldLabel>
                    <input id={ids.limit} type="number" min={0} step="any" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)}
                        aria-describedby={error ? ids.error : undefined} aria-invalid={error ? true : undefined}
                        className="field tabular-nums" autoFocus />
                </div>
                <div>
                    <FieldLabel htmlFor={ids.threshold}>Alert at (%)</FieldLabel>
                    <input id={ids.threshold} type="number" min={0} max={100} step={1} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)}
                        aria-describedby={error ? ids.error : undefined} aria-invalid={error ? true : undefined}
                        className="field tabular-nums" />
                </div>
            </div>

            {error && <FieldError id={ids.error}>{error}</FieldError>}

            <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={saving} className="btn-quiet">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">
                    {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    Save
                </button>
            </div>
        </form>
    );
}
