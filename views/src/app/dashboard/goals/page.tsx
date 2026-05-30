"use client";

import { useCallback, useEffect, useState } from "react";
import { Target, PiggyBank, TrendingUp, Info, Loader2, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { GoalForm, type GoalPeriod } from "@/components/dashboard/goals/GoalForm";
import { GoalCard, type Goal } from "@/components/dashboard/goals/GoalCard";
import { SavingsBreakdown, type BalanceData } from "@/components/dashboard/SavingsBreakdown";

type View = "active" | "completed";

export default function GoalsPage() {
    const { format: fmt } = useCurrency();
    const [period, setPeriod] = useState<GoalPeriod>("monthly");
    const [view, setView] = useState<View>("active");
    const [balance, setBalance] = useState<BalanceData | null>(null);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loadingBalance, setLoadingBalance] = useState(true);
    const [loadingGoals, setLoadingGoals] = useState(true);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const handleRefresh = useCallback(() => setRefreshTrigger((p) => p + 1), []);

    // The single continuous balance + its monthly/yearly classification.
    useEffect(() => {
        let cancelled = false;
        setLoadingBalance(true);
        api.get("/analytics/balance")
            .then((res) => { if (!cancelled) setBalance(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error(err); setBalance(null); } })
            .finally(() => { if (!cancelled) setLoadingBalance(false); });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    // Goals list: active is period-scoped; completed lists every accomplished goal.
    useEffect(() => {
        let cancelled = false;
        setLoadingGoals(true);
        const params = view === "active"
            ? { status: "Active", period }
            : { status: "Completed" };
        api.get("/goals", { params })
            .then((res) => { if (!cancelled) setGoals(res.data?.data ?? []); })
            .catch((err) => { if (!cancelled) { console.error(err); setGoals([]); } })
            .finally(() => { if (!cancelled) setLoadingGoals(false); });
        return () => { cancelled = true; };
    }, [period, view, refreshTrigger]);

    const breakdown = balance ? balance[period] : null;
    const periodLabel = period === "monthly" ? "this month" : "this year";

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Goals &amp; Savings</h1>
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
            <div className="flex items-center gap-1 p-1 rounded-xl bg-zinc-900/50 border border-white/5 w-fit">
                <TabButton active={view === "active"} onClick={() => setView("active")} icon={<Target className="w-4 h-4" />}>Active</TabButton>
                <TabButton active={view === "completed"} onClick={() => setView("completed")} icon={<Trophy className="w-4 h-4" />}>Completed</TabButton>
            </div>

            {/* Create form — active view only */}
            {view === "active" && <GoalForm period={period} onSuccess={handleRefresh} />}

            {/* Goals grid */}
            {loadingGoals ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
            ) : goals.length === 0 ? (
                <EmptyState view={view} period={period} />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {goals.map((g) => <GoalCard key={g._id} goal={g} onUpdate={handleRefresh} />)}
                </div>
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
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
        >
            {icon}{children}
        </button>
    );
}

function EmptyState({ view, period }: { view: View; period: GoalPeriod }) {
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
