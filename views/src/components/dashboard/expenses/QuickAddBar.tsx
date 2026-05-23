"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, HelpCircle, CheckCircle2, CornerDownLeft, X } from "lucide-react";
import { format, isToday, isYesterday, isTomorrow } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/lib/useCurrency";
import { CategoryPicker } from "@/components/CategoryPicker";
import { parseExpenseInput, type CategoryOption } from "@/lib/parseExpenseInput";

const PLACEHOLDERS = [
    "lunch 350 food",
    "uber to office 280 yesterday",
    "1.2k netflix bills",
];

interface QuickAddBarProps {
    onAdd: () => void;
    onUseForm?: () => void;
}

export function QuickAddBar({ onAdd, onUseForm }: QuickAddBarProps) {
    const { format: fmtMoney } = useCurrency();
    const [text, setText]                   = useState("");
    const [cats, setCats]                   = useState<CategoryOption[]>([]);
    const [selectedCat, setSelectedCat]     = useState("");
    const [userTouchedCat, setUserTouched]  = useState(false);
    const [committing, setCommitting]       = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [showToast, setShowToast]         = useState(false);
    const [showHelp, setShowHelp]           = useState(false);
    const [phIdx, setPhIdx]                 = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // Categories used purely to *suggest* (never auto-assign) a match.
    useEffect(() => {
        let cancelled = false;
        api.get("/categories?type=expense")
            .then((res) => {
                if (cancelled) return;
                setCats(
                    (res.data?.data || [])
                        .filter((c: { isArchived?: boolean }) => !c.isArchived)
                        .map((c: { _id: string; name: string }) => ({ _id: c._id, name: c.name })),
                );
            })
            .catch(() => { /* picker still works; suggestions just won't fire */ });
        return () => { cancelled = true; };
    }, []);

    // Cycle the placeholder examples while the field is empty.
    useEffect(() => {
        if (text) return;
        const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3200);
        return () => clearInterval(id);
    }, [text]);

    // "/" anywhere on the page focuses the bar (unless already typing).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "/") return;
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
            e.preventDefault();
            inputRef.current?.focus();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    const parsed = useMemo(() => parseExpenseInput(text, cats), [text, cats]);
    const detectedId = parsed.category?._id ?? null;

    // Mirror the suggested category into the picker until the user overrides it.
    useEffect(() => {
        if (!userTouchedCat) setSelectedCat(detectedId ?? "");
    }, [detectedId, userTouchedCat]);

    const canCommit = parsed.amount !== null && selectedCat !== "" && !committing;

    const reset = () => {
        setText("");
        setSelectedCat("");
        setUserTouched(false);
        setError(null);
    };

    const handleCommit = async () => {
        if (parsed.amount === null) { setError("Add an amount"); return; }
        if (!selectedCat)          { setError("Pick a category"); return; }
        setCommitting(true);
        setError(null);
        try {
            await api.post("/expenses", {
                description: parsed.description,
                amount:      parsed.amount,
                category:    selectedCat,
                date:        parsed.date.toISOString(),
            });
            reset();
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2200);
            onAdd();
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to add expense");
        } finally {
            setCommitting(false);
        }
    };

    const dateLabel =
        isToday(parsed.date)     ? "today"
        : isYesterday(parsed.date) ? "yesterday"
        : isTomorrow(parsed.date)  ? "tomorrow"
        : format(parsed.date, "MMM d, yyyy");

    const showPreview = text.trim() !== "";

    return (
        <div className="relative p-5 rounded-3xl bg-gradient-to-br from-purple-900/15 to-black border border-purple-500/15">
            <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-300 shrink-0" />
                <input
                    ref={inputRef}
                    type="text"
                    aria-label="Quick add expense"
                    value={text}
                    onChange={(e) => { setText(e.target.value); setError(null); }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter")       { e.preventDefault(); handleCommit(); }
                        else if (e.key === "Escape") { e.preventDefault(); reset(); }
                    }}
                    placeholder={`Add expense — try "${PLACEHOLDERS[phIdx]}"`}
                    className="flex-1 bg-transparent text-white text-lg placeholder:text-zinc-600 focus:outline-none"
                />
                <button
                    type="button"
                    onClick={() => setShowHelp((s) => !s)}
                    aria-label="Quick-add syntax help"
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                >
                    <HelpCircle className="w-4 h-4" />
                </button>
            </div>

            <AnimatePresence>
                {showPreview && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 pt-4 border-t border-white/5 overflow-visible"
                        aria-live="polite"
                    >
                        <div className="flex flex-wrap items-end gap-3">
                            <div className={cn(
                                "px-3 py-2 rounded-xl border tabular-nums",
                                parsed.amount === null ? "border-red-500/40 text-zinc-500" : "border-amber-400/30 text-amber-300",
                            )}>
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">Amount</span>
                                <span className="text-lg font-semibold">
                                    {parsed.amount === null ? "—" : fmtMoney(parsed.amount)}
                                </span>
                            </div>

                            <div className="min-w-[12rem]">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 block mb-1">Category</span>
                                <CategoryPicker
                                    type="expense"
                                    value={selectedCat || null}
                                    onChange={(id) => { setSelectedCat(id); setUserTouched(true); }}
                                    placeholder="Pick category"
                                />
                            </div>

                            <div className="px-3 py-2">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">Date</span>
                                <span className="text-sm text-zinc-300">{dateLabel}</span>
                            </div>

                            <div className="px-3 py-2 flex-1 min-w-[8rem]">
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500 block">Description</span>
                                <span className="text-sm text-zinc-200 truncate block">{parsed.description}</span>
                            </div>

                            <button
                                type="button"
                                onClick={handleCommit}
                                disabled={!canCommit}
                                className="px-4 py-2.5 bg-white text-black rounded-xl font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-opacity"
                            >
                                {committing ? "Adding…" : <>Add <CornerDownLeft className="w-4 h-4" /></>}
                            </button>
                        </div>

                        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
                        {!error && !canCommit && !committing && (
                            <div className="mt-2 text-xs text-zinc-500">
                                {parsed.amount === null ? "Enter an amount to add" : "Pick a category to add"}
                            </div>
                        )}

                        {onUseForm && (
                            <button
                                type="button"
                                onClick={onUseForm}
                                className="mt-2 text-xs text-purple-400 hover:text-purple-300"
                            >
                                Need more fields? Use the full form ↓
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showHelp && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="absolute right-4 top-full mt-2 z-50 w-80 p-4 rounded-xl bg-zinc-900 border border-white/10 shadow-2xl shadow-black/50 text-sm"
                    >
                        <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-white">Quick-add syntax</span>
                            <button type="button" onClick={() => setShowHelp(false)} aria-label="Close help">
                                <X className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
                            </button>
                        </div>
                        <ul className="space-y-1.5 text-zinc-400 text-xs">
                            <li><span className="text-amber-300">350</span> · <span className="text-amber-300">1.2k</span> · <span className="text-amber-300">4*250</span> — amount (math &amp; k ok)</li>
                            <li><span className="text-zinc-200">yesterday</span>, <span className="text-zinc-200">last friday</span> — date</li>
                            <li><span className="text-purple-300">food</span>, <span className="text-purple-300">uber</span> — category (suggested; confirm before adding)</li>
                            <li>everything else becomes the description</li>
                            <li className="pt-1 text-zinc-500"><kbd>/</kbd> focus · <kbd>Enter</kbd> add · <kbd>Esc</kbd> clear</li>
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showToast && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute -bottom-3 left-1/2 -translate-x-1/2 translate-y-full z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm shadow-lg"
                    >
                        <CheckCircle2 className="w-4 h-4" /> Expense added
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
