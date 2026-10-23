"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, PiggyBank, TrendingUp, Info, Loader2, Trophy, Compass, AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { GoalForm, type GoalPeriod } from "@/components/dashboard/goals/GoalForm";
import { GoalCard, type Goal } from "@/components/dashboard/goals/GoalCard";
import { SavingsPlan } from "@/components/dashboard/goals/SavingsPlan";
import { SavingsBreakdown, type BalanceData } from "@/components/dashboard/SavingsBreakdown";
import type { GoalPlanRow, PlanData } from "@/components/dashboard/goals/goalPlanModel";

type View = "active" | "plan" | "completed";

// Data tagged with the request it answers, so "loading" is derived (the data on
// hand belongs to another view/period) instead of set synchronously in effects.
interface Tagged<T> { key: string; value: T; failed: boolean }

export default function GoalsPage() {
    const { format: fmt } = useCurrency();
    const [period, setPeriod] = useState<GoalPeriod>("monthly");
    const [view, setView] = useState<View>("active");
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [balanceState, setBalanceState] = useState<Tagged<BalanceData | null> | null>(null);
    const [goalsState, setGoalsState] = useState<Tagged<Goal[]> | null>(null);
    const [planState, setPlanState] = useState<Tagged<PlanData | null> | null>(null);

    const handleRefresh = useCallback(() => setRefreshTrigger((p) => p + 1), []);

    // The single continuous balance + its monthly/yearly classification.
    useEffect(() => {
        let cancelled = false;
        api.get("/analytics/balance")
            .then((res) => { if (!cancelled) setBalanceState({ key: "balance", value: res.data?.data ?? null, failed: false }); })
            .catch((err) => { if (!cancelled) { console.error(err); setBalanceState({ key: "balance", value: null, failed: true }); } });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    // Cash-flow-aware plan for every active goal (feasibility + forecast).
    // Re-fetched whenever goals change (create / contribute / allocate / delete).
    useEffect(() => {
        let cancelled = false;
        api.get("/goals/plan")
            .then((res) => { if (!cancelled) setPlanState({ key: "plan", value: res.data?.data ?? null, failed: false }); })
            .catch((err) => { if (!cancelled) { console.error(err); setPlanState({ key: "plan", value: null, failed: true }); } });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    // Goals list: active is period-scoped; completed lists every accomplished goal.
    const goalsKey = view === "completed" ? "completed" : `active|${period}`;
    useEffect(() => {
        if (view === "plan") return; // plan view renders from /goals/plan
        let cancelled = false;
        const key = view === "completed" ? "completed" : `active|${period}`;
        const params = view === "completed" ? { status: "Completed" } : { status: "Active", period };
        api.get("/goals", { params })
            .then((res) => { if (!cancelled) setGoalsState({ key, value: res.data?.data ?? [], failed: false }); })
            .catch((err) => { if (!cancelled) { console.error(err); setGoalsState({ key, value: [], failed: true }); } });
        return () => { cancelled = true; };
    }, [period, view, refreshTrigger]);

    const balance = balanceState?.value ?? null;
    const loadingBalance = balanceState === null;
    const loadingGoals = goalsState?.key !== goalsKey;
    const goals = goalsState && goalsState.key === goalsKey ? goalsState.value : [];
    const plan = planState?.value ?? null;
    const planById = useMemo(() => new Map<string, GoalPlanRow>((plan?.goals ?? []).map((g) => [g.goalId, g])), [plan]);

    const breakdown = balance ? balance[period] : null;
    const periodLabel = period === "monthly" ? "this month" : "this year";

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-white">Goals &amp; Savings</h1>
                    <p className="text-zinc-500 text-sm">Income − expenses is your balance, carried forward. Saving is a choice — what you put into goals.</p>
                </div>
                <PeriodToggle period={period} onChange={setPeriod} />
            </div>

            {/* Balance header */}
            {loadingBalance ? (
                <div className="h-28 animate-pulse bg-zinc-900/50 rounded-3xl" />
            ) : balance && breakdown ? (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SavingsTile icon={PiggyBank} label="Available to save" value={fmt(balance.available)} accent="gold" sub="your pocket, after expenses & savings" />
                        <SavingsTile icon={Target} label={`Saved ${periodLabel}`} value={fmt(breakdown.saved)} accent="emerald" />
                        <SavingsTile icon={TrendingUp} label={`Net income ${periodLabel}`} value={fmt(breakdown.netIncome)} accent="purple" sub={`${fmt(breakdown.income)} in − ${fmt(breakdown.expenses)} out`} />
                    </div>
                    <SavingsBreakdown breakdown={breakdown} periodLabel={periodLabel} />
                    <p className="flex items-center gap-1.5 text-xs text-zinc-600 -mt-2">
                        <Info className="w-3 h-3 shrink-0" /> Saving moves money out of your pocket into a goal — you can&apos;t save more than is available.
                    </p>
                </>
            ) : (
                <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 text-zinc-500 text-sm">Couldn&apos;t load balance.</div>
            )}

            {/* View tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-900/50 border border-white/5 w-fit max-w-full overflow-x-auto">
                <TabButton active={view === "active"} onClick={() => setView("active")} icon={<Target className="w-4 h-4" />}>Active</TabButton>
                <TabButton active={view === "plan"} onClick={() => setView("plan")} icon={<Compass className="w-4 h-4" />}>Plan</TabButton>
                <TabButton active={view === "completed"} onClick={() => setView("completed")} icon={<Trophy className="w-4 h-4" />}>Completed</TabButton>
            </div>

            {view === "plan" ? (
                <SavingsPlan
                    plan={plan}
                    failed={!!planState?.failed}
                    wallet={balance ? balance.available : null}
                    onAllocated={handleRefresh}
                />
            ) : (
                <>
                    {/* Overcommitted nudge — the full breakdown lives in the Plan tab */}
                    {view === "active" && plan?.portfolio.overcommitted && plan.goals.length > 0 && (
                        <button
                            onClick={() => setView("plan")}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-left hover:bg-amber-500/15 transition-colors"
                        >
                            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="text-xs sm:text-sm text-amber-200 flex-1">
                                Your goals need {fmt(plan.portfolio.totalRequired)}/mo but your surplus is {fmt(plan.cashFlow.monthlySurplus)}/mo. See the plan for what to fund first.
                            </span>
                            <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
                        </button>
                    )}

                    {/* Create form — active view only */}
                    {view === "active" && <GoalForm period={period} onSuccess={handleRefresh} />}

                    {/* Goals grid */}
                    {loadingGoals ? (
                        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
                    ) : goals.length === 0 ? (
                        <EmptyState view={view} period={period} />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {goals.map((g) => <GoalCard key={g._id} goal={g} onUpdate={handleRefresh} plan={planById.get(g._id)} />)}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function PeriodToggle({ period, onChange }: { period: GoalPeriod; onChange: (p: GoalPeriod) => void }) {
    return (
        <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-900/50 border border-white/5 shrink-0">
            {(["monthly", "yearly"] as const).map((p) => (
                <button
                    key={p}
                    onClick={() => onChange(p)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${period === p ? "bg-yellow-500 text-black" : "text-zinc-400 hover:text-white"}`}
                >
                    {p}
                </button>
            ))}
        </div>
    );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
        >
            {icon}{children}
        </button>
    );
}

function EmptyState({ view, period }: { view: Exclude<View, "plan">; period: GoalPeriod }) {
    const Icon = view === "completed" ? Trophy : Target;
    return (
        <div className="py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
            <Icon className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            {view === "completed" ? (
                <>
                    <p className="text-zinc-500">No completed goals yet.</p>
                    <p className="text-zinc-600 text-sm mt-1">Goals you fully fund will show up here.</p>
                </>
            ) : (
                <>
                    <p className="text-zinc-500">No active {period} goals.</p>
                    <p className="text-zinc-600 text-sm mt-1">Create one above to start saving.</p>
                </>
            )}
        </div>
    );
}

const ACCENT: Record<string, string> = {
    emerald: "from-emerald-900/15 to-black border-emerald-500/15 text-emerald-400",
    purple:  "from-purple-900/15 to-black border-purple-500/15 text-purple-400",
    gold:    "from-yellow-900/15 to-black border-yellow-500/15 text-yellow-500",
};

function SavingsTile({ icon: Icon, label, value, accent, sub }: { icon: typeof PiggyBank; label: string; value: string; accent: string; sub?: string }) {
    return (
        <div className={`p-5 rounded-3xl border bg-gradient-to-br ${ACCENT[accent]}`}>
            <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
                <Icon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-bold tabular-nums text-white mt-2">{value}</div>
            {sub && <div className="text-[11px] text-zinc-500 mt-1 tabular-nums">{sub}</div>}
        </div>
    );
}
