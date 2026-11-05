"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Page, PageHeader } from "@/components/dashboard/ui";
import { LoadNotice } from "@/components/dashboard/LoadNotice";
import { ThisMonthHero, type DashboardStats } from "@/components/dashboard/analytics/DashboardStatsStrip";
import { SpendingComparisonChart, type MonthlyAnalytics } from "@/components/dashboard/analytics/SpendingComparisonChart";
import { FinancialHealthScore, type HealthData } from "@/components/dashboard/analytics/FinancialHealthScore";
import { ExpenseIncomeRatio, type RatioData } from "@/components/dashboard/analytics/ExpenseIncomeRatio";
import { HighSpendingAlerts, type SpendingAlert } from "@/components/dashboard/analytics/HighSpendingAlerts";
import { RecurringIncomeList, type RecurringIncome } from "@/components/dashboard/analytics/RecurringIncomeList";
import { SmartTipsWidget, type Tip } from "@/components/dashboard/analytics/SmartTipsWidget";
import { useApi } from "@/lib/useApi";
import { useCurrency } from "@/lib/useCurrency";
import { summarizeLoadState } from "@/lib/loadState";

// Analytics (DESIGN.md › Timeline): this month's spending as the headline,
// then where it moved by category beside the health score, the month's
// spending against income, anything unusual, the income that repeats, and
// what to change. The server's figures use the calendar month in UTC, so the
// month names here do too.
export default function AnalyticsPage() {
    const fmt = useCurrency();
    const [now] = useState(() => new Date());
    const [period] = useState(() => ({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }));

    // Each read is cached (lib/useApi.ts) and independent: one slow or failed
    // endpoint holds up only its own card.
    const stats     = useApi<DashboardStats>("/analytics/dashboard-stats");
    const monthly   = useApi<MonthlyAnalytics>("/analytics/monthly-analytics", period);
    const health    = useApi<HealthData>("/ai/financial-health-score");
    const ratio     = useApi<RatioData>("/analytics/expense-income-ratio");
    const alerts    = useApi<SpendingAlert[]>("/analytics/high-spending");
    const recurring = useApi<RecurringIncome>("/analytics/recurring-income");
    const tips      = useApi<Tip[]>("/ai/smart-tips");

    const reads = [stats, monthly, health, ratio, alerts, recurring, tips];
    const loadState = summarizeLoadState(reads);
    const retryFailed = () => {
        for (const r of reads) if (r.error !== undefined || r.refreshFailed) void r.refresh();
    };

    const monthStart = new Date(period.year, period.month - 1, 1);
    const lastMonthName = format(new Date(period.year, period.month - 2, 1), "MMMM");
    const day = Math.max(1, now.getUTCDate());
    const soFarLabel = day === 1 ? `1 ${format(monthStart, "MMM")}` : `1–${day} ${format(monthStart, "MMM")}`;

    return (
        <Page>
            <PageHeader title="Analytics" sub="How this month's money moved against last month, and what to change." />
            <LoadNotice state={loadState} onRetry={retryFailed} />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-6 [&>*]:min-w-0">
                <ThisMonthHero
                    className="md:col-span-2 lg:col-span-12"
                    stats={stats.data}
                    loading={stats.isLoading}
                    failed={stats.error !== undefined}
                    lastMonthName={lastMonthName}
                    daysSoFar={day}
                    fmt={fmt}
                />

                <SpendingComparisonChart
                    className="md:col-span-2 lg:col-span-8"
                    monthly={monthly.data}
                    loading={monthly.isLoading}
                    failed={monthly.error !== undefined}
                    onRetry={() => void monthly.refresh()}
                    soFarLabel={soFarLabel}
                    lastMonthName={lastMonthName}
                    fmt={fmt}
                />
                <FinancialHealthScore
                    className="md:col-span-2 lg:col-span-4"
                    health={health.data}
                    loading={health.isLoading}
                    failed={health.error !== undefined}
                    onRetry={() => void health.refresh()}
                />

                <ExpenseIncomeRatio
                    className="md:col-span-1 lg:col-span-4"
                    ratio={ratio.data}
                    loading={ratio.isLoading}
                    failed={ratio.error !== undefined}
                    onRetry={() => void ratio.refresh()}
                    fmt={fmt}
                />
                <HighSpendingAlerts
                    className="md:col-span-1 lg:col-span-4"
                    alerts={alerts.data}
                    loading={alerts.isLoading}
                    failed={alerts.error !== undefined}
                    onRetry={() => void alerts.refresh()}
                    fmt={fmt}
                />
                <RecurringIncomeList
                    className="md:col-span-2 lg:col-span-4"
                    data={recurring.data}
                    loading={recurring.isLoading}
                    failed={recurring.error !== undefined}
                    onRetry={() => void recurring.refresh()}
                    now={now}
                    fmt={fmt}
                />

                <SmartTipsWidget
                    className="md:col-span-2 lg:col-span-12"
                    tips={tips.data}
                    loading={tips.isLoading}
                    failed={tips.error !== undefined}
                    onRetry={() => void tips.refresh()}
                />
            </div>
        </Page>
    );
}
