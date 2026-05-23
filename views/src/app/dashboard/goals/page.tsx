"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Target, TrendingUp, PiggyBank, Wallet, Info, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { GoalForm } from "@/components/dashboard/goals/GoalForm";
import { GoalCard, type PlanGoal } from "@/components/dashboard/goals/GoalCard";
import { DeploySurplus } from "@/components/dashboard/goals/DeploySurplus";

interface PlanResponse {
    cashFlow: { monthlySurplus: number; monthlyAvgIncome: number; monthlyAvgExpenses: number };
    goals: PlanGoal[];
    portfolio: { totalRequired: number; availableSurplus: number; overcommitted: boolean };
}

export default function GoalsPage() {
    const { format: fmt } = useCurrency();
    const [plan, setPlan] = useState<PlanResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get("/goals/plan")
            .then((res) => { if (!cancelled) setPlan(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error(err); setPlan(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    const handleRefresh = () => setRefreshTrigger((p) => p + 1);

    const cash = plan?.cashFlow;
    const goals = plan?.goals ?? [];
    const hasIncome = (cash?.monthlyAvgIncome ?? 0) > 0;
    const committed = plan?.portfolio.totalRequired ?? 0;
    const surplus = cash?.monthlySurplus ?? 0;
    const free = Math.max(surplus - committed, 0);

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="mb-2">
                <h1 className="text-2xl font-bold text-white">Savings Plan</h1>
                <p className="text-zinc-500 text-sm">Grounded in your real cash flow — feasibility, forecast, and where to put your surplus.</p>
            </div>

            {/* Surplus header / building state */}
            {loading ? (
                <div className="h-28 animate-pulse bg-zinc-900/50 rounded-3xl" />
            ) : !hasIncome ? (
                <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-white font-medium">Log income to see your savings plan</h3>
                        <p className="text-zinc-500 text-sm mt-1">Your monthly surplus drives feasibility and the allocation suggestions.</p>
                    </div>
                    <Link href="/dashboard/income" className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-sm font-medium hover:bg-emerald-600/30 transition-colors shrink-0">
                        <TrendingUp className="w-4 h-4" /> Log income
                    </Link>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SurplusTile icon={Wallet}   label="Monthly surplus" value={fmt(surplus)} accent="emerald" />
                        <SurplusTile icon={Target}   label="Committed to goals" value={fmt(committed)} accent="purple" />
                        <SurplusTile icon={PiggyBank} label="Free to deploy" value={fmt(free)} accent="gold" />
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-zinc-600 -mt-2">
                        <Info className="w-3 h-3 shrink-0" /> These are tracked plans, not bank transfers — FinAssist never moves your money.
                    </p>
                    <DeploySurplus refreshTrigger={refreshTrigger} onConfirmed={handleRefresh} />
                </>
            )}

            {/* Create */}
            <GoalForm onSuccess={handleRefresh} />

            {/* Goals grid */}
            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
            ) : goals.length === 0 ? (
                <div className="py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                    <Target className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <p className="text-zinc-500">No active goals.</p>
                    <p className="text-zinc-600 text-sm mt-1">Create one above to start your plan.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {goals.map((g) => <GoalCard key={g.goalId} goal={g} onUpdate={handleRefresh} />)}
                </div>
            )}
        </div>
    );
}

const ACCENT: Record<string, string> = {
    emerald: "from-emerald-900/15 to-black border-emerald-500/15 text-emerald-400",
    purple:  "from-purple-900/15 to-black border-purple-500/15 text-purple-400",
    gold:    "from-yellow-900/15 to-black border-yellow-500/15 text-yellow-500",
};

function SurplusTile({ icon: Icon, label, value, accent }: { icon: typeof Wallet; label: string; value: string; accent: string }) {
    return (
        <div className={`p-5 rounded-3xl border bg-gradient-to-br ${ACCENT[accent]}`}>
            <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
                <Icon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-bold tabular-nums text-white mt-2">{value}</div>
        </div>
    );
}
