"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, startOfDay, subMonths } from "date-fns";
import { BadgeCheck, Plus, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useCategories } from "@/lib/useCategories";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay, formatDay } from "@/lib/dates";
import { summarizeLoadState } from "@/lib/loadState";
import type { MoneyFormatter } from "@/lib/money";
import { IncomeChart, type IncomeGranularity } from "@/components/dashboard/income/IncomeChart";
import { SavingsBreakdown, type BalanceData } from "@/components/dashboard/SavingsBreakdown";
import { RowActions } from "@/components/dashboard/RowActions";
import { LoadError, LoadNotice } from "@/components/dashboard/LoadNotice";
import { Card, Empty, HeroFigure, Missing, Page, PageHeader, Skeleton, Term } from "@/components/dashboard/ui";

interface Income {
    _id: string;
    amount: number;
    category: string;
    description: string;
    date: string;
    isRecurring: boolean;
    recurringFrequency?: string;
    isPostTax: boolean;
    parentRecurringId: string | null;
    integrity?: "missing" | "invalid";  // set by the server when the record's signature check fails
}

interface Category {
    _id: string;
    name: string;
    color: string;
}

interface MonthGroup {
    key: string;
    label: string;
    items: Income[];
    total: number;
}

const EVERY: Record<string, string> = {
    weekly: "weekly",
    biweekly: "every two weeks",
    monthly: "monthly",
    yearly: "yearly",
};

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

