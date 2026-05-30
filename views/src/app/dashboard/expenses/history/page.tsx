"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, Search, Loader2, Receipt, X } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { iconFor, type IconName } from "@/lib/categoryIcons";

interface Expense {
    _id: string;
    description: string;
    amount: number;
    category: string; // ObjectId
    date: string;
}
interface Category {
    _id: string;
    name: string;
    color: string;
    icon: IconName;
}

type Mode = "month" | "year";
type AmountOp = ">" | ">=" | "<" | "<=" | "=";
type SortKey = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

export default function ExpenseHistoryPage() {
    const { format: fmt, formatExpense } = useCurrency();
    const now = new Date();

    // Period selection
    const [mode, setMode] = useState<Mode>("month");
    const [year, setYear] = useState<number>(now.getFullYear());
    const [month, setMonth] = useState<number>(now.getMonth()); // 0-11

    // Data
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [catMap, setCatMap] = useState<Record<string, Category>>({});
    const [loading, setLoading] = useState(true);

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
        setLoading(true);
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
                setCatMap(map);
                setExpenses(exp);
            })
            .catch((err) => { if (!cancelled) { console.error(err); setExpenses([]); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [mode, year, month]);

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
            if (q) {
                const cat = catMap[e.category]?.name ?? "";
                const dateStr = format(new Date(e.date), "MMM d, yyyy");
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

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <Link href="/dashboard/expenses" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-2">
                        <ArrowLeft className="w-4 h-4" /> Back to expenses
                    </Link>
                    <h1 className="text-2xl font-bold text-white">Transaction History</h1>
                    <p className="text-zinc-500 text-sm">Every expense you&apos;ve recorded — browse, search, and filter.</p>
                </div>
            </div>

            {/* Period selector */}
            <div className="p-4 rounded-3xl bg-zinc-900/50 border border-white/5 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-black/30 border border-white/5">
                    {(["month", "year"] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${mode === m ? "bg-purple-500 text-white" : "text-zinc-400 hover:text-white"}`}
                        >
                            {m}
                        </button>
                    ))}
                </div>

                {mode === "month" && (
                    <select
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                        className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500/50 cursor-pointer"
                    >
                        {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                    </select>
                )}

                <select
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value, 10))}
                    className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500/50 cursor-pointer tabular-nums"
                >
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>

            {/* Search + amount filter + sort */}
            <div className="p-4 rounded-3xl bg-zinc-900/50 border border-white/5 space-y-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Search by description, category, amount, or date…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" aria-label="Clear search">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Amount threshold */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Costs</span>
                        <select
                            value={amountOp}
                            onChange={(e) => setAmountOp(e.target.value as AmountOp)}
                            className="bg-black/40 border border-white/10 rounded-lg px-2 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500/50 cursor-pointer"
                        >
                            <option value=">">{"> greater than"}</option>
                            <option value=">=">{"≥ at least"}</option>
                            <option value="<">{"< less than"}</option>
                            <option value="<=">{"≤ at most"}</option>
                            <option value="=">{"= equals"}</option>
                        </select>
                        <input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="amount"
                            value={amountVal}
                            onChange={(e) => setAmountVal(e.target.value)}
                            className="w-28 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white tabular-nums placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
                        />
                        {amountVal && (
                            <button onClick={() => setAmountVal("")} className="text-xs text-zinc-500 hover:text-zinc-300">clear</button>
                        )}
                    </div>

                    <div className="flex-1" />

                    {/* Sort */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Sort</span>
                        <select
                            value={sortKey}
                            onChange={(e) => setSortKey(e.target.value as SortKey)}
                            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500/50 cursor-pointer"
                        >
                            <option value="date-desc">Date — newest first</option>
                            <option value="date-asc">Date — oldest first</option>
                            <option value="amount-desc">Amount — high to low</option>
                            <option value="amount-asc">Amount — low to high</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Results */}
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-sm text-zinc-400">{visible.length} record{visible.length === 1 ? "" : "s"}</span>
                    <span className="text-sm text-zinc-400">Total <span className="text-white font-medium tabular-nums">{fmt(total)}</span></span>
                </div>

                {loading ? (
                    <div className="py-20 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>
                ) : visible.length === 0 ? (
                    <div className="py-20 text-center">
                        <Receipt className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                        <p className="text-zinc-500">No matching expenses.</p>
                        <p className="text-zinc-600 text-sm mt-1">
                            {expenses.length === 0 ? "Nothing recorded for this period." : "Try a different search or filter."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {visible.map((e) => {
                            const cat = catMap[e.category];
                            const Icon = iconFor(cat?.icon);
                            return (
                                <div key={e._id} className="flex items-center justify-between p-4 rounded-2xl bg-black/20 hover:bg-white/5 border border-transparent hover:border-white/5 transition-all">
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="p-3 rounded-xl shrink-0" style={{ backgroundColor: cat ? `${cat.color}22` : "rgba(255,255,255,0.05)" }}>
                                            <Icon className="w-5 h-5" style={cat ? { color: cat.color } : undefined} />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-white font-medium text-sm truncate" title={e.description}>{e.description}</h4>
                                            <div className="flex gap-2 text-xs text-zinc-500 mt-0.5">
                                                <span>{cat?.name ?? "Uncategorized"}</span>
                                                <span>•</span>
                                                <span className="tabular-nums">{format(new Date(e.date), "MMM d, yyyy")}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <span className="text-white font-medium text-sm tabular-nums shrink-0 ml-3">{formatExpense(e.amount)}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
