"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CategoryPicker } from "@/components/CategoryPicker";

interface IncomeFormProps {
    mode: "create" | "edit";
    incomeId?: string;
    initial?: Partial<FormState>;
}

interface FormState {
    amount:             string;
    category:           string;
    description:        string;
    date:               string;             // yyyy-mm-dd
    isRecurring:        boolean;
    recurringFrequency: "" | "weekly" | "biweekly" | "monthly" | "yearly";
    isPostTax:          boolean;
    note:               string;
}

const FREQUENCIES = ["weekly", "biweekly", "monthly", "yearly"] as const;

function todayIso(): string {
    return new Date().toISOString().split("T")[0];
}

export function IncomeForm({ mode, incomeId, initial }: IncomeFormProps) {
    const router = useRouter();
    const [form, setForm] = useState<FormState>({
        amount:             initial?.amount             ?? "",
        category:           initial?.category           ?? "",
        description:        initial?.description        ?? "",
        date:               initial?.date               ?? todayIso(),
        isRecurring:        initial?.isRecurring        ?? false,
        recurringFrequency: initial?.recurringFrequency ?? "",
        isPostTax:          initial?.isPostTax          ?? true,
        note:               initial?.note               ?? "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError]           = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => {
        setForm((prev) => ({ ...prev, [k]: v }));
        setFieldErrors((e) => ({ ...e, [k]: "" }));
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null); setFieldErrors({});

        if (!form.category) { setFieldErrors({ category: "Pick a category" }); return; }
        if (form.isRecurring && !form.recurringFrequency) {
            setFieldErrors({ recurringFrequency: "Pick a cadence" }); return;
        }

        setSubmitting(true);
        try {
            const body: Record<string, unknown> = {
                amount:      parseFloat(form.amount),
                category:    form.category,
                description: form.description,
                date:        new Date(form.date).toISOString(),
                isRecurring: form.isRecurring,
                isPostTax:   form.isPostTax,
            };
            if (form.isRecurring) body.recurringFrequency = form.recurringFrequency;
            if (form.note)        body.note               = form.note;

            if (mode === "create") {
                await api.post("/incomes", body);
            } else if (incomeId) {
                // type / parentRecurringId are not part of update;
                // recurringFrequency only sent when isRecurring is true.
                await api.put(`/incomes/${incomeId}`, body);
            }
            router.push("/dashboard/income");
        } catch (err: any) {
            const errs = err.response?.data?.errors;
            if (errs) setFieldErrors(errs);
            setError(
                err.response?.data?.message
                || (errs && Object.values(errs).join(", "))
                || (mode === "create" ? "Failed to create income" : "Failed to save changes")
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-6">
            <div className="mb-2 flex items-center gap-3">
                <Link href="/dashboard/income" className="p-2 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-white">
                        {mode === "create" ? "Add income" : "Edit income"}
                    </h1>
                    <p className="text-zinc-500 text-sm">
                        {mode === "create"
                            ? "Record a one-off entry, or set up a recurring stream."
                            : "Editing this row does not affect generated instances of a recurring source."}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 space-y-5">
                {error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Amount" error={fieldErrors.amount}>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={form.amount}
                            onChange={(e) => setField("amount", e.target.value)}
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors tabular-nums"
                        />
                    </Field>

                    <Field label="Date" error={fieldErrors.date}>
                        <input
                            type="date"
                            value={form.date}
                            onChange={(e) => setField("date", e.target.value)}
                            required
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                        />
                    </Field>
                </div>

                <Field label="Category" error={fieldErrors.category}>
                    <CategoryPicker
                        type="income"
                        value={form.category}
                        onChange={(id) => setField("category", id)}
                        error={fieldErrors.category}
                    />
                </Field>

                <Field label="Description" error={fieldErrors.description}>
                    <input
                        type="text"
                        placeholder="e.g. October salary"
                        value={form.description}
                        onChange={(e) => setField("description", e.target.value)}
                        maxLength={500}
                        required
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                    />
                </Field>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Toggle
                        label="Recurring"
                        sublabel={form.isRecurring ? "Materializes on every list within range" : "One-off entry"}
                        value={form.isRecurring}
                        onChange={(v) => {
                            setField("isRecurring", v);
                            if (!v) setField("recurringFrequency", "");
                        }}
                    />
                    <Toggle
                        label="Post-tax"
                        sublabel={form.isPostTax ? "Already net of tax" : "Gross / pre-tax"}
                        value={form.isPostTax}
                        onChange={(v) => setField("isPostTax", v)}
                    />
                </div>

                {form.isRecurring && (
                    <Field label="Cadence" error={fieldErrors.recurringFrequency}>
                        <div className="grid grid-cols-4 gap-2">
                            {FREQUENCIES.map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setField("recurringFrequency", f)}
                                    className={cn(
                                        "px-3 py-2.5 rounded-xl text-sm font-medium capitalize transition-colors",
                                        form.recurringFrequency === f
                                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                                            : "bg-black/40 text-zinc-400 border border-white/10 hover:border-purple-500/20",
                                    )}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </Field>
                )}

                <Field label="Note (optional)" error={fieldErrors.note}>
                    <textarea
                        value={form.note}
                        onChange={(e) => setField("note", e.target.value)}
                        rows={2}
                        placeholder="Visible only to you"
                        maxLength={2000}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors resize-y"
                    />
                </Field>

                <div className="flex gap-3 pt-2">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-xl transition-colors"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {mode === "create" ? "Add income" : "Save changes"}
                    </button>
                    <Link
                        href="/dashboard/income"
                        className="px-6 py-3 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors"
                    >
                        Cancel
                    </Link>
                </div>
            </form>
        </div>
    );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">{label}</label>
            {children}
            {error && (
                <div className="flex items-center gap-1.5 text-red-400 text-xs">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}

function Toggle({ label, sublabel, value, onChange }: {
    label: string; sublabel?: string; value: boolean; onChange: (v: boolean) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onChange(!value)}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10 hover:border-purple-500/20 transition-colors text-left"
        >
            <div className="min-w-0">
                <div className="text-sm text-white font-medium">{label}</div>
                {sublabel && <div className="text-xs text-zinc-500 truncate">{sublabel}</div>}
            </div>
            <div className={cn(
                "w-10 h-6 rounded-full p-0.5 transition-colors shrink-0",
                value ? "bg-purple-500" : "bg-zinc-700",
            )}>
                <div className={cn(
                    "w-5 h-5 rounded-full bg-white transition-transform",
                    value ? "translate-x-4" : "translate-x-0",
                )} />
            </div>
        </button>
    );
}
