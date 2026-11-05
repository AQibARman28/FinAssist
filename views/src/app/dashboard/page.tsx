"use client";

import { useMemo, useState } from "react";
import { format, getDaysInMonth } from "date-fns";
import { Plus } from "lucide-react";
import { RecentTransactions, type Transaction, type TransactionCategory } from "@/components/dashboard/RecentTransactions";
import { MonthEndCard } from "@/components/dashboard/MonthEndCard";
import { LoadError, LoadNotice } from "@/components/dashboard/LoadNotice";
import { Card } from "@/components/dashboard/ui";
import { SafeToSpendHero } from "@/components/dashboard/home/SafeToSpendHero";
import { WalletCard } from "@/components/dashboard/home/WalletCard";
import { RunwayChart } from "@/components/dashboard/home/RunwayChart";
import { WhereItWentCard, type WhereMonth } from "@/components/dashboard/home/WhereItWentCard";
import { BudgetPaceCard, type BudgetRow } from "@/components/dashboard/home/BudgetPaceCard";
import { GoalsCard } from "@/components/dashboard/home/GoalsCard";
import { HealthCard, type Health } from "@/components/dashboard/home/HealthCard";
import { GetStartedPanel, useGetStartedView } from "@/components/dashboard/home/GetStartedPanel";
import { SecurityBadge } from "@/components/dashboard/home/SecurityBadge";
import { useApi } from "@/lib/useApi";
import { onboardingState } from "@/lib/onboarding";
import { useCategories } from "@/lib/useCategories";
import { useCurrency } from "@/lib/useCurrency";
import { monthSoFar } from "@/lib/dates";
import { incomePeriod, nextIncomeDate, safeToSpend, type GoalPlanRow, type IncomeTemplate } from "@/lib/dashboard";
import { buildRunway, runwayRange, walletTrace, type RunwayEntry, type RunwayIncome, type SavingsTransfer } from "@/lib/runway";
import { summarizeLoadState } from "@/lib/loadState";
import { openQuickAdd } from "@/lib/quickAdd";
import { useAuthStore } from "@/lib/store";

// One row of GET /expenses/summary/:year/:month (only the fields used here).
interface SummaryRow {
    category: string;
    categoryColor?: string;
    amount: number;
}

interface GoalPlan {
    cashFlow?: { monthlySurplus?: number };
    goals?: (GoalPlanRow & { goalId: string })[];
}

// The current UTC month as request params. ISO strings, not Dates, so the
// cache key stays the same for the whole month.
function currentMonthUTC() {
    const now = new Date();
    const year  = now.getUTCFullYear();
    const month = now.getUTCMonth();
    return {
        year,
        month,
        start: new Date(Date.UTC(year, month,     1, 0, 0, 0, 0)).toISOString(),
        end:   new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString(),
    };
}

// The period's expenses come 100 to a page, newest first; three pages cover
// any realistic month. Past that the chart says it shows the latest entries.
const RUNWAY_PAGES = 3;
// Enough recent rows to end level with the Health card beside them.
const RECENT_ROWS = 8;

