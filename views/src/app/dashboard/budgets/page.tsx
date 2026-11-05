"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Copy, Loader2, TriangleAlert, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { BudgetForm } from "@/components/dashboard/budgets/BudgetForm";
import { BudgetCard } from "@/components/dashboard/budgets/BudgetCard";
import { LoadError } from "@/components/dashboard/LoadNotice";
import { Card, Empty, HeroFigure, Meter, Page, PageHeader, Skeleton, StateNote } from "@/components/dashboard/ui";
import { apiErrorMessage } from "@/lib/apiError";
import {
    summarizeBudgets, previousMonth, nextMonth, monthPace, type BudgetRow,
} from "@/components/dashboard/budgets/budgetModel";
import { useCurrency } from "@/lib/useCurrency";

export default function BudgetsPage() {
    const { format: fmt } = useCurrency();
    const [now] = useState(() => new Date());
    const [cursor, setCursor] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() + 1 }));
    const [copying, setCopying] = useState(false);
    const [copyMsg, setCopyMsg] = useState<string | null>(null);

    // Cached per month: flipping back to a month you've seen is instant.
    // Creating, editing or copying budgets is a write, which refreshes it.
    const tracking = useApi<{ budgets?: BudgetRow[] }>(`/budgets/tracking/${cursor.year}/${cursor.month}`);
    const loading = tracking.isLoading;
    const failed = tracking.error !== undefined;
    const rows = tracking.data?.budgets;
    const budgets = useMemo(() => rows ?? [], [rows]);
    const summary = useMemo(() => summarizeBudgets(budgets), [budgets]);

    const viewed = new Date(cursor.year, cursor.month - 1, 1);
    const monthLabel = format(viewed, "MMMM yyyy");
    const monthName = format(viewed, "MMMM");
    const prev = previousMonth(cursor.year, cursor.month);
    const prevLabel = format(new Date(prev.year, prev.month - 1, 1), "MMMM");
    const pace = monthPace(cursor.year, cursor.month, now);
    const current = cursor.year === now.getFullYear() && cursor.month === now.getMonth() + 1;
    const left = summary.totalLimit - summary.totalSpent;

    const refresh = () => { void tracking.refresh(); };
    const shiftMonth = (dir: -1 | 1) => {
        setCopyMsg(null);
        setCursor((c) => (dir === -1 ? previousMonth(c.year, c.month) : nextMonth(c.year, c.month)));
    };

    // Copy last month's active budgets into the viewed month (existing
    // categories are skipped server-side, so this never overwrites).
    const copyFromPrevious = async () => {
        setCopying(true);
        setCopyMsg(null);
        try {
            const res = await api.post("/budgets/reset", {
                fromMonth: prev.month, fromYear: prev.year,
                toMonth: cursor.month, toYear: cursor.year,
            });
            const n = (res.data?.data ?? []).length;
            setCopyMsg(n > 0 ? `Copied ${n} budget${n === 1 ? "" : "s"} from ${prevLabel}.` : `No ${prevLabel} budgets to copy.`);
            refresh();
        } catch (err) {
            setCopyMsg(apiErrorMessage(err, "Couldn't copy budgets."));
        } finally {
            setCopying(false);
        }
    };

    return (
        <Page>
            <PageHeader title="Budgets" sub="A limit for each category, measured against an even pace through the month.">
                <div role="group" aria-label="Month" className="inline-flex items-center p-[3px] rounded-full bg-white/[0.07]">
                    <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="btn-icon w-10 h-10 rounded-full">
                        <ChevronLeft className="w-4 h-4" aria-hidden />
                    </button>
                    <span aria-live="polite" className="px-2 min-w-[9rem] text-center text-[13px] font-semibold text-white tabular-nums">{monthLabel}</span>
                    <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="btn-icon w-10 h-10 rounded-full">
                        <ChevronRight className="w-4 h-4" aria-hidden />
                    </button>
                </div>
            </PageHeader>

            {/* The month's answer on the left, the way to add a limit beside it. */}
            <div className="grid gap-6 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] items-center py-2 md:py-4">
                {loading ? (
                    <HeroFigure label={`Left to spend in ${monthName}`} value={null} loading />
                ) : failed && budgets.length === 0 ? (
                    <Card className="self-stretch grid content-center"><LoadError what="your budgets" onRetry={refresh} /></Card>
                ) : budgets.length === 0 ? (
                    // As tall as the form beside it, tops and bottoms level.
                    <Card className="self-stretch grid content-center">
                        <Empty
                            icon={Wallet}
                            title={`No budgets for ${monthLabel}`}
                            action={
                                <button type="button" onClick={copyFromPrevious} disabled={copying} className="btn-secondary">
                                    {copying ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
                                    Copy from {prevLabel}
                                </button>
                            }
                        >
                            Set a limit for a category, or reuse {prevLabel}&apos;s.
                        </Empty>
                        {copyMsg && <p role="status" className="-mt-6 pb-4 text-center text-[12.5px] text-zinc-400">{copyMsg}</p>}
                    </Card>
                ) : (
                    <HeroFigure
                        label={left >= 0 ? `Left to spend in ${monthName}` : `Over your budgets in ${monthName}`}
                        value={fmt(Math.abs(left))}
                    >
                        <p className="tabular-nums">
                            {fmt(summary.totalSpent)} spent of {fmt(summary.totalLimit)} across {budgets.length} budget{budgets.length === 1 ? "" : "s"}.
                        </p>
                        <Meter
                            fraction={summary.totalLimit > 0 ? summary.totalSpent / summary.totalLimit : 0}
                            tone={left < 0 ? "bad" : "plat"}
                            tick={current ? pace : undefined}
                            className="mt-5 max-w-md"
                        />
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                            {summary.overCount > 0 && <StateNote tone="bad" icon={CircleAlert}>{summary.overCount} over {summary.overCount === 1 ? "its" : "their"} limit</StateNote>}
                            {summary.nearCount > 0 && <StateNote tone="warn" icon={TriangleAlert}>{summary.nearCount} past {summary.nearCount === 1 ? "its" : "their"} alert</StateNote>}
                            {summary.overCount === 0 && summary.nearCount === 0 && <StateNote tone="good" icon={CircleCheck}>Within every budget</StateNote>}
                            {current && <span className="text-[12.5px] text-zinc-400">The tick is where an even pace would be today.</span>}
                        </div>
                    </HeroFigure>
                )}
                <BudgetForm month={cursor.month} year={cursor.year} monthLabel={monthLabel} onSuccess={refresh} />
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[196px] rounded-3xl" />)}
                </div>
            ) : budgets.length > 0 && (
                <section aria-label={`${monthLabel} budgets`} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {budgets.map((budget, i) => (
                        <BudgetCard key={budget._id} budget={budget} pace={pace} current={current} index={i} onChanged={refresh} />
                    ))}
                </section>
            )}
        </Page>
    );
}
