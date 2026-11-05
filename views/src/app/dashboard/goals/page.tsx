"use client";

import { useMemo, useState } from "react";
import { Compass, Target, Trophy } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { summarizeLoadState } from "@/lib/loadState";
import { cn } from "@/lib/utils";
import { GoalForm, type GoalPeriod } from "@/components/dashboard/goals/GoalForm";
import { GoalCard, evenPace, type Goal } from "@/components/dashboard/goals/GoalCard";
import { SavingsPlan } from "@/components/dashboard/goals/SavingsPlan";
import { SavingsBreakdown, type BalanceData } from "@/components/dashboard/SavingsBreakdown";
import { LoadError, LoadNotice } from "@/components/dashboard/LoadNotice";
import { Card, Empty, HeroFigure, Missing, Notice, Page, PageHeader, Segmented, Skeleton, Term } from "@/components/dashboard/ui";
import type { GoalPlanRow, PlanData } from "@/components/dashboard/goals/goalPlanModel";

type View = "active" | "plan" | "completed";

const PERIODS: { key: GoalPeriod; label: string }[] = [
    { key: "monthly", label: "Monthly" },
    { key: "yearly", label: "Yearly" },
];

const VIEWS: { key: View; label: string; icon: typeof Target }[] = [
    { key: "active", label: "Active", icon: Target },
    { key: "plan", label: "Plan", icon: Compass },
    { key: "completed", label: "Completed", icon: Trophy },
];

