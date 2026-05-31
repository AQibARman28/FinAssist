"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarClock, ArrowRight, PiggyBank, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { cn } from "@/lib/utils";

interface RolloverStatus {
    pending: boolean;
    priorClosing?: number;
    month?: string;
    year?: number;
}

// Shown once at the start of a new month: carry last month's wallet balance
// forward, or move it to Savings. A negative (deficit) only carries forward.
export function MonthRolloverModal({ onDone }: { onDone?: () => void }) {
    const { format: fmt } = useCurrency();
    const [status, setStatus] = useState<RolloverStatus | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.get("/wallet/rollover-status")
            .then((res) => { if (!cancelled) setStatus(res.data?.data ?? null); })
            .catch(() => { if (!cancelled) setStatus(null); });
        return () => { cancelled = true; };
    }, []);

    const choose = async (action: "carry" | "save") => {
        setSubmitting(true);
        try {
            await api.post("/wallet/rollover", { action });
            setStatus({ pending: false });
            onDone?.();
        } catch {
            setStatus({ pending: false });
        } finally {
            setSubmitting(false);
        }
    };

    const open = !!status?.pending;
    const closing = status?.priorClosing ?? 0;
    const positive = closing > 0;

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
                        className="w-full max-w-sm rounded-3xl bg-zinc-900 border border-white/10 p-6 shadow-2xl shadow-black/50"
                        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
                    >
                        <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-purple-500/10 border border-purple-500/20 mb-4">
                            <CalendarClock className="w-5 h-5 text-purple-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-white">New month — {status?.month} wrapped up</h2>

                        {positive ? (
                            <>
                                <p className="text-sm text-zinc-400 mt-1.5">
                                    You finished {status?.month} with <span className="text-emerald-400 font-medium tabular-nums">{fmt(closing)}</span> left in your wallet. What should happen to it?
                                </p>
                                <div className="mt-5 space-y-2.5">
                                    <button
                                        onClick={() => choose("carry")}
                                        disabled={submitting}
                                        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-left hover:bg-white/10 transition-colors disabled:opacity-50"
                                    >
                                        <span><span className="block text-sm font-medium text-white">Carry into this month</span><span className="block text-xs text-zinc-500">Keep it spendable in your wallet</span></span>
                                        <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
                                    </button>
                                    <button
                                        onClick={() => choose("save")}
                                        disabled={submitting}
                                        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-emerald-600/15 border border-emerald-500/30 text-left hover:bg-emerald-600/25 transition-colors disabled:opacity-50"
                                    >
                                        <span><span className="block text-sm font-medium text-emerald-300">Move to savings</span><span className="block text-xs text-emerald-500/70">Set it aside; start the month fresh</span></span>
                                        <PiggyBank className="w-4 h-4 text-emerald-400 shrink-0" />
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-zinc-400 mt-1.5">
                                    You finished {status?.month} at <span className="text-red-400 font-medium tabular-nums">{fmt(closing)}</span>. This carries into this month so your balance stays honest.
                                </p>
                                <button
                                    onClick={() => choose("carry")}
                                    disabled={submitting}
                                    className={cn("mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors disabled:opacity-50")}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Got it"}
                                </button>
                            </>
                        )}

                        {submitting && positive && (
                            <div className="mt-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
