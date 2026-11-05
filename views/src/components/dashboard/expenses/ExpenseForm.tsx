"use client";

import { useId, useState } from "react";
import { CircleCheck, Loader2, Plus, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { apiErrorMessage, apiFieldErrors } from "@/lib/apiError";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Card, FieldError, FieldLabel, StateNote } from "@/components/dashboard/ui";
import { useCurrency } from "@/lib/useCurrency";
import { parseAmount } from "@/lib/parseAmount";

interface ExpenseFormProps {
    onAdd?: () => void;
    className?: string;
}

const AMOUNT_REASON: Record<string, string> = {
    empty:     "Enter an amount",
    invalid:   "Enter a valid amount or expression",
    negative:  "Amount must be positive",
    too_large: "Amount is too large",
};

// Every field an expense has, for when one line in the quick add isn't
// enough: a date in the past, a private note, an amount worked out as a sum.
export function ExpenseForm({ onAdd, className }: ExpenseFormProps) {
    const { format: fmtMoney } = useCurrency();
    const [isLoading, setIsLoading] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const [amountError, setAmountError] = useState<string | null>(null);
    const [added, setAdded] = useState(false);
    const [formData, setFormData] = useState({
        title: "",                                  // backend field: description
        amount: "",
        category: "" as string,                     // backend field: category (ObjectId)
        date: new Date().toISOString().split("T")[0],
        note: "",
    });
    const uid = useId();
    const ids = {
        title: `${uid}-title`, amount: `${uid}-amount`, amountNote: `${uid}-amount-note`, amountError: `${uid}-amount-error`,
        date: `${uid}-date`, category: `${uid}-cat`, categoryLabel: `${uid}-cat-label`, note: `${uid}-note`,
    };

    // Live-parsed amount — drives both the "= ৳1,700" preview and submit.
    const parsed = parseAmount(formData.amount);
    const amountHint = !parsed.ok && formData.amount.trim() !== "" && parsed.reason !== "empty" ? AMOUNT_REASON[parsed.reason] : null;
    const amountPreview = parsed.ok && parsed.isExpression ? fmtMoney(parsed.value) : null;
    const amountDescribedBy = [amountPreview || amountHint ? ids.amountNote : null, amountError ? ids.amountError : null].filter(Boolean).join(" ") || undefined;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setServerError(null);
        setCategoryError(null);
        setAmountError(null);
        setAdded(false);

        if (!formData.title) return;
        if (!parsed.ok) {
            // Non-empty invalid input already shows an inline hint under the
            // field; only the empty case needs a message surfaced here.
            if (parsed.reason === "empty") setAmountError(AMOUNT_REASON.empty);
            return;
        }
        if (!formData.category) {
            setCategoryError("Pick a category");
            return;
        }

        setIsLoading(true);
        try {
            await api.post("/expenses", {
                description: formData.title,
                amount:      parsed.value,   // evaluated value, committed on submit
                category:    formData.category,
                date:        formData.date,
                ...(formData.note ? { note: formData.note } : {}),
            });
            setFormData({ ...formData, title: "", amount: "", note: "" });
            setAdded(true);
            setTimeout(() => setAdded(false), 2200);
            onAdd?.();
        } catch (err: unknown) {
            const errs = apiFieldErrors(err);
            if (errs.category) setCategoryError(errs.category);
            setServerError(apiErrorMessage(err, "Failed to add expense"));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Card title="Add with details" id="add-with-details" className={className}>
            <form onSubmit={handleSubmit} className="space-y-4">
                {/* The form spans the page: one column on phones, two from 640px,
                    every field in one line from 1280px. */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_10rem_11rem_15rem]">
                    <div className="min-w-0 sm:col-span-2 md:col-span-1">
                        <FieldLabel htmlFor={ids.title}>What was it for?</FieldLabel>
                        <input
                            id={ids.title}
                            type="text"
                            placeholder="e.g. Starbucks, Uber"
                            value={formData.title}
                            onChange={(e) => { setFormData({ ...formData, title: e.target.value }); setAdded(false); }}
                            className="field"
                            required
                        />
                    </div>

                    <div className="min-w-0">
                        <FieldLabel htmlFor={ids.amount}>Amount</FieldLabel>
                        <input
                            id={ids.amount}
                            type="text"
                            inputMode="text"
                            placeholder="0.00 or 4*250"
                            value={formData.amount}
                            onChange={(e) => { setFormData({ ...formData, amount: e.target.value }); setAmountError(null); }}
                            aria-invalid={amountError ? true : undefined}
                            aria-describedby={amountDescribedBy}
                            className="field tabular-nums"
                            required
                        />
                        {amountPreview && <p id={ids.amountNote} className="mt-2 text-[12.5px] text-zinc-400 tabular-nums">= {amountPreview}</p>}
                        {amountHint && <p id={ids.amountNote} className="mt-2"><StateNote tone="warn" icon={TriangleAlert}>{amountHint}</StateNote></p>}
                        {amountError && <FieldError id={ids.amountError}>{amountError}</FieldError>}
                    </div>

                    <div className="min-w-0">
                        <FieldLabel htmlFor={ids.date}>Date</FieldLabel>
                        <input
                            id={ids.date}
                            type="date"
                            value={formData.date}
                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            className="field tabular-nums"
                            required
                        />
                    </div>

                    <div className="min-w-0 sm:col-span-2 md:col-span-1">
                        <label id={ids.categoryLabel} htmlFor={ids.category} className="block mb-2 text-[13px] font-medium text-zinc-300">Category</label>
                        <CategoryPicker
                            id={ids.category}
                            labelledBy={ids.categoryLabel}
                            type="expense"
                            value={formData.category}
                            onChange={(id) => { setFormData({ ...formData, category: id }); setCategoryError(null); }}
                            error={categoryError ?? undefined}
                            autoSelectDefault
                        />
                    </div>

                    <div className="col-span-full">
                        <FieldLabel htmlFor={ids.note}>Private note (optional)</FieldLabel>
                        <textarea
                            id={ids.note}
                            placeholder="Visible only to you"
                            value={formData.note}
                            onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                            rows={2}
                            className="field resize-y"
                        />
                    </div>
                </div>

                {serverError && !categoryError && <FieldError>{serverError}</FieldError>}

                <div className="pt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button type="submit" disabled={isLoading} className="btn-primary">
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                        Add expense
                    </button>
                    <p role="status">
                        {added && <StateNote tone="good" icon={CircleCheck}>Expense added</StateNote>}
                    </p>
                </div>
            </form>
        </Card>
    );
}
