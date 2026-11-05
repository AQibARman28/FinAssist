"use client";

import { TriangleAlert } from "lucide-react";
import type { MoneyFormatter } from "@/lib/money";
import { Card, Empty, Skeleton, StateNote } from "../ui";
import { LoadError } from "../LoadNotice";

// One row of GET /analytics/high-spending: a category whose total over the
// last 3 months is more than 1.5× the average across the user's categories.
export interface SpendingAlert {
    _id: string;
    category: string;
    categoryColor: string;
    categoryIcon: string;
    total: number;
}

// Categories running well above the others, as rows in the money-list style:
// the category with its swatch, a warning in words, the 3-month total.
export function HighSpendingAlerts({ alerts, loading, failed, onRetry, fmt, className }: {
    alerts: SpendingAlert[] | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    fmt: MoneyFormatter;
    className?: string;
}) {
    const rows = alerts ?? [];
    return (
        <Card title="Unusual spending" id="unusual-spending" className={className} aside={<span className="label-caps text-zinc-400">Last 3 months</span>}>
            {loading ? (
                <div aria-hidden className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : failed ? (
                <LoadError what="your spending alerts" onRetry={onRetry} className="py-6" />
            ) : rows.length === 0 ? (
                <Empty title="Nothing unusual" className="py-8">
                    No category is running well above your others over the last 3 months.
                </Empty>
            ) : (
                <>
                    <ul>
                        {rows.map((item) => (
                            <li key={item._id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3.5 border-t border-white/[0.07] first:border-t-0 first:pt-0">
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: item.categoryColor }} />
                                        <span className="truncate font-semibold text-white">{item.category}</span>
                                    </span>
                                    <StateNote tone="warn" icon={TriangleAlert} className="mt-1 items-start [&>svg]:mt-[1px]">
                                        Over 1.5× your average category
                                    </StateNote>
                                </span>
                                <span className="font-medium text-white tabular-nums shrink-0">{fmt.format(item.total)}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="mt-5 text-[12.5px] text-zinc-400 max-w-prose">
                        A category shows here when its total over the last 3 months is more than 1.5 times the average across your categories.
                    </p>
                </>
            )}
        </Card>
    );
}
