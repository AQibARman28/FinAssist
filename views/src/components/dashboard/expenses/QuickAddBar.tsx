"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowDown, CircleCheck, CornerDownLeft, HelpCircle, Loader2, X } from "lucide-react";
import { format, isToday, isYesterday, isTomorrow } from "date-fns";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/useCategories";
import { useCurrency } from "@/lib/useCurrency";
import { CategoryPicker } from "@/components/CategoryPicker";
import { Card, FieldError, StateNote } from "@/components/dashboard/ui";
import { parseExpenseInput, type CategoryOption } from "@/lib/parseExpenseInput";

const PLACEHOLDERS = [
    "lunch 350 food",
    "uber to office 280 yesterday",
    "1.2k netflix bills",
];

const EASE = [0.16, 1, 0.3, 1] as const;

interface QuickAddBarProps {
    onAdd?: () => void;
    onUseForm?: () => void;
    className?: string;
}

// A token in the syntax help, set like a key on a keyboard.
function Token({ children }: { children: React.ReactNode }) {
    return <code className="px-1.5 py-0.5 rounded-md bg-white/[0.07] font-sans text-[12px] font-medium text-white">{children}</code>;
}

// The parsed parts of the line, each under its caps label.
function Part({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <p className="label-caps text-zinc-400">{label}</p>
            <div className="mt-2">{children}</div>
        </div>
    );
}

