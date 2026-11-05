"use client";

import { useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { calendarDay } from "@/lib/dates";
import { nextIncomeDate } from "@/lib/dashboard";
import type { MoneyFormatter } from "@/lib/money";
import { Card, Empty, Skeleton } from "../ui";
import { LoadError } from "../LoadNotice";

// One template from GET /analytics/recurring-income. `date` is the day the
// template was set to start; each payment follows from it.
export interface RecurringItem {
    _id: string;
    amount: number;
    frequency: "weekly" | "biweekly" | "monthly" | "yearly";
    isPostTax: boolean;
    category: string;
    categoryColor: string;
    categoryIcon: string;
    date: string;
    monthlyEquivalent: number;
    annualEquivalent:  number;
}

export interface RecurringIncome {
    items?: RecurringItem[];
    monthlyTotal?: number;
}

const CADENCE: Record<RecurringItem["frequency"], string> = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
    yearly: "Yearly",
};

// Every recurring income in the order it next arrives: the day set large on
// the left, the source, its cadence as a caption, the amount on the right.
export function RecurringIncomeList({ data, loading, failed, onRetry, now, fmt, className }: {
    data: RecurringIncome | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    now: Date;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const rows = useMemo(() => (data?.items ?? [])
        .map((it) => ({ ...it, next: nextIncomeDate([it], now) ?? calendarDay(it.date) }))
        .sort((a, b) => a.next.getTime() - b.next.getTime()), [data, now]);
    const monthlyTotal = data?.monthlyTotal ?? 0;

    return (
        <Card title="Recurring income" id="recurring-income" className={className}
            action={rows.length > 0 ? { href: "/dashboard/income", label: "All income" } : undefined}>
            {loading ? (
                <div aria-hidden className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : failed ? (
                <LoadError what="your recurring income" onRetry={onRetry} className="py-6" />
            ) : rows.length === 0 ? (
                <Empty
                    title="No recurring income yet"
                    className="py-8"
                    action={<Link href="/dashboard/income/new" className="btn-primary">Add income</Link>}
                >
                    Add an income with Recurring switched on and it shows here.
                </Empty>
            ) : (
                <>
                    <ul>
                        {rows.map((it) => (
                            <li key={it._id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 py-3.5 border-t border-white/[0.07] first:border-t-0 first:pt-0">
                                <span aria-hidden className="grid justify-items-center leading-none text-zinc-400">
                                    <b className="text-[23px] font-light [font-stretch:112%] text-white">{it.next.getDate()}</b>
                                    <span className="mt-1.5 text-[10.5px] font-medium tracking-[0.14em] [font-stretch:118%] uppercase">{format(it.next, "MMM")}</span>
                                </span>
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: it.categoryColor }} />
                                        <span className="truncate font-semibold text-white">{it.category}</span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-[12.5px] text-zinc-400">
                                        {CADENCE[it.frequency] ?? it.frequency} · next {format(it.next, "EEE d MMM")}{!it.isPostTax && " · before tax"}
                                    </span>
                                </span>
                                <span className="text-right shrink-0">
                                    <span className="block font-medium text-white tabular-nums">{fmt.format(it.amount)}</span>
                                    {it.frequency !== "monthly" && (
                                        <span className="mt-0.5 block text-[12.5px] text-zinc-400 tabular-nums">≈ {fmt.format(it.monthlyEquivalent)} a month</span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <dl className="mt-5 pt-4 border-t border-white/[0.07] flex items-baseline justify-between gap-4">
                        <dt className="label-caps text-zinc-400">A month, on average</dt>
                        <dd className="text-[22px] leading-none font-light [font-stretch:112%] tabular-nums text-white">{fmt.format(monthlyTotal)}</dd>
                    </dl>
                </>
            )}
        </Card>
    );
}
