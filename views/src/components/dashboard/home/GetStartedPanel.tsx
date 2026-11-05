"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, Zap } from "lucide-react";
import type { OnboardingState, StepKey } from "@/lib/onboarding";
import { openQuickAdd } from "@/lib/quickAdd";
import { focusPageHeading } from "@/lib/focusPageHeading";
import { cn } from "@/lib/utils";

// How the steps show: in full, folded to one line ("Skip for now" folds them,
// so the way back stays one tap away), or hidden ("Hide" on the folded line).
// Remembered per account in this browser. It is a convenience flag, not data:
// nothing financial is stored.
export type GetStartedView = "full" | "compact" | "hidden";
const VIEW_EVENT = "finassist:get-started-view";
const keyFor = (userId: string) => `finassist-get-started:${userId}`;
function subscribe(onChange: () => void) {
    window.addEventListener("storage", onChange);
    window.addEventListener(VIEW_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(VIEW_EVENT, onChange);
    };
}
function readView(userId: string): GetStartedView {
    try {
        const v = window.localStorage.getItem(keyFor(userId));
        return v === "compact" || v === "hidden" ? v : "full";
    } catch { return "full"; }
}
function setView(userId: string, view: GetStartedView) {
    try {
        if (view === "full") window.localStorage.removeItem(keyFor(userId));
        else window.localStorage.setItem(keyFor(userId), view);
    } catch { /* storage blocked: applies to this view only */ }
    window.dispatchEvent(new Event(VIEW_EVENT));
}

export function useGetStartedView(userId: string | undefined): GetStartedView {
    return useSyncExternalStore(subscribe, () => (userId ? readView(userId) : "full"), () => "full");
}

const STEPS: Record<StepKey, { title: string; body: string }> = {
    income: {
        title: "Add your income",
        body: "Your allowance, tuition earnings or part-time pay. Mark it monthly and FinAssist knows when the next one arrives.",
    },
    spending: {
        title: "Log what you spend",
        body: "Type it the way you'd say it, like “rickshaw 60” or “lunch 2*175 food”. One line, and it's saved.",
    },
    plan: {
        title: "Set a budget or a goal",
        body: "A monthly limit for food, or something to save for, like a new laptop. The plan tells you if it's realistic.",
    },
};

const primary =
    "inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl text-sm font-medium transition-colors " +
    "focus-ring";

function StepAction({ step, current }: { step: StepKey; current: boolean }) {
    const tone = current ? "bg-plat text-plat-ink hover:bg-white font-semibold" : "bg-white/5 border border-white/10 hover:bg-white/10 text-white";
    if (step === "income") return <Link href="/dashboard/income/new" className={cn(primary, tone)}>Add income</Link>;
    if (step === "spending") {
        return (
            <button type="button" onClick={openQuickAdd} className={cn(primary, tone)}>
                <Zap className="w-4 h-4" aria-hidden /> Try quick add
            </button>
        );
    }
    return (
        <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/budgets" className={cn(primary, tone)}>Set a budget</Link>
            <Link href="/dashboard/goals" className={cn(primary, "bg-white/5 border border-white/10 hover:bg-white/10 text-white")}>Set a goal</Link>
        </div>
    );
}

const quiet =
    "shrink-0 min-h-11 px-3 rounded-xl text-sm text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors focus-ring";

// Three steps to the first "safe to spend" figure. On a brand-new account it
// is the whole dashboard (with the larger heading); after that it sits
// above the figures until every step is done. Folded, it is one line.
export function GetStartedPanel({ state, userId, firstRun, view }: {
    state: OnboardingState;
    userId: string;
    firstRun: boolean;
    view: GetStartedView;
}) {
    if (view === "hidden") return null;

    if (view === "compact") {
        const next = state.next ? STEPS[state.next].title : null;
        return (
            <section aria-labelledby="get-started" className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-5 pr-2 py-2 rounded-2xl bg-graphite">
                <div className="flex-1 min-w-0 py-1.5">
                    <h2 id="get-started" className="text-sm font-semibold text-white">
                        Finish setting up <span className="font-normal text-zinc-400 tabular-nums">· {state.done} of {state.steps.length} done</span>
                    </h2>
                    {next && <p className="text-xs text-zinc-400">Next: {next.toLowerCase()}</p>}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setView(userId, "full")}
                        className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-white hover:bg-white/10 transition-colors focus-ring"
                    >
                        Continue <ArrowRight className="w-4 h-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => { setView(userId, "hidden"); focusPageHeading(); }} className={quiet}>
                        Hide
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section
            aria-labelledby="get-started"
            className={cn(
                "relative overflow-hidden p-5 md:p-7 rounded-3xl border",
                firstRun ? "bg-graphite border-white/[0.08]" : "bg-graphite border-transparent",
            )}
        >

            <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="get-started" className={cn("font-semibold text-white", firstRun ? "text-2xl md:text-3xl" : "text-lg")}>
                        {firstRun ? "Let's work out what you can spend each day" : "Finish setting up"}
                    </h2>
                    <p className="mt-1.5 text-sm text-zinc-300 max-w-prose">
                        {firstRun
                            ? "Three quick steps. FinAssist then shows a safe amount to spend each day until your next income."
                            : `${state.done} of ${state.steps.length} done.`}
                    </p>
                </div>
                <button type="button" onClick={() => { setView(userId, "compact"); focusPageHeading(); }} className={cn(quiet, "-mr-2")}>
                    {firstRun ? "Skip for now" : "Fold away"}
                </button>
            </div>

            <ol className="relative mt-6 space-y-3">
                {state.steps.map((s, i) => {
                    const copy = STEPS[s.key];
                    const current = s.key === state.next;
                    return (
                        <li
                            key={s.key}
                            className={cn(
                                "flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 p-4 rounded-2xl border",
                                current ? "bg-white/[0.05] border-plat/40" : "bg-black/20 border-white/5",
                            )}
                        >
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                <span
                                    aria-hidden
                                    className={cn(
                                        "shrink-0 grid place-items-center w-8 h-8 rounded-full text-sm font-semibold tabular-nums",
                                        s.done ? "bg-emerald-500/15 text-emerald-400" : current ? "bg-plat text-plat-ink" : "bg-white/5 text-zinc-400",
                                    )}
                                >
                                    {s.done ? <Check className="w-4 h-4" /> : i + 1}
                                </span>
                                <div className="min-w-0">
                                    <h3 className={cn("text-sm font-semibold", s.done ? "text-zinc-400 line-through decoration-zinc-600" : "text-white")}>
                                        {copy.title}
                                        <span className="sr-only">{s.done ? " (done)" : current ? " (next)" : ""}</span>
                                    </h3>
                                    {!s.done && <p className="mt-0.5 text-sm text-zinc-400 max-w-prose">{copy.body}</p>}
                                </div>
                            </div>
                            {!s.done && <div className="sm:shrink-0 pl-11 sm:pl-0"><StepAction step={s.key} current={current} /></div>}
                        </li>
                    );
                })}
            </ol>

        </section>
    );
}
