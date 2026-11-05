"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleCheck, Info, Loader2, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/apiError";
import { Card, Missing, Notice, Skeleton, StateNote, Term } from "../ui";
import {
    allocationTotal, buildAllocations, formatMonths, parseAllocationInput, suggestionToInputs,
    type AllocationData, type Tradeoff,
} from "./goalPlanModel";

interface AllocationSuggestionProps {
    /** Spendable wallet balance (the server's hard cap), if known. */
    wallet: number | null;
    onClose: () => void;
    /** Called after POST /goals/allocate succeeds so goals/balance/plan refresh. */
    onAllocated: () => void;
    id?: string;
    className?: string;
}

type Step = "edit" | "confirm" | "done";

// Recommend-and-confirm: GET /goals/allocation-suggestion proposes a split of
// the monthly surplus; the user can change any amount; NOTHING is recorded
// until they press Confirm on the review step (POST /goals/allocate). A row
// still at the suggested amount keeps the 40% platinum edge of a suggested
// choice; changing it makes the row plainly the user's.
export function AllocationSuggestion({ wallet, onClose, onAllocated, id = "suggested-split", className }: AllocationSuggestionProps) {
    const { format: fmt } = useCurrency();
    const [data, setData] = useState<AllocationData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [inputs, setInputs] = useState<Record<string, string>>({});
    const [step, setStep] = useState<Step>("edit");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recorded, setRecorded] = useState<{ count: number; total: number } | null>(null);
    const uid = useId();

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
    const titleOf = (gid: string) => goals.find((g) => g.goalId === gid)?.title ?? "Goal";

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

    const caption = "block mt-2 text-[12.5px] leading-normal font-normal [font-stretch:100%] text-zinc-400";

    return (
        <Card
            title="Suggested split"
            id={id}
            className={className}
            aside={(
                <button type="button" onClick={onClose} aria-label="Close the suggested split" className="btn-icon -mr-2">
                    <X className="w-4 h-4" aria-hidden />
                </button>
            )}
        >
            <p className="flex items-start gap-2 text-[13px] text-zinc-400 max-w-prose">
                <ShieldCheck className="w-4 h-4 mt-px shrink-0 text-zinc-400" aria-hidden />
                <span>
                    This is only a suggestion: nothing is recorded until you confirm. Confirming records these as goal
                    contributions in FinAssist, money set aside from your wallet. It doesn&apos;t move money between bank accounts.
                </span>
            </p>

            {loadError ? (
                <div role="alert" className="mt-6"><Notice tone="bad">{loadError}</Notice></div>
            ) : !data ? (
                <div aria-hidden className="mt-6 space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px] rounded-xl" />)}
                </div>
            ) : step === "done" && recorded ? (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3" role="status">
                    <StateNote tone="good" icon={CircleCheck} className="text-[13.5px] tabular-nums">
                        Recorded {recorded.count} contribution{recorded.count === 1 ? "" : "s"} totalling {fmt(recorded.total)}.
                    </StateNote>
                    <button type="button" onClick={onClose} className="btn-secondary">Done</button>
                </div>
            ) : (
                <>
                    {/* What the split is drawn from. */}
                    <dl className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
                        {/* Averages, so whole amounts (the plan card shows the same). */}
                        <Term label="Monthly surplus">{fmt(Math.round(data.cashFlow.monthlySurplus))}</Term>
                        <Term label="Emergency baseline">{fmt(Math.round(data.emergencyBaseline))}<span className={caption}>3 × monthly expenses</span></Term>
                        <Term label="Left unallocated">{fmt(Math.round(data.freeSurplus))}</Term>
                        <Term label="In your wallet">{wallet === null ? <Missing /> : fmt(wallet)}</Term>
                    </dl>

                    {goals.length === 0 ? (
                        <p className="mt-6 text-sm text-zinc-400">No active goals to put money towards.</p>
                    ) : step === "edit" ? (
                        <ul className="mt-6 space-y-3">
                            {goals.map((g) => {
                                const amount = parseAllocationInput(inputs[g.goalId]);
                                const suggested = g.suggested > 0 && amount !== null && Math.abs(amount - g.suggested) < 0.005;
                                const inputId = `${uid}-${g.goalId}`;
                                return (
                                    <li
                                        key={g.goalId}
                                        className={cn("px-4 py-3 rounded-xl border transition-colors", suggested ? "border-plat/40 bg-white/[0.03]" : "border-white/10")}
                                    >
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                                                    <span className="truncate font-semibold text-white">{g.title}</span>
                                                    {g.goalType === "Emergency Fund" && <span className="label-caps text-zinc-400">Emergency</span>}
                                                    {suggested && <span className="label-caps text-plat">Suggested</span>}
                                                </div>
                                                <p className="mt-0.5 text-[12.5px] text-zinc-400 tabular-nums">
                                                    {fmt(Math.max(g.targetAmount - g.currentAmount, 0))} to go · suggested {fmt(g.suggested)}
                                                </p>
                                            </div>
                                            <div className="w-32 shrink-0">
                                                <input
                                                    id={inputId}
                                                    aria-label={`Amount for ${g.title}`}
                                                    type="number"
                                                    min={0}
                                                    step="any"
                                                    inputMode="decimal"
                                                    placeholder="0"
                                                    value={inputs[g.goalId] ?? ""}
                                                    onChange={(e) => setInputs((prev) => ({ ...prev, [g.goalId]: e.target.value }))}
                                                    className="field text-right tabular-nums"
                                                />
                                            </div>
                                        </div>
                                        <TradeoffLine tradeoff={tradeoffs.get(g.goalId)} />
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="mt-6">
                            <p className="text-[13.5px] text-zinc-300 max-w-prose">
                                Record {rows.length} contribution{rows.length === 1 ? "" : "s"} totalling{" "}
                                <span className="text-white tabular-nums">{fmt(total)}</span>? This sets the money aside
                                from your wallet into these goals.
                            </p>
                            <ul className="mt-4">
                                {rows.map((r) => (
                                    <li key={r.goalId} className="flex items-baseline justify-between gap-3 py-3 border-t border-white/[0.07] first:border-t-0">
                                        <span className="truncate font-semibold text-white">{titleOf(r.goalId)}</span>
                                        <span className="shrink-0 text-white tabular-nums">{fmt(r.amount)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {overWallet && (
                        <Notice tone="warn" className="mt-5">
                            That&apos;s more than the <span className="tabular-nums">{fmt(wallet ?? 0)}</span> in your wallet. You can&apos;t save more than is available.
                        </Notice>
                    )}
                    {error && <div role="alert" className="mt-5"><Notice tone="bad">{error}</Notice></div>}

                    {goals.length > 0 && (
                        <div className="mt-6 pt-5 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                            <p className="flex items-baseline gap-3">
                                <span className="label-caps text-zinc-400">Total</span>
                                <span className="text-[26px] leading-none font-light [font-stretch:112%] tabular-nums text-white">{fmt(total)}</span>
                            </p>
                            {step === "edit" ? (
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={() => setInputs(suggestionToInputs(goals))} className="btn-quiet">
                                        Reset
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setError(null); setStep("confirm"); }}
                                        disabled={rows.length === 0}
                                        className="btn-primary"
                                    >
                                        Review
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => { setError(null); setStep("edit"); }}
                                        disabled={submitting}
                                        className="btn-quiet"
                                    >
                                        <ArrowLeft className="w-4 h-4" aria-hidden /> Back
                                    </button>
                                    <button type="button" onClick={confirm} disabled={submitting || rows.length === 0} className="btn-primary">
                                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />}
                                        Confirm
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {data.overcommitted && step === "edit" && (
                        <p className="mt-4 flex items-start gap-2 text-[12.5px] text-zinc-400 max-w-prose">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
                            Your surplus can&apos;t cover every deadline. The emergency fund is topped up first, then the nearest
                            deadlines; goals marked short above will finish later at this pace.
                        </p>
                    )}
                </>
            )}
        </Card>
    );
}

function TradeoffLine({ tradeoff }: { tradeoff?: Tradeoff }) {
    const { format: fmt } = useCurrency();
    if (!tradeoff) return null;
    return (
        <StateNote tone="warn" icon={TriangleAlert} className="mt-2 items-start [&>svg]:mt-[2px] tabular-nums">
            <span>
                At the suggested amount it&apos;s {fmt(tradeoff.shortfall)} a month short of what its deadline needs
                {tradeoff.extendMonths === null
                    ? ", so it isn't funded this round."
                    : tradeoff.extendMonths > 0
                        ? `. At this pace it finishes about ${formatMonths(tradeoff.extendMonths)} late.`
                        : "."}
            </span>
        </StateNote>
    );
}