// The dashboard (DESIGN.md › Timeline): what is safe to spend today, the stretch
// to the next income day by day, then the reasons: where the money went,
// budget pace, goals, recent spending and health.
export default function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const fmt = useCurrency();
    const [{ year, month, start, end }] = useState(currentMonthUTC);
    const [today] = useState(() => new Date());
    const soFar = useMemo(() => monthSoFar(today), [today]);
    const [whereMonth, setWhereMonth] = useState<WhereMonth>("this");

    // Each read is independent and cached (lib/useApi.ts): a revisit renders
    // at once and one slow endpoint doesn't hold up the rest. A failed one
    // shows a dash plus one notice for the page, never a made-up zero.
    const balance   = useApi<{ wallet?: number; available?: number; savingsBalance?: number }>("/analytics/balance");
    const recurring = useApi<{ items?: IncomeTemplate[] }>("/analytics/recurring-income");
    const plan      = useApi<GoalPlan>("/goals/plan");
    const budgets   = useApi<{ budgets?: BudgetRow[] }>(`/budgets/tracking/${year}/${month + 1}`);
    const summary   = useApi<{ totalSpent?: number; summary?: SummaryRow[] }>(`/expenses/summary/${year}/${month + 1}`);
    const lastYear  = month === 0 ? year - 1 : year;
    const lastMonth = month === 0 ? 12 : month;
    const lastSummary = useApi<{ summary?: SummaryRow[] }>(whereMonth === "last" ? `/expenses/summary/${lastYear}/${lastMonth}` : null);
    const incomes   = useApi<{ amount: number }[]>("/incomes", { startDate: start, endDate: end, limit: 100 });
    const recent    = useApi<Transaction[]>("/expenses", { limit: RECENT_ROWS });
    const health    = useApi<Health>("/ai/financial-health-score");
    const categories = useCategories<TransactionCategory>("expense");

    // The stretch the money has to last, and every expense and income in it.
    const period = useMemo(
        () => (recurring.data ? incomePeriod(recurring.data.items ?? [], today) : null),
        [recurring.data, today],
    );
    const range = useMemo(() => (period ? runwayRange(period, today) : null), [period, today]);
    const page = (n: number, on: boolean) => (on && range ? { ...range, limit: 100, page: n } : undefined);
    const runway1 = useApi<RunwayEntry[]>(range ? "/expenses" : null, page(1, true));
    const pages = runway1.body?.pagination?.pages ?? 1;
    const runway2 = useApi<RunwayEntry[]>(range && pages >= 2 ? "/expenses" : null, page(2, pages >= 2));
    const runway3 = useApi<RunwayEntry[]>(range && pages >= 3 ? "/expenses" : null, page(3, pages >= 3));
    const runwayIncome = useApi<RunwayIncome[]>(range ? "/incomes" : null, range ? { ...range, limit: 100 } : undefined);
    const runwayReads = [runway1, runwayIncome, ...(pages >= 2 ? [runway2] : []), ...(pages >= 3 ? [runway3] : [])];
    const runwayReady = !!period && runwayReads.every((r) => r.data !== undefined);
    const runwayFailed = runwayReads.some((r) => r.error !== undefined) || recurring.error !== undefined;
    const days = useMemo(() => {
        if (!period || !runwayReady) return undefined;
        const entries = [...(runway1.data ?? []), ...(runway2.data ?? []), ...(runway3.data ?? [])];
        return buildRunway(period, entries, runwayIncome.data ?? [], today);
    }, [period, runwayReady, runway1.data, runway2.data, runway3.data, runwayIncome.data, today]);
    const spentToday = days?.find((d) => d.kind === "today")?.spent;
    // Moves between wallet and savings, for the wallet card's engraved trace.
    const savingsLog = useApi<{ entries?: SavingsTransfer[] }>("/savings");

    const reads = [balance, recurring, plan, budgets, summary, incomes, recent];
    const loadState = summarizeLoadState(reads);
    const retryFailed = () => {
        for (const r of [...reads, ...runwayReads, health]) if (r.error !== undefined || r.refreshFailed) void r.refresh();
    };

    const wallet = balance.data ? (balance.data.wallet ?? balance.data.available ?? 0) : undefined;
    // Waits for the day-by-day read too (unless it failed), so the figure
    // doesn't settle on one number and then jump to another.
    const safeWaiting = !days && !runwayFailed;
    const safe = useMemo(() => {
        if (wallet === undefined || !recurring.data || safeWaiting) return null;
        return safeToSpend(wallet, today, nextIncomeDate(recurring.data.items ?? [], today), spentToday ?? 0);
    }, [wallet, recurring.data, today, spentToday, safeWaiting]);
    // Records on screen that failed their signature check (the server flags them).
    const flagged = (recent.data ?? []).filter((t) => t.integrity).length;
    const monthlyIncome = useMemo(
        () => (incomes.data ?? []).reduce((sum, inc) => sum + (inc.amount || 0), 0),
        [incomes.data],
    );
    const shownSummary = whereMonth === "this" ? summary : lastSummary;
    const spendingRows = useMemo(
        () => (shownSummary.data?.summary ?? []).map((it) => ({ name: it.category, amount: it.amount, color: it.categoryColor })),
        [shownSummary.data],
    );
    const firstName = user?.name?.trim().split(/\s+/)[0] || "there";
    const trace = useMemo(
        () => (days && wallet !== undefined && savingsLog.data ? walletTrace(days, savingsLog.data.entries ?? [], wallet) : undefined),
        [days, wallet, savingsLog.data],
    );

    // Getting started: judged only once every read it depends on has data,
    // so an existing account never flashes the start panel while loading.
    const setupReads = [balance, recurring, incomes, recent, budgets, plan];
    const setupKnown = setupReads.every((r) => r.data !== undefined);
    const setup = onboardingState({
        wallet: wallet ?? 0,
        recurringIncomes: recurring.data?.items?.length ?? 0,
        incomeThisMonth: monthlyIncome,
        expenses: recent.data?.length ?? 0,
        budgets: budgets.data?.budgets?.length ?? 0,
        goals: plan.data?.goals?.length ?? 0,
    });
    const setupView = useGetStartedView(user?._id);
    const showSetup = setupKnown && !setup.complete && setupView !== "hidden" && !!user?._id;
    // A brand-new account sees only the steps, not a page of zeros. Once the
    // student folds them away, the cards show with their own empty states.
    const firstRun = showSetup && setup.firstRun && setupView === "full";

    return (
        <div className="mx-auto max-w-[1280px] px-4 pt-5 md:px-8 md:pt-8 lg:px-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 md:gap-6 [&>*]:min-w-0">
            <header className="md:col-span-2 lg:col-span-12 flex items-center justify-between gap-4">
                <div className="min-w-0">
                    {/* tabIndex -1: focus lands here when a panel the user was in closes. */}
                    <h1 id="dashboard-title" tabIndex={-1} className="text-[26px] md:text-[30px] font-light [font-stretch:112%] tracking-[-0.01em] text-white break-words outline-none">Hello, {firstName}</h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <p className="text-[13.5px] text-zinc-400">{format(today, "EEEE d MMMM")}</p>
                        <SecurityBadge flagged={flagged} />
                    </div>
                </div>
                <button type="button" onClick={openQuickAdd} className="hidden md:inline-flex shrink-0 items-center gap-2 min-h-11 px-5 rounded-full bg-plat text-plat-ink text-sm font-semibold hover:bg-white active:scale-[0.97] transition-[background-color,scale] focus-ring">
                    <Plus className="w-4 h-4" aria-hidden /> Quick add expense
                </button>
            </header>

            <div className="md:col-span-2 lg:col-span-12 empty:hidden"><LoadNotice state={loadState} onRetry={retryFailed} /></div>
            {showSetup && <div className="md:col-span-2 lg:col-span-12"><GetStartedPanel state={setup} userId={user._id} firstRun={firstRun} view={setupView} /></div>}

            {!firstRun && <>
                {/* Source order is the phone order (and what screen readers and
                    Tab follow): the answer, the wallet, the stretch day by day,
                    then the reasons. */}
                <div className="md:col-span-2 lg:col-span-12 grid gap-8 lg:gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] items-center py-2 md:py-4">
                    <SafeToSpendHero
                        stats={safe}
                        wallet={wallet}
                        spentToday={spentToday}
                        loading={balance.isLoading || recurring.isLoading || (safeWaiting && !balance.error && !recurring.error)}
                        failed={balance.error !== undefined || recurring.error !== undefined}
                        needsIncome={setupKnown && !setup.steps[0].done}
                        fmt={fmt}
                    />
                    <WalletCard
                        className="w-full max-w-[420px] lg:max-w-none justify-self-start lg:justify-self-end"
                        wallet={wallet}
                        savings={balance.data?.savingsBalance}
                        name={user?.name?.trim() || ""}
                        trace={trace}
                        loading={balance.isLoading}
                        failed={balance.error !== undefined}
                        fmt={fmt}
                    />
                </div>

                <RunwayChart
                    className="md:col-span-2 lg:col-span-12"
                    days={days}
                    period={period}
                    perDay={safe && safe.over === 0 ? safe.perDay : 0}
                    loading={!runwayFailed && !days}
                    failed={runwayFailed}
                    onRetry={() => { for (const r of [recurring, ...runwayReads]) void r.refresh(); }}
                    partial={pages > RUNWAY_PAGES}
                    fmt={fmt}
                />

                {/* Last month's leftover, decided once a month: after the day's
                    answer and the stretch, not ahead of them. */}
                <div className="md:col-span-2 lg:col-span-12 empty:hidden"><MonthEndCard /></div>

                <WhereItWentCard
                    className="md:col-span-1 lg:col-span-4"
                    rows={spendingRows}
                    loading={shownSummary.isLoading}
                    failed={shownSummary.error !== undefined}
                    onRetry={() => void shownSummary.refresh()}
                    month={whereMonth}
                    onMonth={setWhereMonth}
                    monthNames={[format(today, "MMM"), format(new Date(lastYear, lastMonth - 1, 1), "MMM")]}
                    periodLabel={whereMonth === "this" ? soFar.label : format(new Date(lastYear, lastMonth - 1, 1), "MMMM")}
                    fmt={fmt}
                />
                <BudgetPaceCard
                    className="md:col-span-1 lg:col-span-4"
                    budgets={budgets.data?.budgets}
                    loading={budgets.isLoading}
                    failed={budgets.error !== undefined}
                    onRetry={() => void budgets.refresh()}
                    day={soFar.day}
                    daysInMonth={getDaysInMonth(today)}
                    fmt={fmt}
                />
                <GoalsCard
                    className="md:col-span-2 lg:col-span-4"
                    goals={plan.data?.goals}
                    monthlySurplus={plan.data?.cashFlow?.monthlySurplus ?? 0}
                    savings={balance.data?.savingsBalance}
                    loading={plan.isLoading}
                    failed={plan.error !== undefined}
                    onRetry={() => void plan.refresh()}
                    savingsLoading={balance.isLoading}
                    savingsFailed={balance.error !== undefined}
                    now={today}
                    fmt={fmt}
                />

                <Card title="Recent spending" id="recent" action={{ href: "/dashboard/expenses", label: "View all" }} className="md:col-span-2 lg:col-span-8">
                    {recent.isLoading ? (
                        <div className="space-y-3" aria-hidden>
                            {Array.from({ length: RECENT_ROWS }, (_, i) => <div key={i} className="h-12 rounded-xl bg-white/[0.05] animate-pulse" />)}
                        </div>
                    ) : recent.error !== undefined ? (
                        <LoadError what="your recent spending" onRetry={() => void recent.refresh()} />
                    ) : (
                        <RecentTransactions transactions={(recent.data ?? []).slice(0, RECENT_ROWS)} categories={categories.all} />
                    )}
                </Card>
                <HealthCard
                    className="md:col-span-2 lg:col-span-4"
                    health={health.data}
                    loading={health.isLoading}
                    failed={health.error !== undefined}
                    onRetry={() => void health.refresh()}
                />
            </>}
        </div>
    );
}
