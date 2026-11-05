"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X, Zap, Check, Loader2, CornerDownLeft } from "lucide-react";
import { format, isToday, isYesterday, isTomorrow } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { useCategories } from "@/lib/useCategories";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { parseExpenseInput, type CategoryOption } from "@/lib/parseExpenseInput";

const PLACEHOLDERS = ["lunch 2*175 food", "rickshaw 60", "recharge 300 yesterday"];

// The quick-add bottom sheet: a single natural-language field ("lunch 350
// food") so an expense is one tap + one line away from anywhere in the app.
// Stays open after adding so you can log a few in a row. Loaded on demand by
// QuickAddHost — the date parser it needs is too big for every page.
export default function QuickExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { format: fmtMoney } = useCurrency();
    const [text, setText] = useState("");
    const [pickedCat, setPickedCat] = useState("");   // the user's explicit choice
    const [touchedCat, setTouchedCat] = useState(false);
    const [committing, setCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // What was just saved ("৳60 · Transport"), shown on the button for a moment.
    const [added, setAdded] = useState<string | null>(null);
    const reduceMotion = useReducedMotion();
    const [phIdx, setPhIdx] = useState(0);
    const panelRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const ids = { title: useId(), input: useId(), category: useId(), hint: useId(), error: useId() };
    useDialogFocus(open, panelRef, onClose, inputRef);

    // Expense categories, from the list the rest of the app already shares.
    const { active } = useCategories("expense");
    const cats = useMemo<CategoryOption[]>(() => active.map((c) => ({ _id: c._id, name: c.name })), [active]);

    // The example cycles every 3 s, unless the device asks for less motion.
    useEffect(() => {
        if (text || !open || reduceMotion) return;
        const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3000);
        return () => clearInterval(id);
    }, [text, open, reduceMotion]);

    const parsed = useMemo(() => parseExpenseInput(text, cats), [text, cats]);
    const detectedId = parsed.category?._id ?? null;
    // Follow the detected category until the user picks one themselves.
    const selectedCat = touchedCat ? pickedCat : (detectedId ?? "");

    const canCommit = parsed.amount !== null && selectedCat !== "" && !committing;
    const dateLabel = isToday(parsed.date) ? "today" : isYesterday(parsed.date) ? "yesterday" : isTomorrow(parsed.date) ? "tomorrow" : format(parsed.date, "MMM d");

    const reset = () => { setText(""); setPickedCat(""); setTouchedCat(false); setError(null); };

    const commit = async () => {
        if (parsed.amount === null) { setError("Add an amount, for example 60."); return; }
        if (!selectedCat) { setError("Pick a category for this expense."); return; }
        setCommitting(true); setError(null);
        try {
            await api.post("/expenses", {
                description: parsed.description,
                amount: parsed.amount,
                category: selectedCat,
                date: parsed.date.toISOString(),
            });
            const catName = cats.find((c) => c._id === selectedCat)?.name;
            reset();
            setAdded(catName ? `${fmtMoney(parsed.amount)} · ${catName}` : fmtMoney(parsed.amount));
            setTimeout(() => setAdded(null), 2200);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            // Nothing was saved and the text is still in the box, so the user can just retry.
            setError(e.response?.data?.message || "Couldn't add this expense. Check your connection and try again.");
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
                            ref={panelRef}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={ids.title}
                            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
                            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
                            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full sm:max-w-lg bg-graphite border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl sm:mb-4 p-5"
                            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Zap className="w-5 h-5 text-plat" aria-hidden />
                                    <h2 id={ids.title} className="text-white font-semibold">Quick add expense</h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    aria-label="Close"
                                    className="-mr-2 grid place-items-center w-11 h-11 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors focus-ring"
                                >
                                    <X className="w-5 h-5" aria-hidden />
                                </button>
                            </div>

                            {/* A steady label for screen readers; the placeholder only shows rotating examples. */}
                            <label htmlFor={ids.input} className="sr-only">Expense, in your own words</label>
                            <input
                                ref={inputRef}
                                id={ids.input}
                                type="text"
                                value={text}
                                onChange={(e) => { setText(e.target.value); setError(null); }}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
                                placeholder={`e.g. "${PLACEHOLDERS[phIdx]}"`}
                                aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
                                aria-invalid={error ? true : undefined}
                                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-base placeholder:text-zinc-400 focus:border-plat/50 focus-ring"
                            />

                            {/* Live preview: amount + date */}
                            <div className="flex items-center gap-2 mt-3 text-sm" aria-live="polite">
                                <span className={cn("px-2.5 py-1 rounded-lg tabular-nums border", parsed.amount === null ? "border-white/10 text-zinc-400" : "border-plat/40 text-white")}>
                                    {parsed.amount === null ? "amount?" : fmtMoney(parsed.amount)}
                                </span>
                                <span className="text-zinc-500" aria-hidden>·</span>
                                <span className="text-zinc-400">{dateLabel}</span>
                            </div>

                            {/* Category (native select — reliable on mobile) */}
                            <label htmlFor={ids.category} className="sr-only">Category</label>
                            <select
                                id={ids.category}
                                value={selectedCat}
                                onChange={(e) => { setPickedCat(e.target.value); setTouchedCat(true); }}
                                className="w-full mt-3 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-200 focus:border-plat/50 focus-ring"
                            >
                                <option value="" disabled>Pick a category</option>
                                {cats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                            </select>

                            {error && <p id={ids.error} role="alert" className="mt-2 text-xs text-red-400">{error}</p>}

                            <button
                                type="button"
                                onClick={commit}
                                disabled={!canCommit}
                                className="mt-4 w-full min-h-12 py-3 rounded-full bg-plat hover:bg-white text-plat-ink font-semibold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
                            >
                                {committing
                                    ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">Adding</span></>
                                    : added ? <><Check className="w-4 h-4" aria-hidden /> Added {added}</> : <>Add expense <CornerDownLeft className="w-4 h-4" aria-hidden /></>}
                            </button>
                            <p id={ids.hint} className="mt-2 text-center text-xs text-zinc-400">Type an amount, a category word, and an optional date — we figure out the rest.</p>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
