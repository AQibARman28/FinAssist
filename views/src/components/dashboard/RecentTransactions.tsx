"use client";

import { CreditCard } from "lucide-react";
import { format } from "date-fns";
import { useCurrency } from "@/lib/useCurrency";

interface Transaction {
    _id: string;
    description: string;        // backend field (was previously misread as `title`)
    amount: number;
    date: string;
    category: string;           // ObjectId since Part 3
}

interface RecentTransactionsProps {
    transactions: Transaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
    const { formatExpense } = useCurrency();
    if (transactions.length === 0) {
        return <div className="text-zinc-500 text-sm text-center py-10">No recent transactions</div>;
    }

    return (
        <div className="space-y-4">
            {transactions.map((tx) => {
                return (
                    <div
                        key={tx._id}
                        className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer group"
                    >
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-xl bg-zinc-800 text-purple-400 group-hover:scale-105 transition-transform">
                                <CreditCard className="w-5 h-5" />
                            </div>
                            <div>
                                <h4 className="text-white font-medium text-sm truncate max-w-[180px]">{tx.description}</h4>
                                <p className="text-zinc-500 text-xs tabular-nums">
                                    {format(new Date(tx.date), "MMM d, h:mm a")}
                                </p>
                            </div>
                        </div>
                        <span className="text-white font-medium text-sm tabular-nums">
                            {formatExpense(tx.amount)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
