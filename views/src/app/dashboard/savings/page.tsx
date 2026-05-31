"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { PiggyBank, Wallet, ArrowDownToLine, ArrowUpFromLine, Loader2, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";

interface Entry {
    _id: string;
    amount: number;
    direction: "deposit" | "withdraw";
    source: "manual" | "rollover";
    note?: string;
    date: string;
}
interface SavingsData {
    balance: number;
    wallet: number;
    entries: Entry[];
}

export default function SavingsPage() {
    const { format: fmt } = useCurrency();
    const [data, setData] = useState<SavingsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
    const [amount, setAmount] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const refresh = useCallback(() => setTick((t) => t + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get("/savings")
            .then((res) => { if (!cancelled) setData(res.data?.data ?? null); })
            .catch((err) => { if (!cancelled) { console.error(err); setData(null); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [tick]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = parseFloat(amount);
        if (!value || value <= 0) return;
        setSubmitting(true);
        setError(null);
        try {
            await api.post(`/savings/${mode}`, { amount: value });
            setAmount("");
            refresh();
        } catch (err) {
            const e2 = err as { response?: { data?: { message?: string } } };
            setError(e2.response?.data?.message || `Couldn't ${mode}.`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="p-4 md:p-6 space-y-5 md:space-y-6 max-w-5xl mx-auto">
            <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">Savings</h1>
                <p className="text-zinc-500 text-sm">Money set aside from your wallet. Move it in and out anytime.</p>
            </div>

            {loading ? (
                <div className="h-28 animate-pulse bg-zinc-900/50 rounded-2xl" />
            ) : data ? (
                <>
                    {/* Balance hero + wallet */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-5 rounded-2xl border bg-gradient-to-br from-emerald-900/20 to-black border-emerald-500/20">
                            <div className="flex items-center justify-between">
                                <span className="text-xs uppercase tracking-wider text-zinc-500">Savings balance</span>
                                <PiggyBank className="w-4 h-4 text-emerald-400" />
                            </div>
                            <div className="text-2xl md:text-3xl font-bold tabular-nums text-emerald-400 mt-2">{fmt(data.balance)}</div>
                        </div>
                        <div className="p-5 rounded-2xl border bg-zinc-900/50 border-white/5">
                            <div className="flex items-center justify-between">
                                <span className="text-xs uppercase tracking-wider text-zinc-500">Wallet (spendable)</span>
                                <Wallet className="w-4 h-4 text-zinc-400" />
                            </div>
                            <div className="text-2xl md:text-3xl font-bold tabular-nums text-white mt-2">{fmt(data.wallet)}</div>
                        </div>
                    </div>

                    {/* Move money */}
                    <div className="p-5 rounded-2xl bg-zinc-900/50 border border-white/5">
                        <div className="flex items-center gap-1 p-1 rounded-xl bg-black/30 border border-white/5 w-fit mb-4">
                            {(["deposit", "withdraw"] as const).map((m) => (
                                <button
                                    key={m}
                                    onClick={() => { setMode(m); setError(null); }}
                                    className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors",
                                        mode === m ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-white")}
                                >
                                    {m === "deposit" ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
                                    {m === "deposit" ? "Add to savings" : "Withdraw"}
                                </button>
                            ))}
                        </div>
                        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 sm:items-center">
                            <input
                                type="number" min={1} step="any" placeholder="Amount"
                                value={amount} onChange={(e) => setAmount(e.target.value)}
                                className="w-full sm:flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white tabular-nums placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
                                required
                            />
                            <button
                                type="submit" disabled={submitting}
                                className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === "deposit" ? "Move to savings" : "Withdraw to wallet")}
                            </button>
                        </form>
                        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
                            <Info className="w-3 h-3 shrink-0" />
                            {mode === "deposit"
                                ? `You can set aside up to ${fmt(data.wallet)} from your wallet.`
                                : `You can withdraw up to ${fmt(data.balance)} back to your wallet.`}
                        </p>
                    </div>

                    {/* Ledger */}
                    <div className="p-5 rounded-2xl bg-zinc-900/50 border border-white/5">
                        <h2 className="text-white font-medium mb-3">History</h2>
                        {data.entries.length === 0 ? (
                            <p className="text-zinc-600 text-sm py-6 text-center">No savings activity yet.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {data.entries.map((e) => {
                                    const isDeposit = e.direction === "deposit";
                                    return (
                                        <div key={e._id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-black/20">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={cn("p-2 rounded-lg shrink-0", isDeposit ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-700/40 text-zinc-300")}>
                                                    {isDeposit ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-sm text-white truncate">{e.note || (isDeposit ? "Added to savings" : "Withdrawn to wallet")}{e.source === "rollover" ? " · month-end" : ""}</div>
                                                    <div className="text-[11px] text-zinc-500 tabular-nums">{format(new Date(e.date), "MMM d, yyyy")}</div>
                                                </div>
                                            </div>
                                            <span className={cn("text-sm font-medium tabular-nums shrink-0", isDeposit ? "text-emerald-400" : "text-zinc-300")}>
                                                {isDeposit ? "+" : "−"}{fmt(e.amount)}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="p-6 rounded-2xl bg-zinc-900/50 border border-white/5 text-zinc-500 text-sm">Couldn&apos;t load savings.</div>
            )}
        </div>
    );
}
