"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApi } from "@/lib/useApi";
import { useCategories } from "@/lib/useCategories";
import { ExpenseRow, type ExpenseItem, type ExpenseCategory } from "./ExpenseRow";

interface ExpenseListProps {
    /** Called after an expense is edited or deleted. */
    onChange?: () => void;
}

export function ExpenseList({ onChange }: ExpenseListProps) {
    // Categories load alongside the expenses so the rows render with
    // name/icon/color right away — they show ObjectId-ish blanks otherwise.
    const categories = useCategories<ExpenseCategory & { isArchived?: boolean }>("expense");
    const list = useApi<ExpenseItem[]>("/expenses", { limit: 100 });
    const catMap = useMemo(() => {
        const map: Record<string, ExpenseCategory> = {};
        for (const c of categories.all) map[c._id] = c;
        return map;
    }, [categories.all]);

    // An edit or delete shows at once from the server's reply; the refetch
    // that every write triggers (lib/api.ts) then replaces this overlay.
    const [edited, setEdited] = useState<{ base: ExpenseItem[] | undefined; items: ExpenseItem[] } | null>(null);
    const expenses = edited && edited.base === list.data ? edited.items : (list.data ?? []);

    const handleUpdated = (updated: ExpenseItem) => {
        setEdited({ base: list.data, items: expenses.map((ex) => (ex._id === updated._id ? updated : ex)) });
        onChange?.();
    };

    const handleDeleted = (id: string) => {
        setEdited({ base: list.data, items: expenses.filter((ex) => ex._id !== id) });
        onChange?.();
    };

    if (list.isLoading || categories.isLoading) {
        return (
            <div className="p-4 sm:p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[500px]" aria-hidden>
                <div className="h-6 w-44 mb-6 rounded-lg bg-white/5 animate-pulse" />
                <div className="space-y-2">
                    {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />)}
                </div>
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
