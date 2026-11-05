"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import { CircleAlert, CircleCheck, CircleDashed, Info, Scale, TriangleAlert } from "lucide-react";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay } from "@/lib/dates";
import type { MoneyFormatter } from "@/lib/money";
import { Card, Meter, Notice, Skeleton, StateNote, Term } from "../ui";
import { LoadError } from "../LoadNotice";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { AllocationSuggestion } from "./AllocationSuggestion";
import { describeForecast, type GoalPlanRow, type PlanData, type Tone } from "./goalPlanModel";

interface SavingsPlanProps {
    plan: PlanData | null;
    failed: boolean;
    /** Spendable wallet (cap for allocations), if known. */
    wallet: number | null;
    onAllocated: () => void;
    onRetry?: () => void;
}

const FORECAST_ICON: Record<Tone, typeof CircleCheck> = {
    good: CircleCheck, warn: TriangleAlert, bad: CircleAlert, neutral: CircleDashed,
};

// GOAL-1 plan view: cash-flow-aware feasibility for every active goal
// (GET /goals/plan) plus the recommend-and-confirm allocation decider. Three
// cards in one column: the month's cash flow and what the goals claim of it,
// the suggested split when asked for, then each goal against its deadline.
export function SavingsPlan({ plan, failed, wallet, onAllocated, onRetry }: SavingsPlanProps) {
    const money = useCurrency();
    const fmt = money.format;
    const [now] = useState(() => new Date());
    const [showAllocation, setShowAllocation] = useState(false);
    const suggestRef = useRef<HTMLButtonElement>(null);

    if (failed) {
        return (
            <Card title="Savings plan" id="savings-plan">
                {onRetry
                    ? <LoadError what="your savings plan" onRetry={onRetry} />
                    : <p className="text-sm text-zinc-300">Couldn&apos;t load your savings plan.</p>}
            </Card>
        );
    }
    if (!plan) {
        return (
            <div aria-hidden className="flex flex-col gap-4 md:gap-6">
                <Skeleton className="h-[300px] rounded-3xl" />
                <Skeleton className="h-[360px] rounded-3xl" />
            </div>
        );
    }

    // Averages over 90 days, so shown in whole amounts like every other figure.
    const surplus = Math.round(plan.cashFlow.monthlySurplus);
    const committed = Math.round(plan.portfolio.totalRequired);
    const free = surplus - committed;
    const noIncome = !(plan.cashFlow.monthlyAvgIncome > 0);
    const claim = surplus > 0 ? committed / surplus : null;
    const caption = "block mt-2 text-[12.5px] leading-normal font-normal [font-stretch:100%] text-zinc-400";
    const closeAllocation = () => {
        setShowAllocation(false);
        requestAnimationFrame(() => suggestRef.current?.focus());
    };

    return (
        <div className="flex flex-col gap-4 md:gap-6">
            <Card
                title="Savings plan"
                id="savings-plan"
                aside={plan.goals.length > 0 ? (
                    <button
                        ref={suggestRef}
                        type="button"
                        onClick={() => setShowAllocation((v) => !v)}
                        aria-expanded={showAllocation}
                        aria-controls={showAllocation ? "suggested-split-panel" : undefined}
                        className="btn-secondary"
                    >
                        <Scale className="w-4 h-4" aria-hidden /> {showAllocation ? "Hide the split" : "Suggest a split"}
                    </button>
                ) : undefined}
            >
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-6">
                    <Term label="Monthly surplus">
                        {fmt(surplus)}<span className={caption}>Average income minus average spending</span>
                    </Term>
                    <Term label="Committed to goals">
                        {fmt(committed)}<span className={caption}>Needed each month to meet every deadline</span>
                    </Term>
                    <Term label={free >= 0 ? "Free each month" : "Overcommitted by"}>
                        {fmt(Math.abs(free))}<span className={caption}>{free >= 0 ? "After funding every goal" : "Each month, beyond your surplus"}</span>
                    </Term>
                </dl>

                {claim !== null && plan.goals.length > 0 && (
                    <div className="mt-7">
                        <div className="flex items-baseline justify-between gap-3 text-[13.5px] text-zinc-300">
                            <span>What your goals need of your surplus</span>
                            <span className="text-white tabular-nums">{Math.round(claim * 100)}%</span>
                        </div>
                        <Meter fraction={claim} tone={claim > 1 ? "warn" : "plat"} className="mt-2.5" />
                    </div>
                )}
                {surplus < 0 && (
                    <StateNote tone="bad" icon={CircleAlert} className="mt-5 tabular-nums">
                        Spending has been {fmt(Math.abs(surplus))} a month above income.
                    </StateNote>
                )}

                {plan.portfolio.overcommitted && plan.goals.length > 0 && (
                    <Notice tone="warn" className="mt-6">
                        Your goals need <span className="tabular-nums">{fmt(committed)}</span> a month but your surplus is{" "}
                        <span className="tabular-nums">{fmt(surplus)}</span>, so not every deadline is reachable. The suggested
                        split shows what to fund first and which goals will finish later.
                    </Notice>
                )}
                {noIncome && (
                    <Notice tone="neutral" icon={Info} className="mt-4">
                        No income logged in the last 90 days. Log income to get a realistic plan.
                    </Notice>
                )}

                <p className="mt-6 text-[12.5px] text-zinc-400">Based on your average income and spending over the last 90 days.</p>
            </Card>

            {showAllocation && (
                <div id="suggested-split-panel" className="min-w-0">
                    <AllocationSuggestion wallet={wallet} onClose={closeAllocation} onAllocated={onAllocated} id="suggested-split" />
                </div>
            )}

            <Card
                title="Goals in the plan"
                id="plan-goals"
                aside={plan.goals.length > 0 ? <span className="label-caps text-zinc-400">{plan.goals.length} active</span> : undefined}
            >
                {plan.goals.length === 0 ? (
                    <p className="py-6 text-sm text-zinc-400 text-center">No active goals to plan yet. Create one to see whether it&apos;s on track.</p>
                ) : (
                    <ul>
                        {plan.goals.map((g, i) => (
                            <PlanRow key={g.goalId} row={g} index={i} monthlySurplus={surplus} now={now} fmt={money} />
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    );
}

// One goal against its deadline: progress on the left with the verdict, what
// it needs, what's going in and when it finishes on the right.
function PlanRow({ row, index, monthlySurplus, now, fmt }: {
    row: GoalPlanRow;
    index: number;
    monthlySurplus: number;
    now: Date;
    fmt: MoneyFormatter;
}) {
    const forecast = describeForecast(row);
    // Finishing late is a warning, the same tone as the goal's verdict beside it.
    const forecastTone = forecast.tone === "bad" ? "warn" : forecast.tone;
    const fraction = row.targetAmount > 0 ? Math.min(1, row.currentAmount / row.targetAmount) : 0;
    const target = row.targetDate ? calendarDay(row.targetDate) : null;
    const validTarget = target && !Number.isNaN(target.getTime()) ? target : null;
    const required = row.requiredMonthly === null ? null : Math.round(row.requiredMonthly);
    const actual = row.actualMonthlyRate === null ? null : Math.round(row.actualMonthlyRate);

    return (
        <li className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-4 py-6 border-t border-white/[0.07] first:border-t-0 first:pt-0 last:pb-0">
            <div className="lg:col-span-7 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold text-white" title={row.title}>{row.title}</span>
                    <span className="shrink-0 text-[13px] text-zinc-400 tabular-nums">{fmt.format(row.currentAmount)} of {fmt.format(row.targetAmount)}</span>
                </div>
                <Meter fraction={fraction} delay={index * 0.09} className="mt-3 mb-2.5" />
                <p className="text-[12.5px] text-zinc-400 tabular-nums">
                    {Math.round(fraction * 100)}% · {validTarget ? `by ${format(validTarget, "d MMM yyyy")}` : "no deadline"}
                </p>
                <GoalStatusBadge row={row} monthlySurplus={monthlySurplus} fmt={fmt} now={now} className="mt-3" />
            </div>
            <dl className="lg:col-span-5 self-center space-y-2.5 text-[13.5px]">
                <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-400">Needs</dt>
                    <dd className="text-right text-white tabular-nums">{required === null ? "Flexible, no deadline" : `${fmt.format(required)} a month`}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-400">Going in (last 90 days)</dt>
                    <dd className="text-right text-white tabular-nums">{actual === null ? "No history yet" : `${fmt.format(actual)} a month`}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-zinc-400">Finishes</dt>
                    <dd className="text-right">
                        <StateNote tone={forecastTone} icon={FORECAST_ICON[forecastTone]} className="tabular-nums">{forecast.text}</StateNote>
                    </dd>
                </div>
            </dl>
        </li>
    );
}
