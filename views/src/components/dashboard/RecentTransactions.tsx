"use client";

import { ShoppingBag, Coffee, Car, Home, CreditCard, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { CATEGORY_ICONS_MAP } from "@/components/dashboard/expenses/ExpenseList";

interface Transaction {
    _id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
}

interface RecentTransactionsProps {
    transactions: Transaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
    if (transactions.length === 0) {
        return <div className="text-zinc-500 text-sm text-center py-10">No recent transactions</div>;
    }

    return (
        <div className="space-y-4">
            {transactions.map((tx) => {
                const Icon = CATEGORY_ICONS_MAP[tx.category] || CreditCard;
                return (
                    <div key={tx._id} className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer group">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl bg-zinc-800 text-purple-400 group-hover:scale-105 transition-transform`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <div>
                                <h4 className="text-white font-medium text-sm">{tx.title}</h4>
                                <p className="text-zinc-500 text-xs">{format(new Date(tx.date), "MMM d, h:mm a")}</p>
                            </div>
                        </div>
                        <span className="text-white font-medium text-sm">-${tx.amount.toLocaleString()}</span>
                    </div>
                );
            })}
        </div>
    );
}
