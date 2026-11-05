"use client";

import { motion } from "framer-motion";
import { CircleCheck, TriangleAlert, CircleAlert } from "lucide-react";
import type { MoneyFormatter } from "@/lib/money";
import { paceStatus } from "@/lib/runway";
import { cn } from "@/lib/utils";
import { CardLink, Card, StateNote } from "../ui";
import { LoadError } from "../LoadNotice";

export interface BudgetRow {
    _id: string;
    categoryName: string;
    limit: number;
    spent: number;
    isNearLimit?: boolean;
    isOverLimit?: boolean;
}

const EASE = [0.16, 1, 0.3, 1] as const;

// Each budget against an even pace through the month: the tick marks where
// someone spending evenly would be by today. Ahead of it is a nudge; past the
// limit is said plainly. State is in words with an icon, never colour alone.
export function BudgetPaceCard({
    budgets, loading, failed, onRetry, day, daysInMonth, fmt, className,
}: {
    budgets: BudgetRow[] | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    day: number;
    daysInMonth: number;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const fraction = day / daysInMonth;
    const rows = (budgets ?? [])
        .filter((b) => b.limit > 0)
        .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
        .slice(0, 4);

    return (
        <Card title="Budget pace" id="budget-pace" className={className}
            aside={rows.length > 0 ? <span className="label-caps text-zinc-400">Day {day} of {daysInMonth}</span> : undefined}>
            {loading ? (
                <div aria-hidden className="space-y-6">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-white/[0.05] animate-pulse" />)}</div>
            ) : failed ? (
                <LoadError what="your budgets" onRetry={onRetry} className="py-6" />
            ) : rows.length === 0 ? (
                <p className="text-sm text-zinc-400">No budgets this month yet. <CardLink href="/dashboard/budgets">Set one</CardLink></p>
            ) : (
                <>
                    <ul className="space-y-6">
                        {rows.map((b, i) => {
                            const status = paceStatus(b.spent, b.limit, fraction);
                            return (
                                <li key={b._id}>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="truncate font-semibold text-white">{b.categoryName}</span>
                                        {status === "over"
                                            ? <StateNote tone="bad" icon={CircleAlert}>Over by {fmt.format(b.spent - b.limit)}</StateNote>
                                            : status === "ahead"
                                                ? <StateNote tone="warn" icon={TriangleAlert}>Ahead of pace</StateNote>
                                                : <StateNote tone="good" icon={CircleCheck}>On pace</StateNote>}
                                    </div>
                                    <div aria-hidden className="relative mt-3 mb-2.5 h-2 rounded-full bg-plat/[0.12]">
                                        <motion.div
                                            className={cn("absolute inset-y-0 left-0 rounded-full", status === "over" ? "bg-red-400" : "bg-plat")}
                                            style={{ width: `${Math.min(100, (b.spent / b.limit) * 100)}%`, originX: 0 }}
                                            initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                                            transition={{ duration: 0.9, delay: 0.15 + i * 0.09, ease: EASE }}
                                        />
                                        <motion.span
                                            className="absolute -top-[5px] -bottom-[5px] w-[2px] -ml-px rounded-full bg-zinc-100"
                                            style={{ left: `${fraction * 100}%` }}
                                            initial={{ opacity: 0, y: -8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                                            transition={{ duration: 0.5, delay: 0.7 + i * 0.09, ease: EASE }}
                                        />
                                    </div>
                                    <p className="text-[12.5px] text-zinc-400 tabular-nums">
                                        {fmt.format(b.spent)} of {fmt.format(b.limit)} · {status === "over" ? "limit passed" : `${fmt.format(b.limit - b.spent)} left`}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-6 text-[12.5px] text-zinc-400 max-w-prose">The tick marks where you&apos;d be today if you spent evenly through the month.</p>
                    <div className="mt-2"><CardLink href="/dashboard/budgets">All budgets</CardLink></div>
                </>
            )}
        </Card>
    );
}