// The natural-language quick add: one line ("lunch 350 food") becomes an
// expense. The category it spots is only a suggestion the student confirms
// in the picker; "/" anywhere on the page jumps here.
export function QuickAddBar({ onAdd, onUseForm, className }: QuickAddBarProps) {
    const { format: fmtMoney } = useCurrency();
    const [text, setText]                   = useState("");
    const [pickedCat, setPickedCat]         = useState("");   // the user's explicit choice
    const [userTouchedCat, setUserTouched]  = useState(false);
    const [committing, setCommitting]       = useState(false);
    const [error, setError]                 = useState<string | null>(null);
    const [showToast, setShowToast]         = useState(false);
    const [showHelp, setShowHelp]           = useState(false);
    const [phIdx, setPhIdx]                 = useState(0);
    const reduceMotion = useReducedMotion();
    const inputRef = useRef<HTMLInputElement>(null);
    const uid = useId();
    const ids = { hint: `${uid}-hint`, error: `${uid}-error`, help: `${uid}-help`, category: `${uid}-cat`, categoryLabel: `${uid}-cat-label` };

    // Categories used purely to *suggest* (never auto-assign) a match. If they
    // fail to load the picker still works; suggestions just won't fire.
    const { active } = useCategories("expense");
    const cats = useMemo<CategoryOption[]>(() => active.map((c) => ({ _id: c._id, name: c.name })), [active]);

    // Cycle the placeholder examples while the field is empty, unless the
    // device asks for less motion.
    useEffect(() => {
        if (text || reduceMotion) return;
        const id = setInterval(() => setPhIdx((i) => (i + 1) % PLACEHOLDERS.length), 3200);
        return () => clearInterval(id);
    }, [text, reduceMotion]);

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
    const selectedCat = userTouchedCat ? pickedCat : (detectedId ?? "");

    const canCommit = parsed.amount !== null && selectedCat !== "" && !committing;

    const reset = () => {
        setText("");
        setPickedCat("");
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
            onAdd?.();
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to add expense");
        } finally {
            setCommitting(false);
        }
    };

    const dateLabel =
        isToday(parsed.date)     ? "Today"
        : isYesterday(parsed.date) ? "Yesterday"
        : isTomorrow(parsed.date)  ? "Tomorrow"
        : format(parsed.date, "EEE d MMM yyyy");

    const showPreview = text.trim() !== "";

    const helpButton = (
        <div className="relative -mr-2">
            <button
                type="button"
                onClick={() => setShowHelp((s) => !s)}
                aria-expanded={showHelp}
                aria-controls={ids.help}
                className="btn-quiet text-[13px]"
            >
                <HelpCircle className="w-4 h-4" aria-hidden /> How to type it
            </button>
            <AnimatePresence>
                {showHelp && (
                    <motion.div
                        id={ids.help}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="absolute right-0 top-full mt-2 z-50 w-[min(21rem,calc(100vw-2rem))] p-4 rounded-2xl bg-graphite-raised border border-white/10 shadow-[0_25px_50px_-12px_rgb(0_0_0/0.5)]"
                    >
                        <div className="flex items-center justify-between gap-3 -mt-1.5 -mr-2.5">
                            <p className="font-semibold text-white">Quick-add syntax</p>
                            <button type="button" onClick={() => setShowHelp(false)} aria-label="Close help" className="btn-icon">
                                <X className="w-4 h-4" aria-hidden />
                            </button>
                        </div>
                        <ul className="mt-2 space-y-2.5 text-[13px] leading-relaxed text-zinc-300">
                            <li><Token>350</Token> <Token>1.2k</Token> <Token>4*250</Token> the amount; sums and k are fine</li>
                            <li><Token>yesterday</Token> <Token>last friday</Token> the date</li>
                            <li><Token>food</Token> <Token>uber</Token> the category, suggested for you to confirm</li>
                            <li>Everything else becomes the description.</li>
                            <li className="pt-1 text-zinc-400"><Token>/</Token> focus · <Token>Enter</Token> add · <Token>Esc</Token> clear</li>
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );

    return (
        <Card title="Quick add" id="quick-add" aside={helpButton} className={className}>
            <input
                ref={inputRef}
                type="text"
                aria-label="Quick add expense"
                aria-describedby={error ? `${ids.hint} ${ids.error}` : ids.hint}
                aria-invalid={error ? true : undefined}
                value={text}
                onChange={(e) => { setText(e.target.value); setError(null); }}
                onKeyDown={(e) => {
                    if (e.key === "Enter")       { e.preventDefault(); handleCommit(); }
                    else if (e.key === "Escape") { e.preventDefault(); reset(); }
                }}
                placeholder={`Try "${PLACEHOLDERS[phIdx]}"`}
                className="field min-h-14 text-[17px]"
            />
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p id={ids.hint} className="text-[12.5px] text-zinc-400">
                    An amount, a category word, and the day if it wasn&apos;t today.<span className="hidden md:inline"> Press / to jump here.</span>
                </p>
                <p role="status">{showToast && <StateNote tone="good" icon={CircleCheck}>Expense added</StateNote>}</p>
            </div>

            <AnimatePresence initial={false}>
                {showPreview && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className="overflow-visible"
                    >
                        <div className="mt-5 pt-5 border-t border-white/[0.07]" aria-live="polite">
                            {/* Phones, and the narrow column beside the figure from 1024px: a
                                two-column grid (dense, so Date fills in beside Amount). A
                                full-width card in between sets the parts in one line. */}
                            <div className="grid grid-cols-2 grid-flow-row-dense gap-x-6 gap-y-5 md:flex md:flex-wrap md:items-end lg:grid">
                                <Part label="Amount">
                                    <p className="text-[26px] leading-none font-light [font-stretch:112%] tabular-nums text-white">
                                        {parsed.amount === null
                                            ? <><span aria-hidden className="text-zinc-600">—</span><span className="sr-only">No amount yet</span></>
                                            : fmtMoney(parsed.amount)}
                                    </p>
                                </Part>

                                <div className="col-span-2 md:w-60 lg:w-auto min-w-0">
                                    <p id={ids.categoryLabel} className="label-caps text-zinc-400">Category</p>
                                    <div className="mt-2">
                                        <CategoryPicker
                                            id={ids.category}
                                            labelledBy={ids.categoryLabel}
                                            type="expense"
                                            value={selectedCat || null}
                                            onChange={(id) => { setPickedCat(id); setUserTouched(true); }}
                                            placeholder="Pick category"
                                        />
                                    </div>
                                </div>

                                <Part label="Date">
                                    <p className="text-[14px] leading-[26px] text-zinc-200">{dateLabel}</p>
                                </Part>

                                <Part label="Description" className="col-span-2 md:flex-1 min-w-0 md:min-w-[8rem]">
                                    <p className="text-[14px] leading-[26px] text-zinc-200 truncate">{parsed.description}</p>
                                </Part>

                                <button
                                    type="button"
                                    onClick={handleCommit}
                                    disabled={!canCommit}
                                    className="btn-primary col-span-2"
                                >
                                    {committing
                                        ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Adding…</>
                                        : <>Add expense <CornerDownLeft className="w-4 h-4" aria-hidden /></>}
                                </button>
                            </div>

                            {error && <FieldError id={ids.error}>{error}</FieldError>}
                            {!error && !canCommit && !committing && (
                                <p className="mt-2 text-[12.5px] text-zinc-400">
                                    {parsed.amount === null ? "Enter an amount to add" : "Pick a category to add"}
                                </p>
                            )}

                            {onUseForm && (
                                <button
                                    type="button"
                                    onClick={onUseForm}
                                    className="mt-2 -ml-2 inline-flex items-center gap-1 min-h-11 px-2 rounded-lg text-[13px] font-semibold text-plat hover:text-white hover:bg-white/[0.05] transition-colors focus-ring"
                                >
                                    Need more fields? Use the full form <ArrowDown className="w-4 h-4" aria-hidden />
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Card>
    );
}
