"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

export function RecurringExpensesList() {
    const [recurring, setRecurring] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRecurring = async () => {
            try {
                const res = await api.get("/analytics/recurring-expenses");
                setRecurring(res.data.data);
            } catch (err) {
                console.error("Failed to fetch recurring expenses", err);
            } finally {
                setLoading(false);
            }
        };
        fetchRecurring();
    }, []);

    if (loading) return <div className="h-64 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 h-full">
            <div className="flex items-center gap-2 mb-6">
                <RefreshCw className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-white">Recurring Expenses</h3>
            </div>

            {recurring.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center">
                    <p className="text-zinc-500 text-sm">No recurring expenses detected yet.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {recurring.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                            <div>
                                <h4 className="text-white font-medium text-sm">{item._id}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                                        {item.count}x times
                                    </span>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="block text-white font-medium">${item.total.toFixed(2)}</span>
                                <span className="text-xs text-zinc-500">Total spent</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
