"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { apiErrorBody, apiErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Card, FieldError, FieldLabel, Notice, Page, PageHeader, Segmented } from "../ui";

interface IncomeFormProps {
    mode: "create" | "edit";
    incomeId?: string;
    initial?: Partial<FormState>;
}

type Frequency = "weekly" | "biweekly" | "monthly" | "yearly";

interface FormState {
    amount:             string;
    category:           string;
    description:        string;
    date:               string;             // yyyy-mm-dd
    isRecurring:        boolean;
    recurringFrequency: "" | Frequency;
    isPostTax:          boolean;
    note:               string;
}

const FREQUENCIES: { key: Frequency; label: string }[] = [
    { key: "weekly",   label: "Week" },
    { key: "biweekly", label: "2 weeks" },
    { key: "monthly",  label: "Month" },
    { key: "yearly",   label: "Year" },
];

const TAX: { key: "after" | "before"; label: string }[] = [
    { key: "after",  label: "After tax" },
    { key: "before", label: "Before tax" },
];

const REPEAT = [
    { value: false, title: "Once", sub: "Recorded once, on this date." },
    { value: true,  title: "Repeats", sub: "Added again on a schedule after this date." },
] as const;

function todayIso(): string {
    return new Date().toISOString().split("T")[0];
}

// The page around the form: a way back, the heading, and the form's column,
// centred and narrow so the fields read top to bottom.
export function IncomeFormFrame({ mode, children }: { mode: "create" | "edit"; children: React.ReactNode }) {
    return (
        <Page className="max-w-[784px]">
            <div>
                <Link href="/dashboard/income" aria-label="Back to Income" className="btn-quiet -ml-3 mb-2">
                    <ArrowLeft className="w-4 h-4" aria-hidden /> Income
                </Link>
                <PageHeader
                    title={mode === "create" ? "Add income" : "Edit income"}
                    sub={mode === "create"
                        ? "Record money that came in once, or income that repeats."
                        : "Changes apply to this entry only. Entries already added from a repeating income stay as they are."}
                />
            </div>
            {children}
        </Page>
    );
}

