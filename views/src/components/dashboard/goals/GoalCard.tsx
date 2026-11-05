"use client";

import { useId, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { apiErrorMessage } from "@/lib/apiError";
import { calendarDay } from "@/lib/dates";
import { FieldError, Meter } from "../ui";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { PRIORITY_OPTIONS, priorityLevel, type GoalPlanRow } from "./goalPlanModel";

export interface Goal {
    _id: string;
    title: string;
    period: "monthly" | "yearly";
    targetAmount: number;
    currentAmount: number;
    status: "Active" | "Completed" | "Paused";
    priority?: number;
    targetDate?: string;
    createdAt?: string;
}

interface GoalCardProps {
    goal: Goal;
    onUpdate: () => void;
    /** This goal's row from GET /goals/plan (active goals only). */
    plan?: GoalPlanRow;
    /** The plan's average monthly surplus, for the verdict's wording. */
    monthlySurplus?: number;
    now: Date;
    /** Position in the grid, to stagger the meters. */
    index?: number;
}

// Where an even pace from the day the goal was set to its deadline would be
// today (0–1). Only for goals the plan covers, and only with both dates.
export function evenPace(goal: Goal, plan: GoalPlanRow | undefined, now: Date): number | undefined {
    const deadline = plan?.targetDate ?? goal.targetDate;
    if (!plan || !deadline || !goal.createdAt) return undefined;
    const start = new Date(goal.createdAt).getTime();
    const end = new Date(deadline).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
    return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

// One goal: what's saved against the target, a platinum meter with a tick at
// an even pace, the deadline, and the plan's verdict in words. Adding money and
// priority are edits in place; deleting asks first and says where the money goes.
export function GoalCard({ goal, onUpdate, plan, monthlySurplus = 0, now, index = 0 }: GoalCardProps) {
    const money = useCurrency();
    const fmt = money.format;
    const [isAdding, setIsAdding] = useState(false);
    const [addAmount, setAddAmount] = useState("");
    const [loading, setLoading] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [savingPriority, setSavingPriority] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const deleteRef = useRef<HTMLButtonElement>(null);
    const addRef = useRef<HTMLButtonElement>(null);
    const uid = useId();
    const ids = { title: `${uid}-title`, priority: `${uid}-priority`, amount: `${uid}-amount`, error: `${uid}-error`, confirm: `${uid}-confirm` };

    const fraction = goal.targetAmount > 0 ? Math.min(goal.currentAmount / goal.targetAmount, 1) : 0;
    const percentage = Math.round(fraction * 100);
    const isCompleted = goal.status === "Completed" || fraction >= 1;
    const tick = isCompleted ? undefined : evenPace(goal, plan, now);
    const deadlineRaw = plan?.targetDate ?? goal.targetDate;
    const deadline = deadlineRaw ? calendarDay(deadlineRaw) : null;
    const validDeadline = deadline && !Number.isNaN(deadline.getTime()) ? deadline : null;
    const deadlineText = validDeadline
        ? `by ${format(validDeadline, validDeadline.getFullYear() === now.getFullYear() ? "d MMM" : "d MMM yyyy")}`
        : "no deadline";

    const handleContribute = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(addAmount);
        if (!amount || amount <= 0) return;
        setLoading(true);
        setError(null);
        try {
            await api.post(`/goals/${goal._id}/contribute`, { amount, note: "Add funds" });
            setAddAmount("");
            setIsAdding(false);
            onUpdate();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to add funds"));
        } finally {
            setLoading(false);
        }
    };

    // Deleting archives the goal server-side: its saved money returns to the
    // wallet as of today; earlier months' balances are not rewritten.
    const handleDelete = async () => {
        setDeleting(true);
        setError(null);
        try {
            await api.delete(`/goals/${goal._id}`);
            onUpdate();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to delete goal"));
            setDeleting(false);
            setConfirmingDelete(false);
            deleteRef.current?.focus();
        }
    };

    const handlePriority = async (value: number) => {
        setSavingPriority(true);
        setError(null);
        try {
            await api.put(`/goals/${goal._id}`, { priority: value });
            onUpdate();
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to update priority"));
        } finally {
            setSavingPriority(false);
        }
    };

    const cancelAdding = () => {
        setIsAdding(false);
        setAddAmount("");
        requestAnimationFrame(() => addRef.current?.focus());
    };

    return (
        <section aria-labelledby={ids.title} className="min-w-0 flex flex-col p-5 md:p-7 rounded-3xl bg-graphite shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
            <div className="flex items-start justify-between gap-3 min-h-11">
                <h3 id={ids.title} className="min-w-0 pt-2.5 truncate font-semibold text-white" title={goal.title}>{goal.title}</h3>
                <button
                    ref={deleteRef}
                    type="button"
                    onClick={() => { setError(null); setConfirmingDelete(true); }}
                    disabled={deleting}
                    aria-label={`Delete goal ${goal.title}`}
                    aria-expanded={confirmingDelete}
                    aria-controls={confirmingDelete ? ids.confirm : undefined}
                    className="btn-icon -mr-2 hover:text-red-300 hover:bg-red-500/10"
                >
                    <Trash2 className="w-4 h-4" aria-hidden />
                </button>
            </div>

            {confirmingDelete && (
                <div id={ids.confirm} role="group" aria-label={`Confirm delete ${goal.title}`} className="mt-4 p-4 rounded-xl border border-white/10 bg-white/[0.03]">
                    <p className="text-[13px] text-zinc-300">
                        Delete &ldquo;{goal.title}&rdquo;?{" "}
                        {goal.currentAmount > 0
                            ? <>The <span className="text-white tabular-nums">{fmt(goal.currentAmount)}</span> saved in it goes back to your wallet as of today. </>
                            : null}
                        Past months&apos; balances stay as they were.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={handleDelete} disabled={deleting} className="btn-danger">
                            {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Trash2 className="w-4 h-4" aria-hidden />}
                            Delete goal
                        </button>
                        <button
                            type="button"
                            autoFocus
                            onClick={() => { setConfirmingDelete(false); requestAnimationFrame(() => deleteRef.current?.focus()); }}
                            disabled={deleting}
                            className="btn-quiet"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-white">
                <span className="text-[30px] leading-none font-light [font-stretch:112%] tabular-nums">{fmt(goal.currentAmount)}</span>
                <span className="text-[13.5px] text-zinc-400 tabular-nums">of {fmt(goal.targetAmount)}</span>
            </p>
            <Meter fraction={fraction} tick={tick} delay={index * 0.09} className="mt-4 mb-3" />
            <p className="text-[12.5px] text-zinc-400 tabular-nums">
                <span className="capitalize">{goal.period}</span> · {deadlineText} · {percentage}%
            </p>

            <div className="mt-4 space-y-1.5">
                <GoalStatusBadge completed={isCompleted} row={plan} monthlySurplus={monthlySurplus} fmt={money} now={now} />
                {!isCompleted && plan && plan.requiredMonthly !== null && (
                    <p className="text-[12.5px] text-zinc-400 tabular-nums">
                        {plan.actualMonthlyRate !== null
                            ? `Adding about ${fmt(Math.round(plan.actualMonthlyRate))} a month (last 90 days)`
                            : "Nothing added in the last 90 days"}
                    </p>
                )}
            </div>

            {!isCompleted && (
                <div className="mt-5 flex items-center justify-between gap-3">
                    <label htmlFor={ids.priority} className="text-[13px] font-medium text-zinc-300">Priority</label>
                    <div className="flex items-center gap-2">
                        {savingPriority && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" aria-hidden />}
                        <div className="w-32">
                            <select
                                id={ids.priority}
                                value={priorityLevel(goal.priority)}
                                disabled={savingPriority}
                                onChange={(e) => handlePriority(parseInt(e.target.value, 10))}
                                className="field cursor-pointer"
                            >
                                {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {error && <FieldError id={ids.error}>{error}</FieldError>}

            {!isCompleted && (
                <div className="mt-auto pt-5">
                    {isAdding ? (
                        <form onSubmit={handleContribute} className="flex items-center gap-2">
                            <label htmlFor={ids.amount} className="sr-only">Amount to add to {goal.title}</label>
                            <input
                                id={ids.amount}
                                autoFocus
                                type="number"
                                min={1}
                                step="any"
                                inputMode="decimal"
                                placeholder="Amount"
                                value={addAmount}
                                onChange={(e) => setAddAmount(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Escape") cancelAdding(); }}
                                aria-describedby={error ? ids.error : undefined}
                                aria-invalid={error ? true : undefined}
                                className="field tabular-nums flex-1 min-w-0"
                            />
                            <button type="submit" disabled={loading} className="btn-primary shrink-0">
                                {loading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">Adding</span></> : "Add"}
                            </button>
                            <button type="button" onClick={cancelAdding} disabled={loading} className="btn-quiet shrink-0">Cancel</button>
                        </form>
                    ) : (
                        <button
                            ref={addRef}
                            type="button"
                            onClick={() => { setError(null); setIsAdding(true); }}
                            className="btn-secondary w-full"
                        >
                            <Plus className="w-4 h-4" aria-hidden /> Add money
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
