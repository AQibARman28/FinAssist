"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay } from "@/lib/dates";
import { ColumnChart, type ColumnRow } from "../ColumnChart";
import { Card, Empty, Segmented, Skeleton } from "../ui";
import { LoadError } from "../LoadNotice";

export type IncomeGranularity = "monthly" | "yearly";

interface Bucket { period: string; label: string; total: number; }
interface TimelineData { granularity: IncomeGranularity; buckets: Bucket[]; grandTotal: number; }

const GRANULARITY: { key: IncomeGranularity; label: string }[] = [
    { key: "monthly", label: "Monthly" },
    { key: "yearly", label: "Yearly" },
];

// Income over time as platinum columns (DESIGN.md › Bars): this year month by
// month, or the last few years. The column read first is the current period,
// the last one; the server counts it only up to today.
export function IncomeChart({ granularity, onGranularity, className }: {
    granularity: IncomeGranularity;
    onGranularity: (g: IncomeGranularity) => void;
    className?: string;
}) {
    const money = useCurrency();

    // One cache entry per granularity: switching back and forth is instant.
    const timeline = useApi<TimelineData>("/incomes/timeline", { granularity });

    const rows = useMemo<ColumnRow[]>(
        () => (timeline.data?.buckets ?? []).map((b) => ({
            key: b.period,
            label: b.label,
            // Buckets start at UTC midnight; calendarDay keeps the month the server meant.
            title: granularity === "monthly" ? format(calendarDay(b.period), "MMMM yyyy") : b.label,
            values: [b.total],
        })),
        [timeline.data, granularity],
    );
    const hasAny = rows.some((r) => r.values[0] > 0);
    const title = granularity === "monthly" ? "Income by month" : "Income by year";
    const span = rows.length > 0 ? `${rows[0].title ?? rows[0].label} to ${rows[rows.length - 1].title ?? rows[rows.length - 1].label}` : "";

    return (
        <Card
            title={title}
            id="income-chart"
            className={className}
            aside={<Segmented label="Show income" items={GRANULARITY} value={granularity} onChange={onGranularity} />}
        >
            {timeline.isLoading ? (
                <div aria-hidden className="space-y-4">
                    <div className="flex justify-end"><Skeleton className="h-[60px] w-40 rounded-xl" /></div>
                    <Skeleton className="h-[220px] md:h-[260px] rounded-xl" />
                </div>
            ) : timeline.error !== undefined ? (
                <LoadError what="your income over time" onRetry={() => void timeline.refresh()} className="py-16" />
            ) : !hasAny ? (
                <Empty title={granularity === "monthly" ? "No income recorded this year" : "No income recorded in recent years"} className="py-20">
                    Each {granularity === "monthly" ? "month" : "year"} you record income gets a column here.
                </Empty>
            ) : (
                <>
                    <ColumnChart
                        rows={rows}
                        series={[{ label: "Income", tone: "plat" }]}
                        fmt={money}
                        title={`${title}, ${span}`}
                        initial={rows.length - 1}
                    />
                    <p className="mt-3 text-[12.5px] text-zinc-400">
                        {granularity === "monthly" ? "This month" : "This year"} counts income received up to today.
                    </p>
                </>
            )}
        </Card>
    );
}
