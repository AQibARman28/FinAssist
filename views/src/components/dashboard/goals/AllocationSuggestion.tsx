"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, X, Loader2, Check, AlertCircle, ArrowLeft, Info, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/apiError";
import {
    allocationTotal, buildAllocations, formatMonths, suggestionToInputs,
    type AllocationData, type Tradeoff,
} from "./goalPlanModel";

interface AllocationSuggestionProps {
    /** Spendable wallet balance (the server's hard cap), if known. */
    wallet: number | null;
    onClose: () => void;
    /** Called after POST /goals/allocate succeeds so goals/balance/plan refresh. */
    onAllocated: () => void;
}

type Step = "edit" | "confirm" | "done";

// Recommend-and-confirm: GET /goals/allocation-suggestion proposes a split of
// the monthly surplus; the user can change any amount; NOTHING is recorded
// until they press Confirm on the review step (POST /goals/allocate).
export function AllocationSuggestion({ wallet, onClose, onAllocated }: AllocationSuggestionProps) {
    const { format: fmt } = useCurrency();
    const [data, setData] = useState<AllocationData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [step, setStep] = useState<Step>("edit");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recorded, setRecorded] = useState<{ count: number; total: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.get("/goals/allocation-suggestion")
            .then((res) => {
                if (cancelled) return;
                const d = res.data?.data as AllocationData | undefined;
                if (!d) { setLoadError("No suggestion available."); return; }
                setData(d);
                setInputs(suggestionToInputs(d.goals));
            })
            .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, "Couldn't load a suggestion.")); });
        return () => { cancelled = true; };
    }, []);

    const goals = useMemo(() => data?.goals ?? [], [data]);
    const tradeoffs = useMemo(() => new Map((data?.tradeoffs ?? []).map((t) => [t.goalId, t])), [data]);
    const rows = useMemo(() => buildAllocations(goals, inputs), [goals, inputs]);
    const total = allocationTotal(rows);
    const overWallet = wallet !== null && total > wallet + 0.005;
    const titleOf = (id: string) => goals.find((g) => g.goalId === id)?.title ?? "Goal";

    const confirm = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await api.post("/goals/allocate", { allocations: rows, note: "Surplus allocation" });
            setRecorded({ count: rows.length, total });
            setStep("done");
            onAllocated();
        } catch (err) {
            setError(apiErrorMessage(err, "Couldn't record the allocation."));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 sm:p-5 rounded-2xl bg-black/30 border border-yellow-500/20 space-y-4"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-yellow-500" />
                    <h4 className="text-white font-medium">Suggested allocation</h4>
                </div>
                <button onClick={onClose} aria-label="Close allocation" className="p-2 -m-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <p className="flex items-start gap-2 text-xs text-zinc-500">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-zinc-500" />
                <span>
                    A suggestion only — nothing is recorded until you confirm. Confirming records these as goal
                    contributions in FinAssist (money set aside from your wallet). It doesn&apos;t move money between bank accounts.
                </span>
            </p>

            {loadError ? (
                <div className="flex items-center gap-2 text-sm text-red-400"><AlertCircle className="w-4 h-4" />{loadError}</div>
            ) : !data ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
            ) : step === "done" && recorded ? (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-emerald-400">
                        <Check className="w-4 h-4" />
                        Recorded {recorded.count} contribution{recorded.count === 1 ? "" : "s"} totalling {fmt(recorded.total)}.
                    </div>
                    <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-300 hover:bg-white/10 transition-colors">
                        Done
                    </button>
                </div>
            ) : (
                <>
                    {/* Context numbers */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <Metric label="Monthly surplus" value={fmt(data.cashFlow.monthlySurplus)} tone={data.cashFlow.monthlySurplus < 0 ? "text-red-400" : "text-white"} />
                        <Metric label="Emergency baseline" value={fmt(data.emergencyBaseline)} hint="3 × monthly expenses" />
                        <Metric label="Left unallocated" value={fmt(data.freeSurplus)} />
                        <Metric label="In your wallet" value={wallet === null ? "—" : fmt(wallet)} />
                    </div>

                    {goals.length === 0 ? (
                        <p className="text-sm text-zinc-500">No active goals to allocate to.</p>
                    ) : step === "edit" ? (
                        <div className="space-y-2">
                            {goals.map((g) => (
                                <div key={g.goalId} className="p-3 rounded-xl bg-zinc-900/60 border border-white/5">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-sm text-white font-medium truncate">{g.title}</span>
                                                {g.goalType === "Emergency Fund" && (
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 shrink-0">Emergency</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-zinc-500 tabular-nums mt-0.5">
                                                {fmt(Math.max(g.targetAmount - g.currentAmount, 0))} to go · suggested {fmt(g.suggested)}
                                            </div>
                                        </div>
                                        <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            inputMode="decimal"
                                            placeholder="0"
                                            aria-label={`Amount for ${g.title}`}
                                            value={inputs[g.goalId] ?? ""}
                                            onChange={(e) => setInputs((prev) => ({ ...prev, [g.goalId]: e.target.value }))}
                                            className="w-28 shrink-0 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white text-right tabular-nums focus:outline-none focus:border-yellow-500/50"
                                        />
                                    </div>
                                    <TradeoffLine tradeoff={tradeoffs.get(g.goalId)} />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-zinc-300">
                                Record {rows.length} contribution{rows.length === 1 ? "" : "s"} totalling{" "}
                                <span className="text-white font-semibold tabular-nums">{fmt(total)}</span>? This sets the money aside
                                from your wallet into these goals.
                            </p>
                            <ul className="space-y-1">
                                {rows.map((r) => (
                                    <li key={r.goalId} className="flex justify-between gap-3 text-sm px-3 py-2 rounded-lg bg-zinc-900/60">
                                        <span className="text-zinc-300 truncate">{titleOf(r.goalId)}</span>
                                        <span className="text-white tabular-nums shrink-0">{fmt(r.amount)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {overWallet && (
                        <div className="flex items-start gap-2 text-xs text-amber-400">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>That&apos;s more than the {fmt(wallet ?? 0)} available in your wallet — saving can&apos;t exceed what&apos;s available.</span>
                        </div>
                    )}
                    {error && (
                        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {goals.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <span className="text-sm text-zinc-400">
                                Total <span className="text-white font-semibold tabular-nums">{fmt(total)}</span>
                            </span>
                            {step === "edit" ? (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setInputs(suggestionToInputs(goals))}
                                        className="px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl hover:bg-white/5 transition-colors"
                                    >
                                        Reset
                                    </button>
                                    <button
                                        onClick={() => { setError(null); setStep("confirm"); }}
                                        disabled={rows.length === 0}
                                        className="px-5 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black text-sm font-semibold rounded-xl transition-colors disabled:opacity-40"
                                    >
                                        Review
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => { setError(null); setStep("edit"); }}
                                        disabled={submitting}
                                        className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 rounded-xl hover:bg-white/5 transition-colors disabled:opacity-50"
                                    >
                                        <ArrowLeft className="w-4 h-4" /> Back
                                    </button>
                                    <button
                                        onClick={confirm}
                                        disabled={submitting || rows.length === 0}
                                        className="flex items-center gap-2 px-5 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                        Confirm
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {data.overcommitted && step === "edit" && (
                        <p className="flex items-start gap-2 text-[11px] text-zinc-500">
                            <Info className="w-3 h-3 mt-0.5 shrink-0" />
                            Your surplus can&apos;t cover every deadline. The emergency fund is topped up first, then the nearest deadlines; goals marked short above will finish later at this pace.
                        </p>
                    )}
                </>
            )}
        </motion.div>
    );
}

function Metric({ label, value, hint, tone = "text-white" }: { label: string; value: string; hint?: string; tone?: string }) {
    return (
        <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/5 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 truncate">{label}</div>
            <div className={cn("text-sm font-semibold tabular-nums truncate", tone)}>{value}</div>
            {hint && <div className="text-[10px] text-zinc-600 truncate">{hint}</div>}
        </div>
    );
}

function TradeoffLine({ tradeoff }: { tradeoff?: Tradeoff }) {
    const { format: fmt } = useCurrency();
    if (!tradeoff) return null;
    return (
        <div className="mt-1.5 text-[11px] text-amber-400/90">
            At the suggested amount it&apos;s {fmt(tradeoff.shortfall)}/mo short of what its deadline needs
            {tradeoff.extendMonths === null
                ? " — not funded this round."
                : tradeoff.extendMonths > 0
                    ? ` — at this pace it finishes ~${formatMonths(tradeoff.extendMonths)} late.`
                    : "."}
        </div>
    );
}
