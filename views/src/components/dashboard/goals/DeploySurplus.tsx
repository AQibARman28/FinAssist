"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Check, Loader2, AlertTriangle, Info } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";

interface SuggestionGoal {
    goalId: string;
    title: string;
    goalType: string;
    targetAmount: number;
    currentAmount: number;
    targetDate: string;
    suggested: number;
}
interface Tradeoff { goalId: string; shortfall: number; extendMonths: number | null; }
interface Suggestion {
    cashFlow: { monthlySurplus: number };
    emergencyBaseline: number;
    freeSurplus: number;
    overcommitted: boolean;
    tradeoffs: Tradeoff[];
    goals: SuggestionGoal[];
}

export function DeploySurplus({ refreshTrigger, onConfirmed }: { refreshTrigger: number; onConfirmed: () => void }) {
    const { format: fmt } = useCurrency();
    const [data, setData]         = useState<Suggestion | null>(null);
    const [loading, setLoading]   = useState(true);
    const [amounts, setAmounts]   = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const [done, setDone]         = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setDone(null);
        api.get("/goals/allocation-suggestion")
            .then((res) => {
                if (cancelled) return;
                const d: Suggestion = res.data?.data;
                setData(d);
                const seed: Record<string, string> = {};
                for (const g of d?.goals ?? []) seed[g.goalId] = String(g.suggested ?? 0);
                setAmounts(seed);
            })
            .catch((err) => { if (!cancelled) { console.error("allocation suggestion failed", err); setData(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    const available = data?.cashFlow.monthlySurplus ?? 0;
    const total = useMemo(
        () => Object.values(amounts).reduce((s, v) => s + (parseFloat(v) || 0), 0),
        [amounts],
    );
    const remaining = available - total;
    const titleById = useMemo(() => new Map((data?.goals ?? []).map((g) => [g.goalId, g.title])), [data]);

    const handleConfirm = async () => {
        const allocations = Object.entries(amounts)
            .map(([goalId, v]) => ({ goalId, amount: parseFloat(v) || 0 }))
            .filter((a) => a.amount > 0);
        if (allocations.length === 0) { setError("Enter an amount for at least one goal."); return; }
        setSubmitting(true);
        setError(null);
        try {
            const res = await api.post("/goals/allocate", { allocations, note: "Surplus allocation" });
            setDone(res.data?.warning || "Allocation recorded as planned contributions.");
            onConfirmed();
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to record allocation");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="h-40 animate-pulse bg-zinc-900/50 rounded-3xl" />;
    if (!data || data.goals.length === 0) return null;

    if (available <= 0) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                <Header />
                <p className="text-sm text-zinc-500 mt-2">No monthly surplus to deploy right now. Increase income or trim expenses to free up cash for your goals.</p>
            </div>
        );
    }

    return (
        <div className="p-6 rounded-3xl bg-gradient-to-br from-yellow-900/10 to-zinc-900/50 border border-yellow-500/15">
            <Header />

            <div className="space-y-2 mt-4">
                {data.goals.map((g) => (
                    <div key={g.goalId} className="flex items-center gap-3 p-3 rounded-xl bg-black/20">
                        <div className="min-w-0 flex-1">
                            <div className="text-sm text-white truncate">{g.title}</div>
                            <div className="text-[11px] text-zinc-500">{g.goalType} · {fmt(g.currentAmount)} of {fmt(g.targetAmount)}</div>
                        </div>
                        <input
                            type="number"
                            min={0}
                            value={amounts[g.goalId] ?? ""}
                            onChange={(e) => setAmounts((m) => ({ ...m, [g.goalId]: e.target.value }))}
                            className="w-28 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-right text-sm text-white tabular-nums focus:outline-none focus:border-yellow-500/50"
                        />
                    </div>
                ))}
            </div>

            {/* Running total vs available */}
            <div className="flex items-center justify-between mt-4 text-sm">
                <span className="text-zinc-400">Allocated</span>
                <span className="tabular-nums text-white">{fmt(total)} <span className="text-zinc-500">/ {fmt(available)} surplus</span></span>
            </div>
            <div className="mt-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={cn("h-full rounded-full transition-all", remaining < 0 ? "bg-red-500" : "bg-yellow-500")}
                    style={{ width: `${Math.min((total / available) * 100, 100)}%` }}
                />
            </div>
            <div className={cn("mt-1.5 text-xs", remaining < 0 ? "text-red-400" : "text-zinc-500")}>
                {remaining >= 0 ? `${fmt(remaining)} free` : `${fmt(-remaining)} over your surplus — the extra would come from existing savings`}
            </div>

            {/* Tradeoffs when overcommitted */}
            {data.overcommitted && data.tradeoffs.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center gap-1.5 text-xs text-amber-400 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5" /> Your goals need more than your surplus. Options:
                    </div>
                    <ul className="space-y-1 text-xs text-zinc-400">
                        {data.tradeoffs.map((t) => (
                            <li key={t.goalId}>
                                <span className="text-zinc-300">{titleById.get(t.goalId) ?? "Goal"}</span>:{" "}
                                {t.extendMonths != null ? `push back ~${t.extendMonths} month${t.extendMonths === 1 ? "" : "s"}` : "fund it"}, or find {fmt(t.shortfall)}/mo more.
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {error && <div className="mt-3 text-xs text-red-400">{error}</div>}
            {done && <div className="mt-3 text-xs text-emerald-400 flex items-start gap-1.5"><Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />{done}</div>}

            <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="mt-4 w-full py-3 rounded-xl bg-yellow-600 hover:bg-yellow-500 text-black font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Confirm allocation
            </button>

            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
                <Info className="w-3 h-3 shrink-0" /> These are tracked plans recorded as goal contributions — no money is moved.
            </p>
        </div>
    );
}

function Header() {
    return (
        <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-yellow-500" />
            <div>
                <h3 className="text-lg font-semibold text-white">Deploy your surplus</h3>
                <p className="text-xs text-zinc-500">A suggested split across your goals — adjust, then confirm.</p>
            </div>
        </div>
    );
}
