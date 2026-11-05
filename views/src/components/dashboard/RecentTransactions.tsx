"use client";

import { Plus, BadgeCheck, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { useCurrency } from "@/lib/useCurrency";
import { calendarDay, formatDay } from "@/lib/dates";
import { openQuickAdd } from "@/lib/quickAdd";

export interface Transaction {
    _id: string;
    description: string;        // backend field (was previously misread as `title`)
    amount: number;
    date: string;
    category: string;           // ObjectId since Part 3
    integrity?: "missing" | "invalid";  // set by the server when the record's signature check fails
}

export interface TransactionCategory {
    _id: string;
    name: string;
    icon?: string;
    color?: string;
}

interface RecentTransactionsProps {
    transactions: Transaction[];
    categories?: TransactionCategory[];
}

// The latest expenses, each with its day set large on the left and its
// signature state beside the category: the protection made visible
// (PRODUCT.md › Make the protection visible).
export function RecentTransactions({ transactions, categories = [] }: RecentTransactionsProps) {
    const { formatExpense } = useCurrency();
    if (transactions.length === 0) {
        return (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-zinc-400 text-sm">No spending recorded yet.</p>
                <button
                    type="button"
                    onClick={openQuickAdd}
                    className="inline-flex items-center gap-2 min-h-11 px-5 rounded-full bg-plat text-plat-ink text-sm font-semibold hover:bg-white transition-colors focus-ring"
                >
                    <Plus className="w-4 h-4" aria-hidden /> Add your first expense
                </button>
            </div>
        );
    }
    const byId = new Map(categories.map((c) => [c._id, c]));
    const now = new Date();

    return (
        <ul>
            {transactions.map((tx) => {
                const cat = byId.get(tx.category);
                const day = calendarDay(tx.date);
                const when = formatDay(tx.date, now);
                return (
                    <li key={tx._id} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 py-3.5 border-t border-white/[0.07] first:border-t-0 first:pt-0">
                        <span aria-hidden className="grid justify-items-center leading-none text-zinc-400">
                            <b className="text-[23px] font-light [font-stretch:112%] text-white">{day.getDate()}</b>
                            <span className="mt-1.5 text-[10.5px] font-medium tracking-[0.14em] [font-stretch:118%] uppercase">{format(day, "EEE")}</span>
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate font-semibold text-white">{tx.description}</span>
                            <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-zinc-400 min-w-0">
                                {cat?.color && <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: cat.color }} />}
                                <span className="truncate">{cat ? `${cat.name} · ` : ""}{when}</span>
                                {tx.integrity
                                    ? <span className="inline-flex items-center gap-1 shrink-0 text-amber-200"><ShieldAlert className="w-3.5 h-3.5 text-amber-300" aria-hidden />Failed check</span>
                                    : <span className="inline-flex items-center gap-1 shrink-0"><BadgeCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden />Signed</span>}
                            </span>
                        </span>
                        <span className="font-medium text-white tabular-nums shrink-0">{formatExpense(tx.amount)}</span>
                    </li>
                );
            })}
        </ul>
    );
}