// Goals (DESIGN.md › Timeline): what's free to save as the headline, the
// period's balance beside it, then the goals themselves, the plan, or what's
// been reached.
export default function GoalsPage() {
    const money = useCurrency();
    const fmt = money.format;
    const [now] = useState(() => new Date());
    const [period, setPeriod] = useState<GoalPeriod>("monthly");
    const [view, setView] = useState<View>("active");
    // Cached reads (lib/useApi.ts). Creating, contributing to, allocating or
    // deleting a goal is a write, which refreshes all three by itself.
    // The single continuous balance + its monthly/yearly classification.
    const balanceQ = useApi<BalanceData>("/analytics/balance");
    // Cash-flow-aware plan for every active goal (feasibility + forecast).
    const planQ = useApi<PlanData>("/goals/plan");
    // Goals list: active is period-scoped; completed lists every accomplished
    // goal; the plan view renders from /goals/plan instead.
    const goalsQ = useApi<Goal[]>(
        view === "plan" ? null : "/goals",
        view === "completed" ? { status: "Completed" } : { status: "Active", period },
    );
    // Children call this after a change; it joins the refetch the write
    // already started rather than sending a second request.
    const handleRefresh = () => { void balanceQ.refresh(); void planQ.refresh(); void goalsQ.refresh(); };

    const balance = balanceQ.data ?? null;
    const goalRows = goalsQ.data;
    const goals = useMemo(() => goalRows ?? [], [goalRows]);
    const plan = planQ.data ?? null;
    const planById = useMemo(() => new Map<string, GoalPlanRow>((plan?.goals ?? []).map((g) => [g.goalId, g])), [plan]);
    const monthlySurplus = plan?.cashFlow.monthlySurplus ?? 0;
    const lastRow = goals.length % 3;

    const breakdown = balance ? balance[period] : null;
    const periodLabel = period === "monthly" ? "this month" : "this year";
    const failedBalance = balanceQ.error !== undefined;

    const reads = view === "plan" ? [balanceQ, planQ] : [balanceQ, planQ, goalsQ];
    const loadState = summarizeLoadState(reads);
    const retry = () => { for (const r of reads) if (r.error !== undefined || r.refreshFailed) void r.refresh(); };

    const figure = (v: number | undefined) =>
        balanceQ.isLoading ? <span aria-hidden className="inline-block h-[0.9em] w-28 rounded-md bg-white/[0.05] animate-pulse align-middle" />
            : failedBalance || v === undefined ? <Missing /> : fmt(v);
    const termCaption = "block mt-2 text-[12.5px] leading-normal font-normal [font-stretch:100%] text-zinc-400 tabular-nums";
    const anyTick = view === "active" && goals.some((g) => evenPace(g, planById.get(g._id), now) !== undefined);
    // Loaded, and nothing in this period.
    const noGoals = !goalsQ.isLoading && goalsQ.error === undefined && goals.length === 0;

    return (
        <Page>
            <PageHeader title="Goals" sub="Income minus spending is your balance, and it carries forward. Saving is the part you choose to put into goals.">
                <Segmented label="Period" items={PERIODS} value={period} onChange={setPeriod} />
            </PageHeader>

            <div className="empty:hidden"><LoadNotice state={loadState} onRetry={retry} /></div>

            {/* The answer, then how it adds up: same order on phones, side by side from 1024px. */}
            <div className="grid grid-cols-1 lg:grid-cols-12 items-center gap-8 lg:gap-14 py-2 md:py-4">
                <div className="lg:col-span-7 min-w-0">
                    <HeroFigure
                        label="Available to save"
                        value={balance ? fmt(balance.available) : null}
                        loading={balanceQ.isLoading}
                        failed={failedBalance}
                    >
                        What&apos;s in your wallet after spending and savings. Saving moves money from it into a goal, so you can&apos;t save more than this.
                    </HeroFigure>
                    <dl className="mt-8 grid grid-cols-2 gap-6 max-w-lg">
                        <Term label={`Saved ${periodLabel}`}>{figure(breakdown?.saved)}</Term>
                        <Term label={`Net income ${periodLabel}`}>
                            {figure(breakdown?.netIncome)}
                            {breakdown && <span className={termCaption}>{fmt(breakdown.income)} in, {fmt(breakdown.expenses)} out</span>}
                        </Term>
                    </dl>
                </div>
                <SavingsBreakdown
                    className="lg:col-span-5"
                    breakdown={breakdown}
                    periodLabel={periodLabel}
                    loading={balanceQ.isLoading}
                    failed={failedBalance}
                    onRetry={() => void balanceQ.refresh()}
                />
            </div>

            <Segmented label="Goals to show" items={VIEWS} value={view} onChange={setView} className="self-start" />

            {view === "plan" ? (
                <SavingsPlan
                    plan={plan}
                    failed={planQ.error !== undefined}
                    wallet={balance ? balance.available : null}
                    onAllocated={handleRefresh}
                    onRetry={() => void planQ.refresh()}
                />
            ) : (
                <>
                    {/* Overcommitted nudge — the full breakdown lives in the Plan view */}
                    {view === "active" && plan?.portfolio.overcommitted && plan.goals.length > 0 && (
                        <Notice
                            tone="warn"
                            action={<button type="button" onClick={() => setView("plan")} className="btn-secondary shrink-0">See the plan</button>}
                        >
                            Your goals need <span className="tabular-nums">{fmt(Math.round(plan.portfolio.totalRequired))}</span> a month, but you have about{" "}
                            <span className="tabular-nums">{fmt(Math.round(plan.cashFlow.monthlySurplus))}</span> left over each month. The plan shows what to fund first.
                        </Notice>
                    )}

                    {/* With no active goals yet, the New goal card is the empty state. */}
                    {view === "active" && noGoals ? (
                        <GoalForm period={period} onSuccess={handleRefresh} empty />
                    ) : (
                        <section aria-labelledby="goal-list-title" className="flex flex-col gap-3">
                            <h2 id="goal-list-title" className="sr-only">{view === "completed" ? "Completed goals" : `Active ${period} goals`}</h2>
                            {goalsQ.isLoading ? (
                                <div aria-hidden className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] rounded-3xl" />)}
                                </div>
                            ) : goalsQ.error !== undefined ? (
                                <Card><LoadError what="your goals" onRetry={() => void goalsQ.refresh()} /></Card>
                            ) : goals.length > 0 ? (
                                // Rows end level: three cards a row; a last row of
                                // two splits 6 + 6; a lone last card shares its row
                                // with the New goal card (4 + 8).
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-6">
                                    {goals.map((g, i) => (
                                        <div key={g._id} className={cn("grid min-w-0", lastRow === 2 && i >= goals.length - 2 ? "lg:col-span-6" : "lg:col-span-4")}>
                                            <GoalCard
                                                goal={g}
                                                onUpdate={handleRefresh}
                                                plan={planById.get(g._id)}
                                                monthlySurplus={monthlySurplus}
                                                now={now}
                                                index={i}
                                            />
                                        </div>
                                    ))}
                                    {view === "active" && (
                                        <GoalForm
                                            period={period}
                                            onSuccess={handleRefresh}
                                            compact={lastRow === 1}
                                            className={lastRow === 1 ? "md:col-span-2 lg:col-span-8" : "md:col-span-2 lg:col-span-12"}
                                        />
                                    )}
                                </div>
                            ) : (
                                <Card>
                                    <Empty icon={Trophy} title="No completed goals yet">Goals you fully fund show up here.</Empty>
                                </Card>
                            )}
                            {anyTick && (
                                <p className="text-[12.5px] text-zinc-400 max-w-prose">
                                    The tick on each bar marks where you&apos;d be today saving evenly from the day you set the goal to its deadline.
                                </p>
                            )}
                        </section>
                    )}
                </>
            )}
        </Page>
    );
}
