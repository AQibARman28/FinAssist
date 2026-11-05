"use client";

import Link from "next/link";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { MoneyFormatter } from "@/lib/money";
import { Card, Meter, Skeleton, StateNote } from "../ui";
import { LoadError } from "../LoadNotice";

// GET /analytics/expense-income-ratio: this calendar month.
export interface RatioData {
    totalIncome: number;
    totalExpense: number;
    ratio: number | null;       // null when totalIncome is 0
}

// Below this share of income spent, the health score's expense-to-income
// factor gives full marks (services/healthScore.js); past it, points go.
const COMFORT = 0.7;

// How much of this month's income has gone, as one meter and in words. The
// tick is the line the health score treats as comfortable.
export function ExpenseIncomeRatio({ ratio, loading, failed, onRetry, fmt, className }: {
    ratio: RatioData | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    fmt: MoneyFormatter;
    className?: string;
}) {
    return (
        <Card title="Spending vs income" id="spending-vs-income" className={className} aside={<span className="label-caps text-zinc-400">This month</span>}>
            {loading ? (
                <div aria-hidden className="space-y-5"><Skeleton className="h-11 w-40 rounded-xl" /><Skeleton className="h-2 rounded-full" /><Skeleton className="h-4 w-56 rounded-md" /></div>
            ) : failed || !ratio ? (
                <LoadError what="your spending against income" onRetry={onRetry} className="py-6" />
            ) : ratio.ratio === null ? (
                <>
                    <p className="font-semibold text-white">No income this month yet</p>
                    <p className="mt-1.5 text-[13.5px] text-zinc-400 max-w-prose tabular-nums">
                        {ratio.totalExpense > 0
                            ? <>You&apos;ve spent {fmt.format(ratio.totalExpense)}. Log an income to see what share of it that is.</>
                            : "Log an income and this shows how much of it you've spent."}
                    </p>
                    <Link href="/dashboard/income/new" className="btn-secondary mt-5">Log income</Link>
                </>
            ) : (
                <RatioBody ratio={ratio} r={ratio.ratio} fmt={fmt} />
            )}
        </Card>
    );
}

function RatioBody({ ratio, r, fmt }: { ratio: RatioData; r: number; fmt: MoneyFormatter }) {
    const pct = Math.round(r * 100);
    const left = ratio.totalIncome - ratio.totalExpense;
    const over = r > 1;
    const tight = !over && r >= COMFORT;
    return (
        <>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[2.75rem] leading-none font-light [font-stretch:112%] tabular-nums text-white">{pct}%</span>
                <span className="text-[13.5px] text-zinc-300">of this month&apos;s income spent</span>
            </p>
            <Meter fraction={Math.min(1, r)} tone={over ? "bad" : tight ? "warn" : "plat"} tick={COMFORT} className="mt-6" />
            <p className="mt-3 text-[12.5px] text-zinc-400 tabular-nums">
                {fmt.format(ratio.totalExpense)} spent of {fmt.format(ratio.totalIncome)} income
            </p>
            <div className="mt-4">
                {over
                    ? <StateNote tone="bad" icon={CircleAlert}>{fmt.format(-left)} more spent than came in</StateNote>
                    : tight
                        ? <StateNote tone="warn" icon={TriangleAlert}>Only {fmt.format(left)} of income left</StateNote>
                        : <StateNote tone="good" icon={CircleCheck}>{fmt.format(left)} of income left</StateNote>}
            </div>
            <p className="mt-5 text-[12.5px] text-zinc-400 max-w-prose">
                The tick is {Math.round(COMFORT * 100)}%: the health score counts spending below that share of income as comfortable.
            </p>
        </>
    );
}
