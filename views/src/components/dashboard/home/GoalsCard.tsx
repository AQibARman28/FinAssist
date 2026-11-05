"use client";

import { motion } from "framer-motion";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { goalStatus, type GoalPlanRow, type GoalTone } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { CardLink, Card, Missing, StateNote } from "../ui";
import { LoadError } from "../LoadNotice";

const ICON: Record<GoalTone, typeof CircleCheck | undefined> = {
    good: CircleCheck, done: CircleCheck, warn: TriangleAlert, bad: CircleAlert, neutral: undefined,
};
const TONE: Record<GoalTone, "good" | "warn" | "bad" | "neutral"> = {
    good: "good", done: "good", warn: "warn", bad: "warn", neutral: "neutral",
};

// Are the goals reachable, in plain words from the savings plan, plus what is
// already set aside. A goal out of reach is said so (PRODUCT.md › Plan from
// real money), with what it would take.
export function GoalsCard({
    goals, monthlySurplus, savings, loading, failed, onRetry, savingsLoading, savingsFailed, now, fmt, className,
}: {
    goals: (GoalPlanRow & { goalId: string })[] | undefined;
    monthlySurplus: number;
    savings: number | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    savingsLoading: boolean;
    savingsFailed: boolean;
    now: Date;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const shown = (goals ?? []).slice(0, 3);
    const inGoals = (goals ?? []).reduce((s, g) => s + (g.currentAmount || 0), 0);

    return (
        <Card title="Goals" id="goals" action={shown.length > 0 ? { href: "/dashboard/goals", label: "Savings plan" } : undefined} className={className}>
            {loading ? (
                <div aria-hidden className="space-y-6">{[0, 1].map((i) => <div key={i} className="h-14 rounded-lg bg-white/[0.05] animate-pulse" />)}</div>
            ) : failed ? (
                <LoadError what="your goals" onRetry={onRetry} className="py-6" />
            ) : shown.length === 0 ? (
                <p className="text-sm text-zinc-400">No goals yet. <CardLink href="/dashboard/goals">Set a goal</CardLink></p>
            ) : (
                <ul className="space-y-6">
                    {shown.map((g, i) => {
                        const status = goalStatus(g, monthlySurplus, fmt, now);
                        const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
                        return (
                            <li key={g.goalId}>
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="truncate font-semibold text-white">{g.title}</span>
                                    <span className="shrink-0 text-[13px] text-zinc-400 tabular-nums">{fmt.format(g.currentAmount)} of {fmt.format(g.targetAmount)}</span>
                                </div>
                                <div aria-hidden className="relative mt-3 mb-2.5 h-2 rounded-full bg-plat/[0.12] overflow-hidden">
                                    <motion.div
                                        className="absolute inset-y-0 left-0 rounded-full bg-plat"
                                        style={{ width: `${pct}%`, originX: 0 }}
                                        initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                                        transition={{ duration: 0.9, delay: 0.15 + i * 0.09, ease: [0.16, 1, 0.3, 1] }}
                                    />
                                </div>
                                <StateNote tone={TONE[status.tone]} icon={ICON[status.tone]} className="items-start [&>svg]:mt-[2px] tabular-nums">
                                    <span>{status.text}</span>
                                </StateNote>
                            </li>
                        );
                    })}
                </ul>
            )}

            <dl className="mt-6 pt-5 border-t border-white/[0.07] grid grid-cols-2 gap-4">
                <div>
                    <dt className="label-caps text-zinc-400">In savings</dt>
                    <dd className="mt-1.5 font-semibold text-white tabular-nums">
                        {savingsLoading ? <span aria-hidden className="inline-block h-4 w-16 rounded bg-white/[0.05] animate-pulse align-middle" />
                            : savingsFailed || savings === undefined ? <Missing /> : fmt.format(savings)}
                    </dd>
                </div>
                <div>
                    <dt className="label-caps text-zinc-400">Saved in goals</dt>
                    <dd className="mt-1.5 font-semibold text-white tabular-nums">
                        {loading ? <span aria-hidden className="inline-block h-4 w-16 rounded bg-white/[0.05] animate-pulse align-middle" />
                            : failed ? <Missing /> : fmt.format(inGoals)}
                    </dd>
                </div>
            </dl>
            <p className="mt-3 text-[12.5px] text-zinc-400 max-w-prose">
                Savings is money set aside from your wallet. Goal money is what you&apos;ve put towards a particular goal.
            </p>
        </Card>
    );
}