// Income (DESIGN.md › Timeline): what came in this month as the headline,
// then income over time beside where it went, then every entry from this
// month and last, newest first.
export default function IncomePage() {
    const router = useRouter();
    const money = useCurrency();
    const [now] = useState(() => new Date());

    const [granularity, setGranularity] = useState<IncomeGranularity>("monthly");
    // Shown as gone at once; the refetch the delete triggers agrees shortly after.
    const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());

    // A window covering this and last month so materialization catches the
    // current period reliably. Fixed per visit so the cache key is stable.
    const [range] = useState(() => {
        const d = new Date();
        return {
            startDate: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString(),
            endDate:   new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString(),
        };
    });
    const categories = useCategories<Category>("income");
    const incomesQ = useApi<Income[]>("/incomes", { ...range, limit: 100 });
    // The continuous balance (carry-forward + income − expenses − savings).
    const balanceQ = useApi<BalanceData>("/analytics/balance");
    const balance = balanceQ.data ?? null;

    const catMap = useMemo(() => {
        const map: Record<string, Category> = {};
        for (const c of categories.all) map[c._id] = c;
        return map;
    }, [categories.all]);
    const rows = incomesQ.data;
    const incomes = useMemo(
        () => (rows ?? [])
            .filter((i) => !removed.has(i._id))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [rows, removed],
    );
    // A recurring copy carries no cadence of its own; its source may be in the list.
    const cadenceOf = useMemo(() => {
        const map = new Map<string, string>();
        for (const i of rows ?? []) if (i.isRecurring && i.recurringFrequency) map.set(i._id, i.recurringFrequency);
        return map;
    }, [rows]);
    const groups = useMemo(() => {
        const out: MonthGroup[] = [];
        for (const inc of incomes) {
            const day = calendarDay(inc.date);
            const key = monthKey(day);
            let g = out[out.length - 1];
            if (!g || g.key !== key) {
                g = { key, label: format(day, "MMMM"), items: [], total: 0 };
                out.push(g);
            }
            g.items.push(inc);
            g.total += inc.amount;
        }
        return out;
    }, [incomes]);
    const lastMonth = subMonths(now, 1);
    const lastMonthTotal = groups.find((g) => g.key === monthKey(lastMonth))?.total ?? 0;

    const loading = incomesQ.isLoading || categories.isLoading;
    const reads = [incomesQ, balanceQ];
    const loadState = summarizeLoadState(reads);
    const retry = () => { for (const r of reads) if (r.error !== undefined || r.refreshFailed) void r.refresh(); };

    // RowActions asks first and shows the error in the row if this rejects.
    const handleDelete = async (id: string) => {
        await api.delete(`/incomes/${id}`);
        setRemoved((prev) => new Set(prev).add(id));
    };

    const failedBalance = balanceQ.error !== undefined;
    const termValue = (v: number | undefined, isLoading: boolean, failed: boolean) =>
        isLoading ? <span aria-hidden className="inline-block h-[0.9em] w-28 rounded-md bg-white/[0.05] animate-pulse align-middle" />
            : failed || v === undefined ? <Missing /> : money.format(v);

    return (
        <Page>
            <PageHeader title="Income" sub="What came in this month and last, and where it went.">
                <Link href="/dashboard/income/new" className="btn-primary">
                    <Plus className="w-4 h-4" aria-hidden /> Add income
                </Link>
            </PageHeader>

            <div className="empty:hidden"><LoadNotice state={loadState} onRetry={retry} /></div>

            <div className="grid grid-cols-1 lg:grid-cols-12 items-end gap-8 lg:gap-14 py-2 md:py-4">
                <HeroFigure
                    className="lg:col-span-7"
                    label="Income this month"
                    value={balance ? money.format(balance.monthly.income) : null}
                    loading={balanceQ.isLoading}
                    failed={failedBalance}
                >
                    Received so far in {format(now, "MMMM")}.
                </HeroFigure>
                <dl className="lg:col-span-5 grid grid-cols-2 gap-6">
                    <Term label="Last month">
                        {termValue(lastMonthTotal, loading, incomesQ.error !== undefined)}
                    </Term>
                    <Term label="This year">
                        {termValue(balance?.yearly.income, balanceQ.isLoading, failedBalance)}
                    </Term>
                </dl>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
                <IncomeChart className="lg:col-span-8" granularity={granularity} onGranularity={setGranularity} />
                <SavingsBreakdown
                    className="lg:col-span-4"
                    breakdown={balance ? balance[granularity] : null}
                    periodLabel={granularity === "monthly" ? "this month" : "this year"}
                    loading={balanceQ.isLoading}
                    failed={failedBalance}
                    onRetry={() => void balanceQ.refresh()}
                />
            </div>

            <Card
                title="Entries"
                id="income-entries"
                aside={<span className="label-caps text-zinc-400">{format(lastMonth, "MMM")} – {format(now, "MMM")}</span>}
            >
                {loading ? (
                    <div aria-hidden className="space-y-3">
                        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
                    </div>
                ) : incomesQ.error !== undefined ? (
                    <LoadError what="your income" onRetry={() => void incomesQ.refresh()} />
                ) : incomes.length === 0 ? (
                    <Empty
                        title="No income recorded yet"
                        action={<Link href="/dashboard/income/new" className="btn-primary"><Plus className="w-4 h-4" aria-hidden /> Add income</Link>}
                    >
                        Add what comes in, once or on a schedule, and FinAssist works out what&apos;s safe to spend each day.
                    </Empty>
                ) : (
                    <div className="space-y-8">
                        {groups.map((g) => (
                            <section key={g.key} aria-labelledby={`income-${g.key}`}>
                                <div className="flex items-baseline justify-between gap-3 pb-3 border-b border-white/[0.07]">
                                    <h3 id={`income-${g.key}`} className="label-caps text-zinc-400">{g.label}</h3>
                                    <p className="text-[12.5px] text-zinc-400 tabular-nums">
                                        {g.items.length} {g.items.length === 1 ? "entry" : "entries"} · <span className="text-zinc-200">{money.format(g.total)}</span>
                                    </p>
                                </div>
                                <ul>
                                    {g.items.map((inc) => (
                                        <IncomeRow
                                            key={inc._id}
                                            income={inc}
                                            cat={catMap[inc.category]}
                                            cadence={inc.recurringFrequency ?? (inc.parentRecurringId ? cadenceOf.get(inc.parentRecurringId) : undefined)}
                                            now={now}
                                            fmt={money}
                                            onEdit={() => router.push(`/dashboard/income/${inc._id}`)}
                                            onDelete={() => handleDelete(inc._id)}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </Card>
        </Page>
    );
}

// One entry in the Recent spending row style: the day set large on the left,
// the name, a caption with its category, how it repeats and its signature
// state, and the amount in tabular figures. On phones the edit and delete
// controls sit on the caption line, so the name keeps its width.
function IncomeRow({
    income, cat, cadence, now, fmt, onEdit, onDelete,
}: {
    income: Income;
    cat?: Category;
    cadence?: string;
    now: Date;
    fmt: MoneyFormatter;
    onEdit: () => void;
    onDelete: () => Promise<unknown>;
}) {
    const day = calendarDay(income.date);
    const isSource = income.isRecurring && !income.parentRecurringId;
    const isCopy = !!income.parentRecurringId;
    const repeat = isSource
        ? `Repeats ${EVERY[income.recurringFrequency ?? ""] ?? "on a schedule"}`
        : isCopy ? (cadence && EVERY[cadence] ? `Auto-added, ${EVERY[cadence]}` : "Auto-added") : null;
    const upcoming = day > startOfDay(now);
    const caption = [cat?.name ?? "Uncategorized", repeat, !income.isPostTax && "Before tax", upcoming && "Upcoming"]
        .filter(Boolean).join(" · ");

    return (
        <li className="grid grid-cols-[48px_minmax(0,1fr)_auto] sm:grid-cols-[48px_minmax(0,1fr)_auto_auto] items-center gap-x-4 py-3.5 border-t border-white/[0.07] first:border-t-0">
            <span aria-hidden className="col-start-1 row-start-1 row-span-2 grid justify-items-center leading-none text-zinc-400">
                <b className="text-[23px] font-light [font-stretch:112%] text-white">{day.getDate()}</b>
                <span className="mt-1.5 text-[10.5px] font-medium tracking-[0.14em] [font-stretch:118%] uppercase">{format(day, "EEE")}</span>
            </span>
            <span className="col-start-2 row-start-1 min-w-0 truncate font-semibold text-white" title={income.description}>
                <span className="sr-only">{formatDay(income.date, now)}, </span>{income.description}
            </span>
            <span className="col-start-3 row-start-1 sm:row-span-2 justify-self-end font-medium text-white tabular-nums">
                +{fmt.format(income.amount)}
            </span>
            <span className="col-start-2 row-start-2 mt-0.5 flex items-center gap-2 min-w-0 text-[12.5px] text-zinc-400">
                {cat?.color && <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: cat.color }} />}
                <span className="truncate">{caption}</span>
                {income.integrity
                    ? <span className="inline-flex items-center gap-1 shrink-0 text-amber-200"><ShieldAlert className="w-3.5 h-3.5 text-amber-300" aria-hidden />Failed check</span>
                    : <span className="hidden sm:inline-flex items-center gap-1 shrink-0"><BadgeCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden />Signed</span>}
            </span>
            <RowActions
                className="col-start-3 row-start-2 sm:col-start-4 sm:row-start-1 sm:row-span-2 justify-self-end -mr-2"
                itemLabel={income.description}
                onEdit={onEdit}
                onDelete={onDelete}
                confirmText={isSource ? "Delete? Entries already added stay." : "Delete?"}
            />
        </li>
    );
}
