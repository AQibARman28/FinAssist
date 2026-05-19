"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
    Plus, Loader2, MoreVertical, Pencil, Trash2, Repeat, AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { iconFor, type IconName } from "@/lib/categoryIcons";

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
}

interface Category {
    _id: string;
    name: string;
    color: string;
    icon: IconName;
}

function truncate(s: string, n = 40): string {
    return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function useCurrencyFormatter(currency = "USD") {
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export default function IncomePage() {
    const user = useAuthStore((s) => s.user);
    const fmt  = useCurrencyFormatter(user?.currency || "USD");

    const [incomes, setIncomes] = useState<Income[]>([]);
    const [catMap, setCatMap]   = useState<Record<string, Category>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            // Pull a window covering this and last month so materialization
            // catches the current period reliably.
            const now = new Date();
            const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
            const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

            const [cRes, iRes] = await Promise.all([
                api.get("/categories?type=income&includeArchived=true"),
                api.get("/incomes", {
                    params: { startDate: start.toISOString(), endDate: end.toISOString(), limit: 100 },
                }),
            ]);
            const map: Record<string, Category> = {};
            for (const c of cRes.data?.data ?? []) map[c._id] = c;
            setCatMap(map);

            const list: Income[] = (iRes.data?.data ?? [])
                .slice()
                .sort((a: Income, b: Income) => new Date(b.date).getTime() - new Date(a.date).getTime());
            setIncomes(list);
            setError(null);
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to load income");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this income entry?")) return;
        try {
            await api.delete(`/incomes/${id}`);
            setIncomes((prev) => prev.filter((i) => i._id !== id));
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to delete income");
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex justify-between items-end mb-8 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white">Income</h1>
                    <p className="text-zinc-500 text-sm">Earnings recorded for the current and previous month.</p>
                </div>
                <Link
                    href="/dashboard/income/new"
                    className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium px-4 py-2.5 rounded-xl transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add income
                </Link>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                    </div>
                ) : incomes.length === 0 ? (
                    <div className="text-center py-16">
                        <p className="text-zinc-500 mb-3">No income recorded yet.</p>
                        <Link href="/dashboard/income/new" className="text-purple-400 hover:text-purple-300 text-sm">
                            Add your first income →
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <AnimatePresence>
                            {incomes.map((inc) => (
                                <IncomeRow
                                    key={inc._id}
                                    income={inc}
                                    cat={catMap[inc.category]}
                                    fmt={fmt}
                                    onDelete={() => handleDelete(inc._id)}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}

function IncomeRow({
    income, cat, fmt, onDelete,
}: {
    income: Income;
    cat?: Category;
    fmt: Intl.NumberFormat;
    onDelete: () => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const Icon = iconFor(cat?.icon);
    const isRecurringSource = income.isRecurring && !income.parentRecurringId;
    const isMaterialized    = !!income.parentRecurringId;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className="group flex items-center gap-4 p-4 rounded-2xl bg-black/20 hover:bg-white/5 border border-transparent hover:border-white/5 transition-all"
        >
            <div className="text-xs text-zinc-500 tabular-nums w-20 shrink-0">
                {format(new Date(income.date), "MMM d")}
            </div>

            <div
                className="p-2.5 rounded-xl shrink-0"
                style={{ backgroundColor: cat ? `${cat.color}22` : "rgba(255,255,255,0.05)" }}
            >
                <Icon className="w-4 h-4" style={cat ? { color: cat.color } : undefined} />
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm truncate" title={income.description}>
                        {truncate(income.description)}
                    </span>
                    {isRecurringSource && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                            <Repeat className="w-3 h-3" />
                            {income.recurringFrequency}
                        </span>
                    )}
                    {isMaterialized && (
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full">
                            instance
                        </span>
                    )}
                    {!income.isPostTax && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            pre-tax
                        </span>
                    )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">{cat?.name ?? "Uncategorized"}</div>
            </div>

            <div className="text-emerald-400 font-medium text-sm tabular-nums">
                +{fmt.format(income.amount)}
            </div>

            <div className="relative">
                <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden py-1">
                            <Link
                                href={`/dashboard/income/${income._id}`}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
                                onClick={() => setMenuOpen(false)}
                            >
                                <Pencil className="w-4 h-4" /> Edit
                            </Link>
                            <button
                                onClick={() => { setMenuOpen(false); onDelete(); }}
                                className={cn(
                                    "w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10",
                                )}
                            >
                                <Trash2 className="w-4 h-4" /> Delete
                            </button>
                        </div>
                    </>
                )}
            </div>
        </motion.div>
    );
}
