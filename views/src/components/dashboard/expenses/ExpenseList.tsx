"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Trash2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";
import { iconFor, type IconName } from "@/lib/categoryIcons";

interface Expense {
    _id: string;
    description: string;
    amount: number;
    category: string;            // ObjectId
    date: string;
}

interface Category {
    _id:   string;
    name:  string;
    color: string;
    icon:  IconName;
}

interface ExpenseListProps {
    refreshTrigger: number;
}

export function ExpenseList({ refreshTrigger }: ExpenseListProps) {
    const { formatExpense } = useCurrency();
    const [expenses, setExpenses]   = useState<Expense[]>([]);
    const [catMap, setCatMap]       = useState<Record<string, Category>>({});
    const [isLoading, setIsLoading] = useState(true);

    const fetchAll = async () => {
        setIsLoading(true);
        try {
            // Pull categories first so the list rows render with name/icon/color
            // right away — they show ObjectId-ish blanks otherwise.
            const [catsRes, expRes] = await Promise.all([
                api.get("/categories?type=expense&includeArchived=true"),
                api.get("/expenses?limit=100"),
            ]);
            const map: Record<string, Category> = {};
            for (const c of catsRes.data?.data ?? []) map[c._id] = c;
            setCatMap(map);
            setExpenses(expRes.data?.data ?? []);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [refreshTrigger]);

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/expenses/${id}`);
            setExpenses((prev) => prev.filter((ex) => ex._id !== id));
        } catch (err) {
            console.error(err);
        }
    };

    if (isLoading) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[200px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[500px]">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-white">Transaction History</h2>
                <span className="text-xs text-zinc-500 tabular-nums">{expenses.length} records</span>
            </div>

            <div className="space-y-2">
                <AnimatePresence>
                    {expenses.map((expense) => {
                        const cat = catMap[expense.category];
                        const Icon = iconFor(cat?.icon);
                        return (
                            <motion.div
                                key={expense._id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="flex items-center justify-between p-4 rounded-2xl bg-black/20 hover:bg-white/5 border border-transparent hover:border-white/5 transition-all group"
                            >
                                <div className="flex items-center gap-4">
                                    <div
                                        className="p-3 rounded-xl text-zinc-200 shrink-0"
                                        style={{ backgroundColor: cat ? `${cat.color}22` : "rgba(255,255,255,0.05)" }}
                                    >
                                        <Icon className="w-5 h-5" style={cat ? { color: cat.color } : undefined} />
                                    </div>
                                    <div>
                                        <h4 className="text-white font-medium text-sm">{expense.description}</h4>
                                        <div className="flex gap-2 text-xs text-zinc-500 mt-0.5">
                                            <span>{cat?.name ?? "Uncategorized"}</span>
                                            <span>•</span>
                                            <span>{format(new Date(expense.date), "MMM d, yyyy")}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6">
                                    <span className="text-white font-medium text-sm tabular-nums">
                                        {formatExpense(expense.amount)}
                                    </span>
                                    <button
                                        onClick={() => handleDelete(expense._id)}
                                        className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {expenses.length === 0 && (
                    <div className="text-center py-20">
                        <p className="text-zinc-500">No expenses recorded yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
