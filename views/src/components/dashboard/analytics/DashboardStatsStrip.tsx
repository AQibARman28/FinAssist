"use client";

import { ArrowDownRight, CircleAlert, Info, Minus, TriangleAlert } from "lucide-react";
import type { MoneyFormatter } from "@/lib/money";
import { cn } from "@/lib/utils";
import { HeroFigure, Missing, Skeleton, StateNote, Term } from "../ui";

interface TopCategory {
    categoryId: string;
    category: string;
    categoryColor: string;
    categoryIcon: string;
    total: number;
    count: number;
    percentage: number;
}

// GET /analytics/dashboard-stats: this calendar month (UTC) against last.
export interface DashboardStats {
    totalIncome:           number;
    totalExpense:          number;
    totalPrevious:         number;
    monthlyRecurringIncome: number;
    savingsRate:           number | null;
    dailyAverage:          number;
    monthOverMonthDelta:   number;
    monthOverMonthPct:     number | null;
    topCategories:         TopCategory[];
}

// 0.054 -> "5.4%", 0.38 -> "38%"; small changes keep one decimal.
const pct = (n: number) => `${(Math.abs(n) * 100).toFixed(n > -0.1 && n < 0.1 ? 1 : 0)}%`;
const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${pct(n)}`;

// The line under a term: regular width and size, under the term's figure.
function Caption({ children, className }: { children: React.ReactNode; className?: string }) {
    return <span className={cn("block mt-2 text-[12.5px] leading-snug font-normal [font-stretch:100%] text-zinc-400", className)}>{children}</span>;
}

// How this month compares with all of last month, in words. This month is
// still running, so "less" is said as "so far" and only "more" is a warning.
function Comparison({ stats, lastMonthName, fmt }: { stats: DashboardStats; lastMonthName: string; fmt: MoneyFormatter }) {
    const cls = "text-[14px] md:text-[15px] text-zinc-200 [&>svg]:w-4 [&>svg]:h-4";
    if (stats.totalPrevious === 0) {
        return <StateNote tone="neutral" icon={Info} className={cls}>Nothing recorded in {lastMonthName} to compare with</StateNote>;
    }
    const d = stats.monthOverMonthDelta;
    if (d > 0) return <StateNote tone="warn" icon={TriangleAlert} className={cls}>Already {fmt.format(d)} more than all of {lastMonthName}</StateNote>;
    if (d < 0) return <StateNote tone="neutral" icon={ArrowDownRight} className={cls}>So far {fmt.format(-d)} less than all of {lastMonthName}</StateNote>;
    return <StateNote tone="neutral" icon={Minus} className={cls}>So far the same as all of {lastMonthName}</StateNote>;
}

// The page's headline: what this month has cost so far, how that sits
// against last month, and the figures that explain it (income, savings rate,
// the daily average and the change) as a row of terms, not tiles.
export function ThisMonthHero({
    stats, loading, failed, lastMonthName, daysSoFar, fmt, className,
}: {
    stats: DashboardStats | undefined;
    loading: boolean;
    failed: boolean;
    lastMonthName: string;   // "October"
    daysSoFar: number;       // days of this month the average covers
    fmt: MoneyFormatter;
    className?: string;
}) {
    const ready = !loading && !failed && !!stats;
    const term = (render: (s: DashboardStats) => React.ReactNode) =>
        loading ? <Skeleton className="h-[26px] w-24 rounded-lg" />
            : failed || !stats ? <Missing />
            : render(stats);

    return (
        <section aria-label="This month so far" className={cn("grid gap-8 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-end py-2 md:py-4", className)}>
            <HeroFigure
                label="Spent this month"
                value={ready ? fmt.format(stats.totalExpense) : null}
                loading={loading}
                failed={failed || (!loading && !stats)}
            >
                {ready && <Comparison stats={stats} lastMonthName={lastMonthName} fmt={fmt} />}
            </HeroFigure>

            <dl className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-2 gap-x-6 gap-y-7">
                <Term label="Income">
                    {term((s) => <>
                        {fmt.format(s.totalIncome)}
                        <Caption>{s.monthlyRecurringIncome > 0 ? `${fmt.format(s.monthlyRecurringIncome)} a month recurring` : "No recurring income"}</Caption>
                    </>)}
                </Term>
                <Term label="Savings rate">
                    {term((s) => s.savingsRate === null ? <>
                        <span aria-hidden className="text-zinc-500">—</span><span className="sr-only">None yet</span>
                        <Caption>Log an income to see this</Caption>
                    </> : <>
                        {s.savingsRate < 0 ? "−" : ""}{pct(s.savingsRate)}
                        {s.savingsRate >= 0
                            ? <Caption>{fmt.format(s.totalIncome - s.totalExpense)} not spent</Caption>
                            : <Caption><StateNote tone="bad" icon={CircleAlert}>{fmt.format(s.totalExpense - s.totalIncome)} over income</StateNote></Caption>}
                    </>)}
                </Term>
                <Term label="Daily average">
                    {term((s) => <>
                        {fmt.format(s.dailyAverage)}
                        <Caption>Over {daysSoFar} {daysSoFar === 1 ? "day" : "days"} so far</Caption>
                    </>)}
                </Term>
                <Term label={`vs ${lastMonthName}`}>
                    {term((s) => s.monthOverMonthPct === null ? <>
                        <span aria-hidden className="text-zinc-500">—</span><span className="sr-only">No change to show</span>
                        <Caption>Nothing to compare with</Caption>
                    </> : <>
                        {signedPct(s.monthOverMonthPct)}
                        <Caption>Against all of {lastMonthName}</Caption>
                    </>)}
                </Term>
            </dl>
        </section>
    );
}
