"use client";

import { useId, useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Card, FieldError, FieldLabel, StateNote } from "@/components/dashboard/ui";
import { apiErrorMessage, apiFieldErrors } from "@/lib/apiError";

interface BudgetFormProps {
    month: number;   // 1-12
    year: number;
    monthLabel: string;
    onSuccess: () => void;
    className?: string;
}

// Create (or, for a category that already has a budget this month, update) a
// monthly limit. The category is a real user Category picked by id.
export function BudgetForm({ month, year, monthLabel, onSuccess, className }: BudgetFormProps) {
    const { currency } = useCurrency();
    const [isLoading, setIsLoading] = useState(false);
    const [category, setCategory] = useState("");
    const [limit, setLimit] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const ids = { category: useId(), limit: useId(), error: useId() };

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
        <Card title="New budget" id="new-budget" aside={<span className="label-caps text-zinc-400">{monthLabel}</span>} className={className}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <p id={ids.category} className="mb-2 text-[13px] font-medium text-zinc-300">Category</p>
                    <CategoryPicker
                        type="expense"
                        value={category}
                        onChange={(id) => { setCategory(id); setCategoryError(null); }}
                        error={categoryError ?? undefined}
                        placeholder="Select category"
                        labelledBy={ids.category}
                    />
                </div>

                <div>
                    <FieldLabel htmlFor={ids.limit}>Monthly limit ({currency})</FieldLabel>
                    <input
                        id={ids.limit}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder="e.g. 5000"
                        value={limit}
                        onChange={(e) => setLimit(e.target.value)}
                        aria-describedby={error && !categoryError ? ids.error : undefined}
                        aria-invalid={error && !categoryError ? true : undefined}
                        className="field tabular-nums"
                        required
                    />
                    {error && !categoryError && <FieldError id={ids.error}>{error}</FieldError>}
                </div>

                <button type="submit" disabled={isLoading} className="btn-primary w-full">
                    {isLoading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    Set limit
                </button>

                {notice && !error && <p role="status"><StateNote tone="good" icon={CircleCheck}>{notice}</StateNote></p>}
            </form>
        </Card>
    );
}