export function IncomeForm({ mode, incomeId, initial }: IncomeFormProps) {
    const router = useRouter();
    const { currency } = useCurrency();
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
    const uid = useId();
    const ids = {
        amount: `${uid}-amount`, date: `${uid}-date`, category: `${uid}-category`, categoryLabel: `${uid}-category-label`,
        description: `${uid}-description`, repeat: `${uid}-repeat`, cadence: `${uid}-cadence`, tax: `${uid}-tax`, note: `${uid}-note`,
    };
    const err = (k: keyof FormState) => fieldErrors[k] || undefined;
    const errId = (k: keyof FormState) => `${uid}-${k}-error`;
    const described = (k: keyof FormState) => ({
        "aria-invalid": err(k) ? true : undefined,
        "aria-describedby": err(k) ? errId(k) : undefined,
    });

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
            setFieldErrors({ recurringFrequency: "Pick how often it repeats" }); return;
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
        } catch (err: unknown) {
            const errs = apiErrorBody(err)?.errors;
            if (errs) setFieldErrors(errs);
            setError(apiErrorMessage(err, mode === "create" ? "Failed to create income" : "Failed to save changes"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card>
            <form onSubmit={handleSubmit} aria-labelledby="page-title" className="space-y-6">
                {error && <div role="alert"><Notice tone="bad">{error}</Notice></div>}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                        <FieldLabel htmlFor={ids.amount}>Amount ({currency})</FieldLabel>
                        <input
                            id={ids.amount}
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={form.amount}
                            onChange={(e) => setField("amount", e.target.value)}
                            required
                            {...described("amount")}
                            className="field tabular-nums"
                        />
                        {err("amount") && <FieldError id={errId("amount")}>{err("amount")}</FieldError>}
                    </div>
                    <div>
                        <FieldLabel htmlFor={ids.date}>Date</FieldLabel>
                        <input
                            id={ids.date}
                            type="date"
                            value={form.date}
                            onChange={(e) => setField("date", e.target.value)}
                            required
                            {...described("date")}
                            className="field tabular-nums [color-scheme:dark]"
                        />
                        {err("date") && <FieldError id={errId("date")}>{err("date")}</FieldError>}
                    </div>
                </div>

                <div>
                    {/* The picker renders its own error line under the trigger. */}
                    <FieldLabel htmlFor={ids.category}><span id={ids.categoryLabel}>Category</span></FieldLabel>
                    <CategoryPicker
                        type="income"
                        id={ids.category}
                        labelledBy={ids.categoryLabel}
                        value={form.category}
                        onChange={(id) => setField("category", id)}
                        error={err("category")}
                    />
                </div>

                <div>
                    <FieldLabel htmlFor={ids.description}>Description</FieldLabel>
                    <input
                        id={ids.description}
                        type="text"
                        placeholder="e.g. October salary"
                        value={form.description}
                        onChange={(e) => setField("description", e.target.value)}
                        maxLength={500}
                        required
                        {...described("description")}
                        className="field"
                    />
                    {err("description") && <FieldError id={errId("description")}>{err("description")}</FieldError>}
                </div>

                <fieldset>
                    <legend id={ids.repeat} className="mb-2 text-[13px] font-medium text-zinc-300">How often</legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {REPEAT.map((o) => {
                            const chosen = form.isRecurring === o.value;
                            return (
                                <label
                                    key={o.title}
                                    className={cn(
                                        "relative flex items-start gap-3 min-h-11 px-4 py-3 rounded-xl border cursor-pointer transition-colors",
                                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-plat",
                                        chosen ? "border-plat/40 bg-white/[0.04]" : "border-white/10 hover:bg-white/[0.03]",
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name={ids.repeat}
                                        checked={chosen}
                                        onChange={() => {
                                            setField("isRecurring", o.value);
                                            if (!o.value) setField("recurringFrequency", "");
                                        }}
                                        className="sr-only"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-semibold text-white">{o.title}</span>
                                        <span className="mt-0.5 block text-[12.5px] text-zinc-400">{o.sub}</span>
                                    </span>
                                    <Check aria-hidden className={cn("mt-0.5 w-4 h-4 shrink-0 text-plat transition-opacity", chosen ? "opacity-100" : "opacity-0")} />
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                {form.isRecurring && (
                    <div>
                        <p id={ids.cadence} className="mb-2 text-[13px] font-medium text-zinc-300">Repeats every</p>
                        <Segmented<"" | Frequency>
                            label="Repeats every"
                            items={FREQUENCIES}
                            value={form.recurringFrequency}
                            onChange={(f) => setField("recurringFrequency", f)}
                        />
                        {err("recurringFrequency") && <FieldError id={errId("recurringFrequency")}>{err("recurringFrequency")}</FieldError>}
                    </div>
                )}

                <div>
                    <p id={ids.tax} className="mb-2 text-[13px] font-medium text-zinc-300">Tax</p>
                    <Segmented
                        label="Tax"
                        items={TAX}
                        value={form.isPostTax ? "after" : "before"}
                        onChange={(t) => setField("isPostTax", t === "after")}
                    />
                    <p className="mt-2 text-[12.5px] text-zinc-400">
                        {form.isPostTax ? "The amount you actually received, already net of tax." : "Gross pay, before tax comes off."}
                    </p>
                </div>

                <div>
                    <FieldLabel htmlFor={ids.note}>Note (optional)</FieldLabel>
                    <textarea
                        id={ids.note}
                        value={form.note}
                        onChange={(e) => setField("note", e.target.value)}
                        rows={2}
                        placeholder="Visible only to you"
                        maxLength={2000}
                        {...described("note")}
                        className="field resize-y"
                    />
                    {err("note") && <FieldError id={errId("note")}>{err("note")}</FieldError>}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                    <Link href="/dashboard/income" className="btn-quiet">Cancel</Link>
                    <button type="submit" disabled={submitting} className="btn-primary">
                        {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                        {mode === "create" ? "Add income" : "Save changes"}
                    </button>
                </div>
            </form>
        </Card>
    );
}
