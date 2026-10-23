"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { parseAmount } from "@/lib/parseAmount";
import { CategoryPicker } from "@/components/CategoryPicker";
import { CategoryIcon } from "@/components/CategoryIcon";
import { RowActions } from "@/components/dashboard/RowActions";
import { apiErrorMessage, apiFieldErrors } from "@/lib/apiError";

export interface ExpenseItem {
    _id: string;
    description: string;
    amount: number;
    category: string; // Category ObjectId
    date: string;
    note?: string | null;
}

export interface ExpenseCategory {
    _id: string;
    name: string;
    color: string;
    icon: string;
}

interface ExpenseRowProps {
    expense: ExpenseItem;
    category?: ExpenseCategory;
    onUpdated: (updated: ExpenseItem) => void;
    onDeleted: (id: string) => void;
}

// One expense in a list: read view with always-visible edit/delete (two-step
// delete confirm, touch-friendly) and an inline editor (PUT /expenses/:id).
export function ExpenseRow({ expense, category, onUpdated, onDeleted }: ExpenseRowProps) {
    const { formatExpense } = useCurrency();
    const [editing, setEditing] = useState(false);

    if (editing) {
        return (
            <ExpenseEditForm
                expense={expense}
                onCancel={() => setEditing(false)}
                onSaved={(updated) => { setEditing(false); onUpdated(updated); }}
            />
        );
    }

    const handleDelete = async () => {
        await api.delete(`/expenses/${expense._id}`);
        onDeleted(expense._id);
    };

    return (
        <div className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl bg-black/20 hover:bg-white/5 border border-transparent hover:border-white/5 transition-all">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div
                    className="p-2.5 sm:p-3 rounded-xl text-zinc-200 shrink-0"
                    style={{ backgroundColor: category ? `${category.color}22` : "rgba(255,255,255,0.05)" }}
                >
                    <CategoryIcon icon={category?.icon} className="w-5 h-5" style={category ? { color: category.color } : undefined} />
                </div>
                <div className="min-w-0">
                    <h4 className="text-white font-medium text-sm truncate" title={expense.description}>{expense.description}</h4>
                    <div className="flex gap-2 text-xs text-zinc-500 mt-0.5 min-w-0">
                        <span className="truncate">{category?.name ?? "Uncategorized"}</span>
                        <span>•</span>
                        <span className="tabular-nums shrink-0">{format(new Date(expense.date), "MMM d, yyyy")}</span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-3 shrink-0">
                <span className="text-white font-medium text-sm tabular-nums">{formatExpense(expense.amount)}</span>
                <RowActions
                    itemLabel={expense.description}
                    onEdit={() => setEditing(true)}
                    onDelete={handleDelete}
                    confirmText="Delete expense?"
                />
            </div>
        </div>
    );
}

// ── Inline editor ────────────────────────────────────────────────────────────

const AMOUNT_REASON: Record<string, string> = {
    empty:     "Enter an amount",
    invalid:   "Enter a valid amount or expression",
    negative:  "Amount must be positive",
    too_large: "Amount is too large",
};

// Local calendar day, matching how the list renders the date.
function toDateInput(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
}

function ExpenseEditForm({ expense, onCancel, onSaved }: {
    expense: ExpenseItem;
    onCancel: () => void;
    onSaved: (updated: ExpenseItem) => void;
}) {
    const { format: fmtMoney } = useCurrency();
    const initialDate = toDateInput(expense.date);
    const [description, setDescription] = useState(expense.description);
    const [amount, setAmount] = useState(String(expense.amount));
    const [date, setDate] = useState(initialDate);
    const [category, setCategory] = useState(expense.category);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);

    const parsed = parseAmount(amount);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setCategoryError(null);
        if (!description.trim()) { setError("Description can't be empty"); return; }
        if (!parsed.ok) { setError(AMOUNT_REASON[parsed.reason]); return; }
        if (!category) { setCategoryError("Pick a category"); return; }

        // Send only what changed — the server re-validates the category guard
        // only when `category` is present.
        const updates: Record<string, unknown> = {};
        if (description.trim() !== expense.description) updates.description = description.trim();
        if (parsed.value !== expense.amount) updates.amount = parsed.value;
        if (date && date !== initialDate) updates.date = date;
        if (category !== expense.category) updates.category = category;
        if (Object.keys(updates).length === 0) { onCancel(); return; }

        setSaving(true);
        try {
            const res = await api.put(`/expenses/${expense._id}`, updates);
            onSaved((res.data?.data as ExpenseItem) ?? { ...expense, ...updates } as ExpenseItem);
        } catch (err) {
            const fieldErrs = apiFieldErrors(err);
            if (fieldErrs.category) setCategoryError(fieldErrs.category);
            setError(apiErrorMessage(err, "Failed to update expense"));
        } finally {
            setSaving(false);
        }
    };

    const inputCls = "w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors";

    return (
        <form onSubmit={handleSave} className="p-4 rounded-2xl bg-black/30 border border-purple-500/20 space-y-3">
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
                <div className="w-full md:flex-1 space-y-1.5 min-w-0">
                    <label className="text-xs text-zinc-500">Description</label>
                    <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className={inputCls} autoFocus />
                </div>
                <div className="w-full md:w-32 space-y-1.5">
                    <label className="text-xs text-zinc-500">Amount</label>
                    <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} tabular-nums`} />
                    {parsed.ok && parsed.isExpression && (
                        <div className="text-[11px] text-zinc-500 tabular-nums">= {fmtMoney(parsed.value)}</div>
                    )}
                </div>
                <div className="w-full md:w-40 space-y-1.5">
                    <label className="text-xs text-zinc-500">Date</label>
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} tabular-nums`} />
                </div>
                <div className="w-full md:w-48 space-y-1.5">
                    <label className="text-xs text-zinc-500">Category</label>
                    <CategoryPicker
                        type="expense"
                        value={category}
                        onChange={(id) => { setCategory(id); setCategoryError(null); }}
                        error={categoryError ?? undefined}
                    />
                </div>
            </div>

            {error && !categoryError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
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
