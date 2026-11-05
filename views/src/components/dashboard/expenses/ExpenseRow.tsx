"use client";

import { useEffect, useId, useRef, useState } from "react";
import { format } from "date-fns";
import { BadgeCheck, Check, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { parseAmount } from "@/lib/parseAmount";
import { calendarDay, formatDay } from "@/lib/dates";
import { CategoryPicker } from "@/components/CategoryPicker";
import { RowActions } from "@/components/dashboard/RowActions";
import { FieldError, FieldLabel } from "@/components/dashboard/ui";
import { apiErrorMessage, apiFieldErrors } from "@/lib/apiError";

export interface ExpenseItem {
    _id: string;
    description: string;
    amount: number;
    category: string; // Category ObjectId
    date: string;
    note?: string | null;
    // Set by the server when the record's signature check fails.
    integrity?: "missing" | "invalid";
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

// One expense in a list, in the Recent spending style: its day set large on
// the left, the description, a caption with the category and the signature
// state, the amount in tabular figures, and edit/delete that are always
// visible (two-step delete, touch-friendly). Edit opens an inline editor
// (PUT /expenses/:id). The parent supplies the <li> and the hairline.
export function ExpenseRow({ expense, category, onUpdated, onDeleted }: ExpenseRowProps) {
    const { formatExpense } = useCurrency();
    const [editing, setEditing] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    // After the editor closes, focus goes back to the row's Edit button
    // instead of falling to the top of the page.
    const refocus = useRef(false);
    useEffect(() => {
        if (editing || !refocus.current) return;
        refocus.current = false;
        rowRef.current?.querySelector("button")?.focus();
    }, [editing]);
    const closeEditor = () => { refocus.current = true; setEditing(false); };

    if (editing) {
        return (
            <ExpenseEditForm
                expense={expense}
                onCancel={closeEditor}
                onSaved={(updated) => { closeEditor(); onUpdated(updated); }}
            />
        );
    }

    const handleDelete = async () => {
        await api.delete(`/expenses/${expense._id}`);
        onDeleted(expense._id);
    };

    const day = calendarDay(expense.date);

    return (
        <div ref={rowRef} className="flex items-center gap-3 md:gap-4 py-3.5">
            <span aria-hidden className="w-10 md:w-12 shrink-0 grid justify-items-center leading-none text-zinc-400">
                <b className="text-[23px] font-light [font-stretch:112%] text-white tabular-nums">{day.getDate()}</b>
                <span className="mt-1.5 text-[10.5px] font-medium tracking-[0.14em] [font-stretch:118%] uppercase">{format(day, "EEE")}</span>
            </span>

            {/* A basis of 8rem keeps the description readable when the delete
                confirm needs the space on the right. */}
            <span className="flex-[1_1_8rem] min-w-0">
                <span className="block truncate font-semibold text-white" title={expense.description}>{expense.description}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-zinc-400 min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                        {category?.color && <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: category.color }} />}
                        <span className="truncate">{category?.name ?? "Uncategorized"} · {formatDay(expense.date)}</span>
                    </span>
                    {expense.integrity
                        ? <span className="inline-flex items-center gap-1 shrink-0 text-amber-200"><ShieldAlert className="w-3.5 h-3.5 text-amber-300" aria-hidden />Failed check</span>
                        : <span className="inline-flex items-center gap-1 shrink-0"><BadgeCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden />Signed</span>}
                </span>
            </span>

            {/* Phones stack the amount over the controls; wider screens set them in a line. */}
            <span className="flex-[0_1_auto] min-w-0 flex flex-col items-end gap-0.5 md:flex-row md:items-center md:gap-2">
                <span className="shrink-0 font-medium text-white tabular-nums">{formatExpense(expense.amount)}</span>
                <RowActions
                    className="-mr-3.5"
                    itemLabel={expense.description}
                    onEdit={() => setEditing(true)}
                    onDelete={handleDelete}
                    confirmText="Delete expense?"
                />
            </span>
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

// The calendar day the row shows (lib/dates.ts › calendarDay), so the editor
// opens on the same date the list displays.
function toDateInput(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : format(calendarDay(d), "yyyy-MM-dd");
}

type EditError = { msg: string; field?: "description" | "amount" };

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
    const [error, setError] = useState<EditError | null>(null);
    const [categoryError, setCategoryError] = useState<string | null>(null);
    const uid = useId();
    const ids = {
        title: `${uid}-title`, description: `${uid}-desc`, amount: `${uid}-amount`, amountNote: `${uid}-amount-note`,
        date: `${uid}-date`, category: `${uid}-cat`, categoryLabel: `${uid}-cat-label`, error: `${uid}-error`,
    };

    const parsed = parseAmount(amount);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setCategoryError(null);
        if (!description.trim()) { setError({ msg: "Description can't be empty", field: "description" }); return; }
        if (!parsed.ok) { setError({ msg: AMOUNT_REASON[parsed.reason], field: "amount" }); return; }
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
            setError({ msg: apiErrorMessage(err, "Failed to update expense") });
        } finally {
            setSaving(false);
        }
    };

    const fieldError = (field: EditError["field"]) => (error && error.field === field ? error.msg : null);
    const descError = fieldError("description");
    const amountError = fieldError("amount");
    const formError = error && !error.field && !categoryError ? error.msg : null;
    const amountDescribedBy = [parsed.ok && parsed.isExpression ? ids.amountNote : null, amountError ? ids.error : null].filter(Boolean).join(" ") || undefined;

    return (
        <form onSubmit={handleSave} aria-labelledby={ids.title} className="my-2 p-4 md:p-5 rounded-2xl bg-white/[0.03] border border-white/10">
            <p id={ids.title} className="label-caps text-zinc-300">Edit expense</p>
            {/* Both lists span the page: one column on phones, two from 640px,
                every field in one line from 1280px. */}
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_9rem_11rem_14rem]">
                <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                    <FieldLabel htmlFor={ids.description}>Description</FieldLabel>
                    <input
                        id={ids.description} type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                        maxLength={500} autoFocus className="field"
                        aria-invalid={descError ? true : undefined} aria-describedby={descError ? ids.error : undefined}
                    />
                    {descError && <FieldError id={ids.error}>{descError}</FieldError>}
                </div>
                <div className="min-w-0">
                    <FieldLabel htmlFor={ids.amount}>Amount</FieldLabel>
                    <input
                        id={ids.amount} type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
                        className="field tabular-nums"
                        aria-invalid={amountError ? true : undefined} aria-describedby={amountDescribedBy}
                    />
                    {parsed.ok && parsed.isExpression && (
                        <p id={ids.amountNote} className="mt-2 text-[12.5px] text-zinc-400 tabular-nums">= {fmtMoney(parsed.value)}</p>
                    )}
                    {amountError && <FieldError id={ids.error}>{amountError}</FieldError>}
                </div>
                <div className="min-w-0">
                    <FieldLabel htmlFor={ids.date}>Date</FieldLabel>
                    <input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field tabular-nums" />
                </div>
                <div className="min-w-0 sm:col-span-2 xl:col-span-1">
                    <label id={ids.categoryLabel} htmlFor={ids.category} className="block mb-2 text-[13px] font-medium text-zinc-300">Category</label>
                    <CategoryPicker
                        id={ids.category}
                        labelledBy={ids.categoryLabel}
                        type="expense"
                        value={category}
                        onChange={(id) => { setCategory(id); setCategoryError(null); }}
                        error={categoryError ?? undefined}
                    />
                </div>
            </div>

            {formError && <FieldError>{formError}</FieldError>}

            <div className="mt-4 flex items-center justify-end gap-2">
                <button type="button" onClick={onCancel} disabled={saving} className="btn-quiet">
                    Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />}
                    Save
                </button>
            </div>
        </form>
    );
}
