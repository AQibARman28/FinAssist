"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Check, Loader2, CornerDownLeft } from "lucide-react";
import { format, isToday, isYesterday, isTomorrow } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { useCategories } from "@/lib/useCategories";
import { parseExpenseInput, type CategoryOption } from "@/lib/parseExpenseInput";

const PLACEHOLDERS = ["lunch 350 food", "uber 280 yesterday", "1.2k groceries"];

// The quick-add bottom sheet: a single natural-language field ("lunch 350
// food") so an expense is one tap + one line away from anywhere in the app.
// Stays open after adding so you can log a few in a row. Loaded on demand by
// QuickExpenseFab — the date parser it needs is too big for every page.
export default function QuickExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { format: fmtMoney } = useCurrency();
    const [text, setText] = useState("");
    const [pickedCat, setPickedCat] = useState("");   // the user's explicit choice
    const [touchedCat, setTouchedCat] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [added, setAdded] = useState(false);
    const [phIdx, setPhIdx] = useState(0);

    // Expense categories, from the list the rest of the app already shares.
    const { active } = useCategories("expense");
    const cats = useMemo<CategoryOption[]>(() => active.map((c) => ({ _id: c._id, name: c.name })), [active]);

    useEffect(() => {
        if (text || !open) return;
        const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3000);
        return () => clearInterval(id);
    }, [text, open]);

    const parsed = useMemo(() => parseExpenseInput(text, cats), [text, cats]);
    const detectedId = parsed.category?._id ?? null;
    // Follow the detected category until the user picks one themselves.
    const selectedCat = touchedCat ? pickedCat : (detectedId ?? "");

    const canCommit = parsed.amount !== null && selectedCat !== "" && !committing;
    const dateLabel = isToday(parsed.date) ? "today" : isYesterday(parsed.date) ? "yesterday" : isTomorrow(parsed.date) ? "tomorrow" : format(parsed.date, "MMM d");

    const reset = () => { setText(""); setPickedCat(""); setTouchedCat(false); setError(null); };

    const commit = async () => {
        if (parsed.amount === null) { setError("Add an amount"); return; }
        if (!selectedCat) { setError("Pick a category"); return; }
        setCommitting(true); setError(null);
        try {
            await api.post("/expenses", {
                description: parsed.description,
                amount: parsed.amount,
                category: selectedCat,
                date: parsed.date.toISOString(),
            });
            reset();
            setAdded(true);
            setTimeout(() => setAdded(false), 1800);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to add expense");
        } finally {
            setCommitting(false);
        }
    };

    return (
        <>
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            onClick={onClose}
                            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
                            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full sm:max-w-lg bg-zinc-900 border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl sm:mb-4 p-5"
                            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-amber-300" />
                                    <h2 className="text-white font-semibold">Quick add expense</h2>
                                </div>
                                <button onClick={onClose} aria-label="Close" className="p-2 text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
                            </div>

                            <input
                                autoFocus
                                type="text"
                                value={text}
                                onChange={(e) => { setText(e.target.value); setError(null); }}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
                                placeholder={`e.g. "${PLACEHOLDERS[phIdx]}"`}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-base placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
                            />

                            {/* Live preview: amount + date */}
                            <div className="flex items-center gap-2 mt-3 text-sm">
                                <span className={cn("px-2.5 py-1 rounded-lg tabular-nums border", parsed.amount === null ? "border-white/10 text-zinc-500" : "border-amber-400/30 text-amber-300")}>
                                    {parsed.amount === null ? "amount?" : fmtMoney(parsed.amount)}
                                </span>
                                <span className="text-zinc-500">·</span>
                                <span className="text-zinc-400">{dateLabel}</span>
                            </div>

                            {/* Category (native select — reliable on mobile) */}
                            <select
                                value={selectedCat}
                                onChange={(e) => { setPickedCat(e.target.value); setTouchedCat(true); }}
                                className="w-full mt-3 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            >
                                <option value="" disabled>Pick a category</option>
                                {cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                            </select>

                            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

                            <button
                                onClick={commit}
                                disabled={!canCommit}
                                className="mt-4 w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : added ? <><Check className="w-4 h-4" /> Added!</> : <>Add expense <CornerDownLeft className="w-4 h-4" /></>}
                            </button>
                            <p className="mt-2 text-center text-[11px] text-zinc-600">Type an amount, a category word, and an optional date — we figure out the rest.</p>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
