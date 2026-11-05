"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { History } from "lucide-react";
import { QuickAddBar } from "@/components/dashboard/expenses/QuickAddBar";
import { ExpenseForm } from "@/components/dashboard/expenses/ExpenseForm";
import { ExpenseList } from "@/components/dashboard/expenses/ExpenseList";
import { HeroFigure, Missing, Page, PageHeader, Term } from "@/components/dashboard/ui";
import { LoadNotice } from "@/components/dashboard/LoadNotice";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { monthSoFar } from "@/lib/dates";
import { summarizeLoadState } from "@/lib/loadState";

// A Term's figure while it loads: a block the size of the amount.
function TermSkeleton() {
    return <span aria-hidden className="inline-block h-[0.9em] w-28 rounded-md bg-white/[0.05] animate-pulse align-middle" />;
}

// The fine print under a Term's figure, back at reading width and weight.
function TermNote({ children }: { children: React.ReactNode }) {
    return <span className="block mt-2 text-[12.5px] leading-[1.45] font-normal [font-stretch:100%] text-zinc-400">{children}</span>;
}

// Expenses: what this month has cost so far, a line to add the next one,
// every field when a line isn't enough, then the newest expenses.
export default function ExpensesPage() {
    const fmt = useCurrency();
    const [now] = useState(() => new Date());
    const soFar = monthSoFar(now);
    // Every add, edit or delete on this page is a write through lib/api.ts,
    // which refreshes these figures (and the list) on its own.
    const summary = useApi<{ totalSpent?: number }>(`/expenses/summary/${now.getFullYear()}/${now.getMonth() + 1}`);
    const balance = useApi<{ monthly?: { saved?: number } }>("/analytics/balance");

    const totalSpent = summary.data ? (summary.data.totalSpent || 0) : undefined;
    const dailyAverage = totalSpent !== undefined ? totalSpent / now.getDate() : undefined; // average so far, today included
    // Saved into goals this month: set aside, not spent.
    const saved = balance.data ? (balance.data.monthly?.saved || 0) : undefined;

    const reads = [summary, balance];
    const loadState = summarizeLoadState(reads);
    const retryFailed = () => { for (const r of reads) if (r.error !== undefined || r.refreshFailed) void r.refresh(); };

    // The quick add hands over to the full form: bring it into view and put
    // the cursor in its first field.
    const goToForm = () => {
        const form = document.getElementById("expense-detail-form");
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        form?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
        form?.querySelector("input")?.focus({ preventScroll: true });
    };

    const averageNote = soFar.day === 1 ? "Today so far" : `Over the ${soFar.day} days so far`;

    return (
        <Page>
            <PageHeader title="Expenses" sub="What this month has cost so far. Add an expense in one line, or with every detail.">
                <Link href="/dashboard/expenses/history" className="btn-secondary">
                    <History className="w-4 h-4" aria-hidden /> Transaction history
                </Link>
            </PageHeader>

            <div className="empty:hidden"><LoadNotice state={loadState} onRetry={retryFailed} /></div>

            {/* The figure, then the line to add to it: on wide screens side by
                side, the way the dashboard sets its hero beside the wallet. The
                top padding sets the hero's label level with the card's heading. */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 lg:items-start">
                <div className="lg:col-span-7 lg:pt-11 flex flex-col gap-7">
                    <HeroFigure
                        label={`Spent in ${format(now, "MMMM")}`}
                        value={totalSpent !== undefined ? fmt.format(totalSpent) : null}
                        loading={summary.isLoading}
                        failed={summary.error !== undefined}
                    >
                        {totalSpent === undefined ? null : totalSpent === 0
                            ? "Nothing recorded yet this month."
                            : `Everything you've recorded, ${soFar.label}.`}
                    </HeroFigure>
                    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 max-w-lg">
                        <Term label="Daily average">
                            {summary.isLoading ? <TermSkeleton /> : dailyAverage === undefined ? <Missing /> : fmt.format(dailyAverage)}
                            <TermNote>{averageNote}</TermNote>
                        </Term>
                        <Term label="Saved in goals">
                            {balance.isLoading ? <TermSkeleton /> : saved === undefined ? <Missing /> : fmt.format(saved)}
                            <TermNote>Set aside this month, not spent</TermNote>
                        </Term>
                    </dl>
                </div>

                <QuickAddBar className="lg:col-span-5" onUseForm={goToForm} />
            </div>

            <div id="expense-detail-form">
                <ExpenseForm />
            </div>

            <ExpenseList />
        </Page>
    );
}
