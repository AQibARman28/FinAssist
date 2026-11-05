"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, Loader2, PiggyBank } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { apiErrorCode, apiErrorMessage, apiErrorStatus } from "@/lib/apiError";
import { nextIncomeDate, safeToSpend, type IncomeTemplate } from "@/lib/dashboard";
import { focusPageHeading } from "@/lib/focusPageHeading";

interface RolloverStatus {
    pending: boolean;
    priorClosing?: number;
    month?: string;
    year?: number;
}

interface Balance {
    wallet?: number;
    available?: number;
    savingsBalance?: number;
}

const choiceClass =
    "flex-1 flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition-colors disabled:opacity-50 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2";

// At the start of a month: carry last month's wallet balance forward, or move
// it to Savings (a deficit only carries). A card on the dashboard rather than
// a pop-up, so it never stands between the student and their figures.
// "Later" hides it for this visit; the server keeps the month pending, so it
// is back next time.
export function MonthEndCard() {
    const { format: fmt } = useCurrency();
    const { data: status } = useApi<RolloverStatus>("/wallet/rollover-status");
    // The dashboard already reads these; they cost no extra request.
    const { data: balance } = useApi<Balance>("/analytics/balance");
    const { data: recurring } = useApi<{ items?: IncomeTemplate[] }>("/analytics/recurring-income");
    const [today] = useState(() => new Date());
    const [hidden, setHidden] = useState(false);
    const [done, setDone] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const closing = status?.priorClosing ?? 0;
    const month = status?.month ?? "Last month";

    // What each choice does to the daily "safe to spend" figure.
    const walletNow = balance?.wallet ?? balance?.available;
    const daily = useMemo(() => {
        if (walletNow === undefined || !recurring) return null;
        const next = nextIncomeDate(recurring.items ?? [], today);
        return { carry: safeToSpend(walletNow, today, next).perDay, save: safeToSpend(walletNow - closing, today, next).perDay };
    }, [walletNow, recurring, closing, today]);

    const later = () => {
        setHidden(true);
        focusPageHeading();
    };

    const choose = async (action: "carry" | "save") => {
        setSubmitting(true);
        setError(null);
        try {
            await api.post("/wallet/rollover", { action });
            setDone(action === "save" && closing > 0
                ? `Moved ${fmt(closing)} to savings.`
                : `${month}'s balance carries into this month.`);
        } catch (err) {
            if (apiErrorCode(err) === "ROLLOVER_ALREADY_HANDLED") { setHidden(true); return; }
            // 409 WALLET_BUSY is a transient lock conflict: tap again.
            setError(apiErrorMessage(err, apiErrorStatus(err) === 409
                ? "Another wallet update is in progress. Please try again."
                : "Couldn't save your choice. Please try again."));
        } finally {
            setSubmitting(false);
        }
    };

    if (done) {
        return (
            <div role="status" className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-200">
                <Check className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden />
                <p className="flex-1">{done} You can move money between your wallet and savings any time on the Savings page.</p>
            </div>
        );
    }
    if (!status?.pending || hidden) return null;

    const savingsNow = balance?.savingsBalance;
    const now = walletNow !== undefined && savingsNow !== undefined ? { wallet: walletNow, savings: savingsNow } : null;

    return (
        <section aria-labelledby="month-end" className="p-5 md:p-6 rounded-3xl bg-graphite shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
            <div className="flex items-start justify-between gap-3">
                <h2 id="month-end" className="min-w-0 pt-2.5 text-base font-semibold text-white">
                    {closing > 0
                        ? <>{month} wrapped up with <span className="text-white tabular-nums">{fmt(closing)}</span> left</>
                        : <>{month} ended <span className="text-red-400 tabular-nums">{fmt(-closing)}</span> below zero</>}
                </h2>
                <button
                    type="button"
                    onClick={later}
                    disabled={submitting}
                    className="shrink-0 -mr-2 min-h-11 px-3 rounded-xl text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors disabled:opacity-50 focus-ring"
                >
                    Later
                </button>
            </div>

            {closing > 0 ? (
                <>
                    <p className="mt-1 text-sm text-zinc-400">What should happen to it?</p>
                    <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                        <button
                            type="button"
                            onClick={() => choose("carry")}
                            disabled={submitting}
                            className={`${choiceClass} bg-white/5 border-white/10 hover:bg-white/10 focus-visible:outline-plat`}
                        >
                            <span>
                                <span className="block text-sm font-medium text-white">Carry into this month</span>
                                <span className="block text-xs text-zinc-400 tabular-nums">
                                    {now ? `Wallet stays at ${fmt(now.wallet)}` : "Keep it spendable in your wallet"}
                                </span>
                                {daily && <span className="block text-xs text-zinc-300 tabular-nums">Safe to spend stays {fmt(daily.carry)} a day</span>}
                            </span>
                            <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden />
                        </button>
                        <button
                            type="button"
                            onClick={() => choose("save")}
                            disabled={submitting}
                            className={`${choiceClass} bg-white/[0.04] border-plat/40 hover:bg-white/[0.08] focus-visible:outline-plat`}
                        >
                            <span>
                                <span className="block text-sm font-medium text-white">Move to savings</span>
                                <span className="block text-xs text-zinc-400 tabular-nums">
                                    {now ? `Savings ${fmt(now.savings)} → ${fmt(now.savings + closing)}` : "Set it aside; start the month fresh"}
                                </span>
                                {daily && <span className="block text-xs text-zinc-300 tabular-nums">Safe to spend {fmt(daily.carry)} → {fmt(daily.save)} a day</span>}
                            </span>
                            <PiggyBank className="w-4 h-4 text-plat shrink-0" aria-hidden />
                        </button>
                    </div>
                    <p className="mt-3 text-xs text-zinc-400">You can move money between your wallet and savings any time on the Savings page.</p>
                </>
            ) : (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-zinc-400 max-w-prose">It carries into this month so your balance stays honest.</p>
                    <button
                        type="button"
                        onClick={() => choose("carry")}
                        disabled={submitting}
                        className="min-h-11 px-5 rounded-full bg-plat text-plat-ink hover:bg-white text-sm font-semibold transition-colors disabled:opacity-50 focus-ring"
                    >
                        Got it
                    </button>
                </div>
            )}

            {submitting && (
                <p role="status" className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Saving your choice…
                </p>
            )}
            {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
        </section>
    );
}
