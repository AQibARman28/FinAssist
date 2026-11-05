"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Receipt } from "lucide-react";
import { useApi } from "@/lib/useApi";
import { useCategories } from "@/lib/useCategories";
import { openQuickAdd } from "@/lib/quickAdd";
import { Card, CardLink, Empty, Skeleton } from "@/components/dashboard/ui";
import { LoadError } from "@/components/dashboard/LoadNotice";
import { ExpenseRow, type ExpenseItem, type ExpenseCategory } from "./ExpenseRow";

interface ExpenseListProps {
    /** Called after an expense is edited or deleted. */
    onChange?: () => void;
    className?: string;
}

// The list asks for the newest 100; older ones live in Transaction history.
const LIMIT = 100;
const EASE = [0.16, 1, 0.3, 1] as const;

export function ExpenseList({ onChange, className }: ExpenseListProps) {
    // Categories load alongside the expenses so the rows render with
    // name/icon/color right away — they show ObjectId-ish blanks otherwise.
    const categories = useCategories<ExpenseCategory & { isArchived?: boolean }>("expense");
    const list = useApi<ExpenseItem[]>("/expenses", { limit: LIMIT });
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

    const loading = list.isLoading || categories.isLoading;
    const count = expenses.length;
    const aside = !loading && list.error === undefined && count > 0
        ? <span className="label-caps text-zinc-400 tabular-nums">{count >= LIMIT ? `Newest ${LIMIT}` : `${count} ${count === 1 ? "expense" : "expenses"}`}</span>
        : undefined;

    return (
        <Card title="Latest expenses" id="latest-expenses" aside={aside} className={className}>
            {loading ? (
                <div aria-hidden className="space-y-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
            ) : list.error !== undefined ? (
                <LoadError what="your expenses" onRetry={() => void list.refresh()} />
            ) : count === 0 ? (
                <Empty
                    icon={Receipt}
                    title="No expenses yet"
                    action={<button type="button" onClick={openQuickAdd} className="btn-primary">Add your first expense</button>}
                >
                    Type one into the quick add above, or use the form.
                </Empty>
            ) : (
                <>
                    {/* The first render isn't animated; a row that's added fades
                        in and a deleted one folds away. */}
                    <ul className="-mt-3.5">
                        <AnimatePresence initial={false}>
                            {expenses.map((expense) => (
                                <motion.li
                                    key={expense._id}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.25, ease: EASE }}
                                    className="border-t border-white/[0.07] first:border-t-0"
                                >
                                    <ExpenseRow
                                        expense={expense}
                                        category={catMap[expense.category]}
                                        onUpdated={handleUpdated}
                                        onDeleted={handleDeleted}
                                    />
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                    {count >= LIMIT && (
                        <p className="mt-4 pt-4 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-zinc-400">
                            Older expenses are in your transaction history.
                            <CardLink href="/dashboard/expenses/history">Transaction history</CardLink>
                        </p>
                    )}
                </>
            )}
        </Card>
    );
}
