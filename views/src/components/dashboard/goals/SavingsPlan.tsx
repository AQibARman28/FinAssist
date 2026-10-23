"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Compass, Sparkles, AlertTriangle, Loader2, Info } from "lucide-react";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";
import { GoalStatusBadge, TONE_TEXT } from "./GoalStatusBadge";
import { AllocationSuggestion } from "./AllocationSuggestion";
import { describeForecast, type GoalPlanRow, type PlanData } from "./goalPlanModel";

interface SavingsPlanProps {
    plan: PlanData | null;
    failed: boolean;
    /** Spendable wallet (cap for allocations), if known. */
    wallet: number | null;
    onAllocated: () => void;
}

// GOAL-1 plan view: cash-flow-aware feasibility for every active goal
// (GET /goals/plan) plus the recommend-and-confirm allocation decider.
export function SavingsPlan({ plan, failed, wallet, onAllocated }: SavingsPlanProps) {
    const { format: fmt } = useCurrency();
    const [showAllocation, setShowAllocation] = useState(false);

    if (failed) {
        return <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 text-zinc-500 text-sm">Couldn&apos;t load your savings plan.</div>;
    }
    if (!plan) {
        return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>;
    }

    const surplus = plan.cashFlow.monthlySurplus;
    const committed = plan.portfolio.totalRequired;
    const free = surplus - committed;
    const noIncome = !(plan.cashFlow.monthlyAvgIncome > 0);

    return (
        <section className="p-5 sm:p-6 rounded-3xl bg-zinc-900/50 border border-white/5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <Compass className="w-5 h-5 text-yellow-500" />
                        <h3 className="text-white font-medium">Savings plan</h3>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">Based on your average income and expenses over the last 90 days.</p>
                </div>
                {plan.goals.length > 0 && !showAllocation && (
                    <button
                        onClick={() => setShowAllocation(true)}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-medium hover:bg-yellow-500/20 transition-colors shrink-0"
                    >
                        <Sparkles className="w-4 h-4" /> Suggest allocation
                    </button>
                )}
            </div>

            {/* Surplus / committed / free */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <PlanMetric label="Monthly surplus" value={fmt(surplus)} sub="avg income − avg expenses" tone={surplus < 0 ? "text-red-400" : "text-white"} />
                <PlanMetric label="Committed to goals" value={fmt(committed)} sub="needed per month to hit every deadline" />
                <PlanMetric
                    label={free >= 0 ? "Free each month" : "Overcommitted by"}
                    value={fmt(Math.abs(free))}
                    sub={free >= 0 ? "after funding every goal" : "per month"}
                    tone={free >= 0 ? "text-emerald-400" : "text-red-400"}
                />
            </div>

            {plan.portfolio.overcommitted && plan.goals.length > 0 && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                    <span>
                        Your goals need {fmt(committed)}/mo but your surplus is {fmt(surplus)}/mo, so not every deadline is reachable.
                        Use the suggested allocation to see what to fund first and which goals will finish later.
                    </span>
                </div>
            )}
            {noIncome && (
                <div className="flex items-start gap-2 text-xs text-zinc-500">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>No income logged in the last 90 days — log income to get a realistic plan.</span>
                </div>
            )}

            {showAllocation && (
                <AllocationSuggestion wallet={wallet} onClose={() => setShowAllocation(false)} onAllocated={onAllocated} />
            )}

            {plan.goals.length === 0 ? (
                <p className="text-sm text-zinc-500 py-6 text-center">No active goals to plan yet — create one to see whether it&apos;s on track.</p>
            ) : (
                <div className="space-y-2">
                    {plan.goals.map((g) => <PlanRow key={g.goalId} row={g} />)}
                </div>
            )}
        </section>
    );
}

function PlanMetric({ label, value, sub, tone = "text-white" }: { label: string; value: string; sub: string; tone?: string }) {
    return (
        <div className="p-4 rounded-2xl bg-black/20 border border-white/5 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</div>
            <div className={cn("text-xl font-bold tabular-nums mt-1 truncate", tone)}>{value}</div>
            <div className="text-[11px] text-zinc-600 mt-0.5">{sub}</div>
        </div>
    );
}

function PlanRow({ row }: { row: GoalPlanRow }) {
    const { format: fmt } = useCurrency();
    const forecast = describeForecast(row);
    const pct = row.targetAmount > 0 ? Math.min(100, Math.round((row.currentAmount / row.targetAmount) * 100)) : 0;
    const target = row.targetDate ? new Date(row.targetDate) : null;
    const validTarget = target && !Number.isNaN(target.getTime()) ? target : null;
    const required = row.requiredMonthly;
    const actual = row.actualMonthlyRate;

    return (
        <div className="p-4 rounded-2xl bg-black/20 border border-white/5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-sm text-white font-medium truncate" title={row.title}>{row.title}</div>
                    <div className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
                        {fmt(row.currentAmount)} of {fmt(row.targetAmount)} · {pct}%
                        {validTarget ? ` · by ${format(validTarget, "MMM d, yyyy")}` : " · no deadline"}
                    </div>
                </div>
                <GoalStatusBadge status={row.status} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 mt-3 text-xs">
                <div>
                    <span className="text-zinc-500">Needs </span>
                    <span className="text-zinc-200 tabular-nums">{required === null ? "Flexible — no deadline" : `${fmt(required)}/mo`}</span>
                </div>
                <div>
                    <span className="text-zinc-500">Saving </span>
                    <span className={cn("tabular-nums", actual === null ? "text-zinc-500" : required !== null && actual < required ? "text-amber-400" : "text-zinc-200")}>
                        {actual === null ? "No history yet" : `${fmt(actual)}/mo`}
                    </span>
                    <span className="text-zinc-600"> (last 90 days)</span>
                </div>
                <div className={cn("tabular-nums", TONE_TEXT[forecast.tone])}>{forecast.text}</div>
            </div>
        </div>
    );
}
