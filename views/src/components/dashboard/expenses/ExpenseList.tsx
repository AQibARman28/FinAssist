"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { ExpenseRow, type ExpenseItem, type ExpenseCategory } from "./ExpenseRow";

interface ExpenseListProps {
    refreshTrigger: number;
    /** Called after an expense is edited or deleted so the page can refresh totals. */
    onChange?: () => void;
}

export function ExpenseList({ refreshTrigger, onChange }: ExpenseListProps) {
    const [expenses, setExpenses]   = useState<ExpenseItem[]>([]);
    const [catMap, setCatMap]       = useState<Record<string, ExpenseCategory>>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        // Pull categories alongside the expenses so the rows render with
        // name/icon/color right away — they show ObjectId-ish blanks otherwise.
        Promise.all([
            api.get("/categories?type=expense&includeArchived=true"),
            api.get("/expenses?limit=100"),
        ])
            .then(([catsRes, expRes]) => {
                if (cancelled) return;
                const map: Record<string, ExpenseCategory> = {};
                for (const c of catsRes.data?.data ?? []) map[c._id] = c;
                setCatMap(map);
                setExpenses(expRes.data?.data ?? []);
            })
            .catch((err) => { if (!cancelled) console.error(err); })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [refreshTrigger]);

    const handleUpdated = (updated: ExpenseItem) => {
        setExpenses((prev) => prev.map((ex) => (ex._id === updated._id ? updated : ex)));
        onChange?.();
    };

    const handleDeleted = (id: string) => {
        setExpenses((prev) => prev.filter((ex) => ex._id !== id));
        onChange?.();
    };

    if (isLoading) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[200px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[500px]">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-white">Transaction History</h2>
                <span className="text-xs text-zinc-500 tabular-nums">{expenses.length} records</span>
            </div>

            <div className="space-y-2">
                <AnimatePresence>
                    {expenses.map((expense) => (
                        <motion.div
                            key={expense._id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                        >
                            <ExpenseRow
                                expense={expense}
                                category={catMap[expense.category]}
                                onUpdated={handleUpdated}
                                onDeleted={handleDeleted}
                            />
                        </motion.div>
                    ))}
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
