"use client";

import { useId, useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Plus, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { calendarDay } from "@/lib/dates";
import type { MoneyFormatter } from "@/lib/money";
import { openQuickAdd } from "@/lib/quickAdd";
import { cn } from "@/lib/utils";
import { Card, Empty, Meter, Skeleton } from "../ui";
import { LoadError } from "../LoadNotice";

// One row of currentExpenses / previousExpenses from GET /analytics/monthly-analytics.
// `_id` is the category's id (null for expenses without one).
export interface CategoryTotal {
    _id?: string | null;
    category: string;
    categoryColor?: string;
    total: number;
}

export interface MonthlyAnalytics {
    currentExpenses?: CategoryTotal[];
    previousExpenses?: CategoryTotal[];
}

interface CategoryTx {
    _id: string;
    amount: number;
    description: string;
    date: string;
}

interface Row {
    name: string;
    id: string | null;
    color?: string;
    current: number;
    previous: number;
}

// Past this many rows the card would outgrow the health score beside it; the
// rest are a tap away (and always in the screen-reader table).
const MAX_ROWS = 5;

// Last month's meter: the same track, its fill platinum at 30%, so the two
// bars read as one figure and the thing it's compared with.
function deltaText(r: Row, fmt: MoneyFormatter): string {
    if (r.previous === 0) return "New this month";
    if (r.current === 0) return "None yet this month";
    const d = r.current - r.previous;
    if (d === 0) return "Same as last month";
    return d > 0 ? `${fmt.format(d)} more` : `${fmt.format(-d)} less`;
}

// This month's spending by category against last month's: each category a
// row with two bars on one scale (this month in platinum, last month dimmer),
// amounts in tabular figures beside them. Rows read better than columns on a
// phone. Tapping a category lists this month's entries in it.
export function SpendingComparisonChart({
    monthly, loading, failed, onRetry, soFarLabel, lastMonthName, fmt, className,
}: {
    monthly: MonthlyAnalytics | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    soFarLabel: string;       // "1–5 Nov"
    lastMonthName: string;    // "October"
    fmt: MoneyFormatter;
    className?: string;
}) {
    const panelBase = useId();
    const [showAll, setShowAll] = useState(false);

    const rows = useMemo(() => {
        const current:  CategoryTotal[] = monthly?.currentExpenses  ?? [];
        const previous: CategoryTotal[] = monthly?.previousExpenses ?? [];

        // Merge by category NAME, so a category that only appears in one of
        // the months still gets one row.
        const byName = new Map<string, Row>();
        const row = (c: CategoryTotal) => {
            const r = byName.get(c.category) ?? { name: c.category, id: null, current: 0, previous: 0 };
            r.id = r.id ?? c._id ?? null;
            r.color = r.color ?? c.categoryColor;
            byName.set(c.category, r);
            return r;
        };
        for (const c of current)  row(c).current  += c.total;
        for (const p of previous) row(p).previous += p.total;
        return [...byName.values()].sort((a, b) => (b.current + b.previous) - (a.current + a.previous));
    }, [monthly]);

    const shown = showAll ? rows : rows.slice(0, MAX_ROWS);
    const max = Math.max(0, ...rows.flatMap((r) => [r.current, r.previous]));
    // The amount column is as wide as the longest amount, so every row's bars
    // end at the same place and the shared scale stays true.
    const amountCh = Math.max(4, ...rows.flatMap((r) => [fmt.format(r.current).length, fmt.format(r.previous).length])) + 1;

    // Click-to-expand: which category is open, plus a per-category cache of
    // its transactions for the current month (the window dashboard-stats uses).
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [txCache, setTxCache] = useState<Record<string, { loading: boolean; failed?: boolean; items: CategoryTx[] }>>({});

    const fetchCategory = async (categoryId: string) => {
        setTxCache((c) => ({ ...c, [categoryId]: { loading: true, items: [] } }));
        try {
            const now = new Date();
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth();
            const startDate = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
            const endDate   = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
            const res = await api.get("/expenses", { params: { category: categoryId, startDate, endDate, limit: 100 } });
            const items: CategoryTx[] = (res.data?.data ?? [])
                .slice()
                .sort((a: CategoryTx, b: CategoryTx) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setTxCache((c) => ({ ...c, [categoryId]: { loading: false, items } }));
        } catch (err) {
            console.error("Failed to fetch category transactions", err);
            setTxCache((c) => ({ ...c, [categoryId]: { loading: false, failed: true, items: [] } }));
        }
    };

    const toggleCategory = (categoryId: string) => {
        if (expandedId === categoryId) { setExpandedId(null); return; }
        setExpandedId(categoryId);
        if (!txCache[categoryId] || txCache[categoryId].failed) void fetchCategory(categoryId);
    };

    const key = (
        <ul aria-hidden className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-zinc-300">
            <li className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-[3px] bg-plat" />This month</li>
            <li className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-[3px] bg-plat/30" />Last month</li>
        </ul>
    );

    return (
        <Card title="Spending by category" id="by-category" className={className} aside={rows.length > 0 && !loading && !failed ? key : undefined}>
            {loading ? (
                <div aria-hidden className="space-y-7">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="space-y-2.5"><Skeleton className="h-4 w-32 rounded-md" /><Skeleton className="h-1.5 rounded-full" /><Skeleton className="h-1.5 rounded-full" /></div>
                    ))}
                </div>
            ) : failed ? (
                <LoadError what="your spending by category" onRetry={onRetry} className="py-6" />
            ) : rows.length === 0 ? (
                <Empty
                    title="Nothing spent this month or last"
                    action={<button type="button" onClick={openQuickAdd} className="btn-primary"><Plus className="w-4 h-4" aria-hidden /> Add an expense</button>}
                >
                    Add an expense and it shows here by category, against last month.
                </Empty>
            ) : (
                <>
                    <p className="-mt-2 mb-5 text-[12.5px] text-zinc-400 max-w-prose">
                        {soFarLabel} against all of {lastMonthName}. Tap a category to see this month&apos;s entries in it.
                    </p>

                    <div className="sr-only">
                        <table>
                            <caption>Spending by category: {soFarLabel} against all of {lastMonthName}</caption>
                            <thead><tr><th scope="col">Category</th><th scope="col">This month</th><th scope="col">Last month</th></tr></thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.name}><th scope="row">{r.name}</th><td>{fmt.format(r.current)}</td><td>{fmt.format(r.previous)}</td></tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <ul>
                        {shown.map((r, i) => {
                            const isOpen = r.id !== null && expandedId === r.id;
                            const tx = r.id ? txCache[r.id] : undefined;
                            const panelId = `${panelBase}-${i}`;
                            const head = (
                                <>
                                    <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: r.color || "#71717a" }} />
                                    <span className="truncate font-semibold text-white">{r.name}</span>
                                    {r.id && <ChevronDown aria-hidden className={cn("w-4 h-4 shrink-0 text-zinc-500 transition-transform duration-200", isOpen && "rotate-180")} />}
                                    <span className="ml-auto pl-3 shrink-0 text-[12.5px] text-zinc-400 tabular-nums">{deltaText(r, fmt)}</span>
                                </>
                            );
                            return (
                                <li key={r.name} className="py-3 border-t border-white/[0.07] first:border-t-0 first:pt-0 last:pb-0">
                                    {r.id ? (
                                        <button
                                            type="button"
                                            onClick={() => toggleCategory(r.id as string)}
                                            aria-expanded={isOpen}
                                            aria-controls={panelId}
                                            className="-mx-2 px-2 w-[calc(100%+1rem)] flex items-center gap-2 min-h-11 rounded-lg text-left text-sm hover:bg-white/[0.04] transition-colors focus-ring"
                                        >
                                            {head}
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2 min-h-11 text-sm">{head}</div>
                                    )}

                                    {/* The two bars on one scale. The table above carries the figures for screen readers. */}
                                    <div aria-hidden className="mt-1 grid items-center gap-x-3 gap-y-2" style={{ gridTemplateColumns: `minmax(0,1fr) ${amountCh}ch` }}>
                                        <Meter fraction={max > 0 ? r.current / max : 0} delay={i * 0.06} />
                                        <span className="text-right text-[13px] tabular-nums text-white">{fmt.format(r.current)}</span>
                                        <Meter fraction={max > 0 ? r.previous / max : 0} tone="dim" delay={i * 0.06 + 0.05} />
                                        <span className="text-right text-[13px] tabular-nums text-zinc-400">{fmt.format(r.previous)}</span>
                                    </div>

                                    {isOpen && (
                                        <div id={panelId} className="mt-4 ml-1 pl-4 border-l border-white/[0.07]">
                                            {!tx || tx.loading ? (
                                                <div aria-hidden className="space-y-2.5 py-1">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-5 rounded-md" />)}</div>
                                            ) : tx.failed ? (
                                                <div className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-300">
                                                    Couldn&apos;t load these entries.
                                                    <button type="button" onClick={() => void fetchCategory(r.id as string)} className="btn-quiet"><RotateCw className="w-4 h-4" aria-hidden /> Try again</button>
                                                </div>
                                            ) : tx.items.length === 0 ? (
                                                <p className="py-1 text-[13px] text-zinc-400">Nothing in {r.name} this month yet.</p>
                                            ) : (
                                                <ul aria-label={`${r.name} this month`}>
                                                    {tx.items.map((t) => (
                                                        <li key={t._id} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-baseline gap-3 py-2 border-t border-white/[0.05] first:border-t-0 first:pt-0">
                                                            <span className="text-[12.5px] text-zinc-400 tabular-nums">{format(calendarDay(t.date), "d MMM")}</span>
                                                            <span className="truncate text-[13.5px] text-zinc-200" title={t.description}>{t.description}</span>
                                                            <span className="text-[13.5px] text-white tabular-nums">{fmt.format(t.amount)}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>

                    {rows.length > MAX_ROWS && (
                        <button type="button" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll} className="btn-quiet mt-3 -ml-3">
                            {showAll ? "Show fewer" : `Show all ${rows.length} categories`}
                            <ChevronDown aria-hidden className={cn("w-4 h-4 transition-transform duration-200", showAll && "rotate-180")} />
                        </button>
                    )}
                </>
            )}
        </Card>
    );
}
