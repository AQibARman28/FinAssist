"use client";

import { useState } from "react";
import { Loader2, Save, AlertCircle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { CategoryPicker } from "@/components/CategoryPicker";
import { apiErrorMessage, apiFieldErrors } from "@/lib/apiError";

interface BudgetFormProps {
    month: number;   // 1-12
    year: number;
    monthLabel: string;
    onSuccess: () => void;
}

// Create (or, for a category that already has a budget this month, update) a
// monthly limit. The category is a real user Category picked by id.
export function BudgetForm({ month, year, monthLabel, onSuccess }: BudgetFormProps) {
    const { currency } = useCurrency();
    const [isLoading, setIsLoading] = useState(false);
    const [category, setCategory] = useState("");
    const [limit, setLimit] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setCategoryError(null);
        setNotice(null);

        if (!category) { setCategoryError("Pick a category"); return; }
        const value = parseFloat(limit);
        if (!Number.isFinite(value) || value < 0) { setError("Enter a limit of 0 or more"); return; }

        setIsLoading(true);
        try {
            const res = await api.post("/budgets", { category, limit: value, month, year });
            // 200 = the category already had a budget for this month; it was updated.
            setNotice(res.status === 200
                ? `Updated the existing ${monthLabel} budget for this category.`
                : `Budget set for ${monthLabel}.`);
            setCategory("");
            setLimit("");
            onSuccess();
        } catch (err) {
            const fieldErrs = apiFieldErrors(err);
            if (fieldErrs.category) setCategoryError(fieldErrs.category);
            setError(apiErrorMessage(err, "Failed to set budget"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-medium">Set Monthly Budget</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">{monthLabel}</span>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 md:items-end">
                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">Category</label>
                    <CategoryPicker
                        type="expense"
                        value={category}
                        onChange={(id) => { setCategory(id); setCategoryError(null); }}
                        error={categoryError ?? undefined}
                        placeholder="Select category"
                    />
                </div>

                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">Monthly Limit ({currency})</label>
                    <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder="e.g. 500"
                        value={limit}
                        onChange={(e) => setLimit(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors tabular-nums"
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full md:w-auto px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-900/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>Set Limit</span>
                </button>
            </form>

            {error && !categoryError && (
                <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {notice && !error && (
                <div className="mt-4 flex items-center gap-2 text-xs text-zinc-400">
                    <Info className="w-3.5 h-3.5 shrink-0 text-purple-400" />
                    <span>{notice}</span>
                </div>
            )}
        </div>
    );
}
