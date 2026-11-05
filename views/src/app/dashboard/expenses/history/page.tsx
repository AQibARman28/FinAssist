"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, ChevronLeft, ChevronRight, Receipt, Search, SearchX, X } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay } from "@/lib/dates";
import { openQuickAdd } from "@/lib/quickAdd";
import { cn } from "@/lib/utils";
import { Card, Empty, HeroFigure, Missing, Page, PageHeader, Segmented, Skeleton, Term } from "@/components/dashboard/ui";
import { LoadError } from "@/components/dashboard/LoadNotice";
import { ExpenseRow, type ExpenseItem, type ExpenseCategory } from "@/components/dashboard/expenses/ExpenseRow";

type Expense = ExpenseItem;
type Category = ExpenseCategory;

interface Loaded {
    key: string;                       // which period this data belongs to
    expenses: Expense[];
    catMap: Record<string, Category>;
    failed?: boolean;                  // the read failed: nothing to show, not "nothing recorded"
}

type Mode = "month" | "year";
type AmountOp = ">" | ">=" | "<" | "<=" | "=";
type SortKey = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Rows per page. The period is fetched whole; paging only keeps the list readable.
const PAGE_SIZE = 50;

// Toolbar controls: the field well at the toolbar's 44px height.
const toolbarField = "field w-auto min-h-11 py-2.5";

// Fetch every expense in [startDate, endDate], walking the API's 100/page cap.
async function fetchAllExpenses(startDate: string, endDate: string): Promise<Expense[]> {
    const first = await api.get("/expenses", { params: { startDate, endDate, limit: 100, page: 1 } });
    const out: Expense[] = first.data?.data ?? [];
    const pages: number = first.data?.pagination?.pages ?? 1;
    if (pages > 1) {
        const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) =>
                api.get("/expenses", { params: { startDate, endDate, limit: 100, page: i + 2 } }),
            ),
        );
        for (const r of rest) out.push(...(r.data?.data ?? []));
    }
    return out;
}

// The fine print under a Term's figure, back at reading width and weight.
function TermNote({ children }: { children: React.ReactNode }) {
    return <span className="block mt-2 text-[12.5px] leading-[1.45] font-normal [font-stretch:100%] text-zinc-400">{children}</span>;
}

