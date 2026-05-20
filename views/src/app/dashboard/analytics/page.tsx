"use client";

import { FinancialHealthScore } from "@/components/dashboard/analytics/FinancialHealthScore";
import { SmartTipsWidget }      from "@/components/dashboard/analytics/SmartTipsWidget";
import { SpendingComparisonChart } from "@/components/dashboard/analytics/SpendingComparisonChart";
import { HighSpendingAlerts }   from "@/components/dashboard/analytics/HighSpendingAlerts";
import { RecurringIncomeList }  from "@/components/dashboard/analytics/RecurringIncomeList";
import { ExpenseIncomeRatio }   from "@/components/dashboard/analytics/ExpenseIncomeRatio";
import { DashboardStatsStrip }  from "@/components/dashboard/analytics/DashboardStatsStrip";

export default function AnalyticsPage() {
    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <header className="mb-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">Analytics &amp; AI Insights</h1>
                <p className="text-zinc-400 text-sm mt-1">Deep dive into your financial habits.</p>
            </header>

            {/* Top strip — 4 quick stats (income, spend, savings rate, MoM change)
                plus a top-categories bar list below it. */}
            <DashboardStatsStrip />

            {/* Score / ratio / alerts row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FinancialHealthScore />
                <ExpenseIncomeRatio />
                <HighSpendingAlerts />
            </div>

            {/* Comparison chart + recurring income */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2"><SpendingComparisonChart /></div>
                <div className="lg:col-span-1"><RecurringIncomeList /></div>
            </div>

            {/* Smart tips full width */}
            <SmartTipsWidget />
        </div>
    );
}
