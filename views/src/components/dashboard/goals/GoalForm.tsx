"use client";

import { useId, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { Card, FieldError, FieldLabel } from "../ui";
import { PRIORITY_OPTIONS } from "./goalPlanModel";

export type GoalPeriod = "monthly" | "yearly";

interface GoalFormProps {
    period: GoalPeriod;
    onSuccess: () => void;
    /** No goals in this period yet: the form says so and stands in for the empty state. */
    empty?: boolean;
    // Beside a goal card (8 of 12 columns): name and note full width, target and priority side by side.
    compact?: boolean;
    className?: string;
}

// Free-form starting points — just prefill the name (everything editable).
const SEEDS = ["Emergency Fund", "DPS", "Hajj / Umrah", "Wedding", "New phone", "Land / Flat", "Child's education"];

// A new goal: a name, a target and a priority. The deadline is the end of the
// period it is created in (the server sets it), so the form doesn't ask.
// Column spans for the wide form (a full row) and the compact one.
const SPAN = {
    wide:    { name: "lg:col-span-6", target: "lg:col-span-3", priority: "lg:col-span-3", note: "lg:col-span-9", submit: "lg:col-span-3" },
    compact: { name: "lg:col-span-12", target: "lg:col-span-6", priority: "lg:col-span-6", note: "lg:col-span-12", submit: "lg:col-span-12" },
} as const;

export function GoalForm({ period, onSuccess, empty = false, compact = false, className }: GoalFormProps) {
    const { currency } = useCurrency();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({ title: "", targetAmount: "", note: "" });
    // Goal.priority: higher = funded sooner when the allocator has to choose
    // between goals with the same deadline. 0 ("Normal") is the default.
    const [priority, setPriority] = useState<number>(0);
    const uid = useId();
    const ids = { title: `${uid}-title`, target: `${uid}-target`, targetHint: `${uid}-target-hint`, priority: `${uid}-priority`, priorityHint: `${uid}-priority-hint`, note: `${uid}-note`, error: `${uid}-error` };
    const periodWord = period === "monthly" ? "month" : "year";

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title.trim() || !formData.targetAmount) return;

        setIsLoading(true);
        setError(null);
        try {
            await api.post("/goals", {
                title: formData.title.trim(),
                targetAmount: parseFloat(formData.targetAmount),
                period,
                priority,
                note: formData.note || undefined,
            });
            setFormData({ title: "", targetAmount: "", note: "" });
            setPriority(0);
            onSuccess();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to create goal"));
        } finally {
            setIsLoading(false);
        }
    };

    const span = SPAN[compact ? "compact" : "wide"];
    const errorProps = { "aria-invalid": error ? true : undefined, "aria-describedby": error ? ids.error : undefined } as const;

    return (
        <Card title="New goal" id="new-goal" className={className} aside={<span className="label-caps text-zinc-400">{period}</span>}>
            {empty && (
                <p className="-mt-1 mb-6 text-[13.5px] text-zinc-300 max-w-prose">
                    No {period} goals yet. Name something you&apos;re saving for and what it costs.
                </p>
            )}
            <form onSubmit={handleSubmit} aria-labelledby="new-goal" className="grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-5">
                <div className={cn(span.name, "min-w-0")}>
                    <FieldLabel htmlFor={ids.title}>Goal name</FieldLabel>
                    <input
                        id={ids.title}
                        type="text"
                        placeholder="e.g. Hajj fund, down payment, new laptop"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        required
                        {...errorProps}
                        className="field"
                    />
                    {/* Name ideas: each fills the name, which stays editable. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5" role="group" aria-label="Name ideas">
                        <span className="mr-1 text-[12.5px] text-zinc-400" aria-hidden>Ideas</span>
                        {SEEDS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => setFormData((f) => ({ ...f, title: s }))}
                                className="group inline-flex items-center min-h-11 rounded-full focus-ring"
                            >
                                <span className={cn(
                                    "px-3 py-1.5 rounded-full border text-[13px] transition-colors",
                                    formData.title === s
                                        ? "border-plat/40 bg-white/[0.06] text-white"
                                        : "border-white/10 bg-white/[0.04] text-zinc-300 group-hover:text-white group-hover:bg-white/[0.08]",
                                )}>
                                    {s}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={cn(span.target, "min-w-0")}>
                    <FieldLabel htmlFor={ids.target}>Target ({currency})</FieldLabel>
                    <input
                        id={ids.target}
                        type="number"
                        min={1}
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={formData.targetAmount}
                        onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                        required
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${ids.targetHint} ${ids.error}` : ids.targetHint}
                        className="field tabular-nums"
                    />
                    <p id={ids.targetHint} className="mt-2 text-[12.5px] text-zinc-400">Due at the end of this {periodWord}.</p>
                </div>

                <fieldset className={cn(span.priority, "min-w-0")} aria-describedby={ids.priorityHint}>
                    <legend className="mb-2 text-[13px] font-medium text-zinc-300">Priority</legend>
                    <div className="inline-flex p-[3px] rounded-full bg-white/[0.07]">
                        {PRIORITY_OPTIONS.map((opt) => {
                            const chosen = priority === opt.value;
                            return (
                                <label
                                    key={opt.value}
                                    className={cn(
                                        "relative inline-flex items-center min-h-[38px] px-3.5 rounded-full text-xs font-semibold cursor-pointer transition-colors",
                                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-plat",
                                        chosen ? "bg-plat text-plat-ink" : "text-zinc-400 hover:text-zinc-200",
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name={ids.priority}
                                        value={opt.value}
                                        checked={chosen}
                                        onChange={() => setPriority(opt.value)}
                                        className="sr-only"
                                    />
                                    {opt.label}
                                </label>
                            );
                        })}
                    </div>
                    <p id={ids.priorityHint} className="mt-2 text-[12.5px] text-zinc-400">Higher-priority goals get your surplus first when deadlines tie.</p>
                </fieldset>

                <div className={cn(span.note, "min-w-0")}>
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

                <div className={cn(span.submit, "flex flex-col justify-end")}>
                    <button type="submit" disabled={isLoading} className="btn-primary w-full">
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                        Create goal
                    </button>
                </div>

                {error && <div className="lg:col-span-12 -mt-3"><FieldError id={ids.error}>{error}</FieldError></div>}
            </form>
        </Card>
    );
}