// Every expense in a month or a year: the period and filters in one
// toolbar, the total they come to, then the rows, a page at a time.
export default function ExpenseHistoryPage() {
    const { format: fmt } = useCurrency();
    const [now] = useState(() => new Date());
    const uid = useId();
    const ids = { month: `${uid}-month`, year: `${uid}-year`, search: `${uid}-search`, op: `${uid}-op`, amount: `${uid}-amount`, sort: `${uid}-sort` };

    // Period selection
    const [mode, setMode] = useState<Mode>("month");
    const [year, setYear] = useState<number>(now.getFullYear());
    const [month, setMonth] = useState<number>(now.getMonth()); // 0-11

    // Data — tagged with the period it was fetched for, so "loading" is simply
    // "the data on hand belongs to a different period". `reloadKey` re-fetches
    // the same period in the background after an edit/delete.
    const periodKey = `${mode}|${year}|${month}`;
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const loading = loaded?.key !== periodKey;
    const failed = !loading && !!loaded?.failed;
    const expenses = useMemo(() => loaded?.expenses ?? [], [loaded]);
    const catMap = useMemo(() => loaded?.catMap ?? {}, [loaded]);

    // Search / filter / sort
    const [search, setSearch] = useState("");
    const [amountOp, setAmountOp] = useState<AmountOp>(">");
    const [amountVal, setAmountVal] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>("date-desc");

    const years = useMemo(() => {
        const y = now.getFullYear();
        return Array.from({ length: 7 }, (_, i) => y - i);
    }, [now]);

    useEffect(() => {
        let cancelled = false;
        const key = `${mode}|${year}|${month}`;
        const start = mode === "month"
            ? new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
            : new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
        const end = mode === "month"
            ? new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
            : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

        Promise.all([
            api.get("/categories?type=expense&includeArchived=true"),
            fetchAllExpenses(start.toISOString(), end.toISOString()),
        ])
            .then(([catsRes, exp]) => {
                if (cancelled) return;
                const map: Record<string, Category> = {};
                for (const c of catsRes.data?.data ?? []) map[c._id] = c;
                setLoaded({ key, expenses: exp, catMap: map });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error(err);
                // A failed background refresh keeps the rows already on screen;
                // a failed first read says so instead of showing an empty period.
                setLoaded((prev) => (prev && prev.key === key && !prev.failed ? prev : { key, expenses: [], catMap: {}, failed: true }));
            });
        return () => { cancelled = true; };
    }, [mode, year, month, reloadKey]);

    const retry = () => { setLoaded(null); setReloadKey((k) => k + 1); };

    // Optimistic local update, then a background re-fetch (picks up a newly
    // created category, or drops a row whose date moved out of the period).
    const handleUpdated = (updated: Expense) => {
        setLoaded((prev) => prev && { ...prev, expenses: prev.expenses.map((e) => (e._id === updated._id ? updated : e)) });
        setReloadKey((k) => k + 1);
    };
    const handleDeleted = (id: string) => {
        setLoaded((prev) => prev && { ...prev, expenses: prev.expenses.filter((e) => e._id !== id) });
    };

    // Client-side search + amount filter + sort (descriptions are encrypted at
    // rest, so text search can only happen after decryption on the client).
    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        const threshold = parseFloat(amountVal);
        const hasAmount = amountVal !== "" && Number.isFinite(threshold);

        let rows = expenses.filter((e) => {
            // Amount threshold (operator + user value)
            if (hasAmount) {
                if (amountOp === ">"  && !(e.amount >  threshold)) return false;
                if (amountOp === ">=" && !(e.amount >= threshold)) return false;
                if (amountOp === "<"  && !(e.amount <  threshold)) return false;
                if (amountOp === "<=" && !(e.amount <= threshold)) return false;
                if (amountOp === "="  && e.amount !== threshold)   return false;
            }
            // Free-text search across description, category, amount, date
            // (the date both as "Nov 2, 2026" and as the rows show it, "Mon 2 Nov").
            if (q) {
                const cat = catMap[e.category]?.name ?? "";
                const day = calendarDay(e.date);
                const dateStr = `${format(day, "MMM d, yyyy")} ${format(day, "EEE d MMM yyyy")}`;
                const hay = `${e.description} ${cat} ${e.amount} ${dateStr}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        rows = rows.slice().sort((a, b) => {
            switch (sortKey) {
                case "amount-desc": return b.amount - a.amount;
                case "amount-asc":  return a.amount - b.amount;
                case "date-asc":    return new Date(a.date).getTime() - new Date(b.date).getTime();
                default:            return new Date(b.date).getTime() - new Date(a.date).getTime();
            }
        });
        return rows;
    }, [expenses, catMap, search, amountOp, amountVal, sortKey]);

    const total = useMemo(() => visible.reduce((s, e) => s + e.amount, 0), [visible]);

    const filtersActive = search.trim() !== "" || amountVal !== "";
    const clearFilters = () => { setSearch(""); setAmountVal(""); };
    const periodLabel = mode === "month" ? `${MONTHS[month]} ${year}` : String(year);
    const isCurrentPeriod = year === now.getFullYear() && (mode === "year" || month === now.getMonth());

    // Paging. Any change to the period, filters or sort goes back to page 1.
    const viewKey = `${periodKey}|${search}|${amountOp}|${amountVal}|${sortKey}`;
    const [paging, setPaging] = useState({ key: viewKey, page: 1 });
    const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    const page = Math.min(paging.key === viewKey ? paging.page : 1, pages);
    const shown = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const resultsRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const goToPage = (next: number) => {
        if (next < 1 || next > pages || next === page) return;
        setPaging({ key: viewKey, page: next });
        // Back to the top of the results, with focus on the new rows.
        resultsRef.current?.scrollIntoView({ block: "start" });
        listRef.current?.focus({ preventScroll: true });
    };

    return (
        <Page>
            <div className="flex flex-col gap-2">
                <Link href="/dashboard/expenses" className="btn-quiet self-start -ml-3 text-[13.5px]">
                    <ArrowLeft className="w-4 h-4" aria-hidden /> Back to expenses
                </Link>
                <PageHeader
                    title="Transaction history"
                    sub="Every expense you've recorded. Pick a month or a year, then search, filter and sort."
                />
            </div>

            {/* The period and the filters, in one toolbar above the results. */}
            <div role="search" aria-label="Filter expenses" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <Segmented
                        label="Period"
                        items={[{ key: "month", label: "Month" }, { key: "year", label: "Year" }]}
                        value={mode}
                        onChange={setMode}
                    />
                    {mode === "month" && (
                        <>
                            <label htmlFor={ids.month} className="sr-only">Month</label>
                            <select
                                id={ids.month}
                                value={month}
                                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                                className={cn(toolbarField, "cursor-pointer")}
                            >
                                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                            </select>
                        </>
                    )}
                    <label htmlFor={ids.year} className="sr-only">Year</label>
                    <select
                        id={ids.year}
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value, 10))}
                        className={cn(toolbarField, "cursor-pointer tabular-nums")}
                    >
                        {years.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>

                    <div className="flex items-center gap-2 sm:ml-auto">
                        <label htmlFor={ids.sort} className="text-[13px] text-zinc-400">Sort</label>
                        <select
                            id={ids.sort}
                            value={sortKey}
                            onChange={(e) => setSortKey(e.target.value as SortKey)}
                            className={cn(toolbarField, "cursor-pointer")}
                        >
                            <option value="date-desc">Date — newest first</option>
                            <option value="date-asc">Date — oldest first</option>
                            <option value="amount-desc">Amount — high to low</option>
                            <option value="amount-asc">Amount — low to high</option>
                        </select>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-[1_1_18rem] min-w-0">
                        <label htmlFor={ids.search} className="sr-only">Search expenses</label>
                        <Search aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                        <input
                            id={ids.search}
                            type="text"
                            placeholder="Search by description, category, amount, or date…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="field min-h-11 py-2.5 pl-11 pr-12"
                        />
                        {search && (
                            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="btn-icon absolute right-0 top-1/2 -translate-y-1/2">
                                <X className="w-4 h-4" aria-hidden />
                            </button>
                        )}
                    </div>

                    {/* Amount threshold */}
                    <div className="flex items-center gap-2">
                        <label htmlFor={ids.op} className="text-[13px] text-zinc-400">Costs</label>
                        <select
                            id={ids.op}
                            value={amountOp}
                            onChange={(e) => setAmountOp(e.target.value as AmountOp)}
                            className={cn(toolbarField, "cursor-pointer")}
                        >
                            <option value=">">{"> greater than"}</option>
                            <option value=">=">{"≥ at least"}</option>
                            <option value="<">{"< less than"}</option>
                            <option value="<=">{"≤ at most"}</option>
                            <option value="=">{"= equals"}</option>
                        </select>
                        <label htmlFor={ids.amount} className="sr-only">Amount</label>
                        <input
                            id={ids.amount}
                            type="number"
                            min={0}
                            step="any"
                            placeholder="amount"
                            value={amountVal}
                            onChange={(e) => setAmountVal(e.target.value)}
                            className={cn(toolbarField, "w-32 tabular-nums")}
                        />
                        {amountVal && (
                            <button type="button" onClick={() => setAmountVal("")} className="btn-quiet text-[13px]">Clear</button>
                        )}
                    </div>
                </div>
            </div>

            {/* What the period and filters come to. */}
            <div className="flex flex-wrap items-end gap-x-14 gap-y-6 py-1 md:py-2">
                <HeroFigure
                    size="md"
                    label={filtersActive ? `Matching in ${periodLabel}` : `Spent in ${periodLabel}`}
                    value={fmt(total)}
                    loading={loading}
                    failed={failed}
                />
                <dl>
                    <Term label="Expenses">
                        {loading
                            ? <span aria-hidden className="inline-block h-[0.9em] w-14 rounded-md bg-white/[0.05] animate-pulse align-middle" />
                            : failed ? <Missing /> : visible.length}
                        {!loading && !failed && filtersActive && <TermNote>of {expenses.length} in {periodLabel}</TermNote>}
                    </Term>
                </dl>
            </div>

            <div ref={resultsRef} className="scroll-mt-6">
                <Card
                    title={periodLabel}
                    id="history-results"
                    aside={!loading && !failed && pages > 1 ? <span className="label-caps text-zinc-400 tabular-nums">Page {page} of {pages}</span> : undefined}
                >
                    {loading ? (
                        <div aria-hidden className="space-y-3">
                            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                        </div>
                    ) : failed ? (
                        <LoadError what={`your expenses for ${periodLabel}`} onRetry={retry} />
                    ) : visible.length === 0 ? (
                        expenses.length === 0 ? (
                            <Empty
                                icon={Receipt}
                                title={`Nothing recorded in ${periodLabel}`}
                                action={isCurrentPeriod
                                    ? <button type="button" onClick={openQuickAdd} className="btn-primary">Add an expense</button>
                                    : undefined}
                            >
                                {isCurrentPeriod ? "Expenses you add show up here." : "Pick another month or year above."}
                            </Empty>
                        ) : (
                            <Empty
                                icon={SearchX}
                                title="No matching expenses"
                                action={<button type="button" onClick={clearFilters} className="btn-secondary">Clear filters</button>}
                            >
                                Nothing in {periodLabel} matches your search or amount filter.
                            </Empty>
                        )
                    ) : (
                        <>
                            <ul ref={listRef} tabIndex={-1} aria-labelledby="history-results" className="-mt-3.5 outline-none">
                                {shown.map((e) => (
                                    <li key={e._id} className="border-t border-white/[0.07] first:border-t-0">
                                        <ExpenseRow
                                            expense={e}
                                            category={catMap[e.category]}
                                            onUpdated={handleUpdated}
                                            onDeleted={handleDeleted}
                                        />
                                    </li>
                                ))}
                            </ul>

                            {pages > 1 && (
                                <nav aria-label="Pages" className="mt-4 pt-4 border-t border-white/[0.07] flex items-center justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={() => goToPage(page - 1)}
                                        aria-disabled={page === 1}
                                        className="btn-secondary aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="w-4 h-4" aria-hidden /> Previous
                                    </button>
                                    <p aria-live="polite" className="text-[12.5px] text-zinc-400 tabular-nums text-center">
                                        {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => goToPage(page + 1)}
                                        aria-disabled={page === pages}
                                        className="btn-secondary aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                                    >
                                        Next <ChevronRight className="w-4 h-4" aria-hidden />
                                    </button>
                                </nav>
                            )}
                        </>
                    )}
                </Card>
            </div>
        </Page>
    );
}
